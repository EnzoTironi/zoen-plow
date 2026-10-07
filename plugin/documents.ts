import { z } from "zod";
import type { OpenClawConfig } from "openclaw/plugin-sdk/channel-core";
import { normalizePluginsConfig, resolveEffectiveEnableState } from "openclaw/plugin-sdk/plugin-config-runtime";

const extraction = z.object({ text: z.string(), images: z.array(z.object({ type: z.literal("image"), data: z.string(), mimeType: z.literal("image/png") })) });
type Request = { buffer: Buffer; maxPages: number; maxPixels: number; minTextChars: number; signal: AbortSignal; onImageExtractionError: (error: unknown) => void };
const factorySchema = z.object({ createPdfDocumentExtractor: z.custom<() => unknown>(value => typeof value === "function") });
const extractorSchema = z.object({ extract: z.custom<(request: Request) => Promise<unknown>>(value => typeof value === "function") });

// Reuse the pinned bundled extractor's worker and PDFium, including scan rendering.
// Its public contract artifact has no SDK types; validate both the factory and result.
export async function pdfPreview(buffer: Buffer, config: OpenClawConfig, signal: AbortSignal) {
  if (!resolveEffectiveEnableState({ id: "document-extract", origin: "bundled", enabledByDefault: true, config: normalizePluginsConfig(config.plugins), rootConfig: config }).enabled) throw new Error("PDF extraction is disabled by the installation");
  const artifact = new URL("../extensions/document-extract/document-extractor.js", import.meta.resolve("openclaw/plugin-sdk/document-extractor"));
  const module: unknown = await import(artifact.href);
  const extractor = extractorSchema.parse(factorySchema.parse(module).createPdfDocumentExtractor());
  const maxPages = Math.min(config.agents?.defaults?.pdfMaxPages ?? 20, 4);
  let imageExtractionFailed = false;
  const value = extraction.parse(await extractor.extract({ buffer, maxPages, maxPixels: 4_000_000, minTextChars: 200, signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]), onImageExtractionError: () => { imageExtractionFailed = true; } }));
  return { text: value.text.slice(0, 12_000), textTruncated: value.text.length > 12_000, images: value.images, previewPageLimit: maxPages, imageExtractionFailed };
}
