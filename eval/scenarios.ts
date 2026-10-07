import { z } from "zod";
import { personalitySchema } from "../boot/personality.ts";
import { assertsPhrase } from "./assertions.ts";

export const scenarioSchema = z.object({
  id: z.string().min(1), category: z.string().optional(), review: z.array(z.string()).optional(),
  personality: personalitySchema.optional(), facts: z.record(z.string(), z.unknown()),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }).strict()).min(1),
  contains: z.array(z.string()).optional(), excludes: z.array(z.string()).optional(),
  doesNotAssert: z.array(z.string()).optional(), anyOf: z.array(z.string()).optional(),
  silent: z.boolean().optional(), maxChars: z.number().positive().optional(),
}).strict();
export type Scenario = z.infer<typeof scenarioSchema>;

export function dialogueChecks(scenario: Scenario, text: string, hasToolCalls: boolean) {
  return {
    nonempty: !!text, noToolCalls: !hasToolCalls,
    silence: !scenario.silent || text.replace(/^[.*_ `]+|[.*_ `]+$/g, "") === "NO_REPLY",
    contains: (scenario.contains ?? []).every(value => text.toLowerCase().includes(value.toLowerCase())),
    excludes: (scenario.excludes ?? []).every(value => !text.toLowerCase().includes(value.toLowerCase())),
    doesNotAssert: (scenario.doesNotAssert ?? []).every(value => !assertsPhrase(text, value)),
    anyOf: !scenario.anyOf || scenario.anyOf.some(value => text.toLowerCase().includes(value.toLowerCase())),
    length: !scenario.maxChars || text.length <= scenario.maxChars,
  };
}
