import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const library = path.join(root, "skills/marketing-playbooks/library");
const files = (await readdir(library)).filter((name) => name.endsWith(".md")).sort();
assert.equal(files.length, 36);

const skill = await readFile(path.join(root, "skills/marketing-playbooks/SKILL.md"), "utf8");
assert.match(skill, /^---\nname: marketing-playbooks\n/);
for (const file of files) {
  assert.ok(skill.includes("`" + file + "`"), file);
  const body = await readFile(path.join(library, file), "utf8");
  assert.ok(body.startsWith("# Playbook: "), file);
  assert.equal(/^## .*Identity/m.test(body), false, file);
  assert.equal(/^## .*Communication Style/m.test(body), false, file);
  assert.ok(body.includes("Copyright (c) 2025 AgentLand Contributors"), file);
}

const prompt = await readFile(path.join(root, "prompt/AGENTS.md"), "utf8");
assert.match(prompt, /plow_start_thread/);
assert.match(prompt, /accountId/);
assert.match(prompt, /marketing-worker/);
assert.match(prompt, /company-watch/);
assert.match(prompt, /content-system/);
assert.match(prompt, /content-cadence/);
assert.match(prompt, /battlecard/);
assert.match(prompt, /account-brief/);
assert.match(prompt, /--yolo/);
assert.match(prompt, /x-post/);
assert.match(prompt, /content-library/);
assert.match(prompt, /Zoen for distribution/);
assert.match(prompt, /sessions_spawn/);
assert.match(prompt, /sessions_yield/);
assert.match(prompt, /timeoutSeconds 0/);
assert.equal(prompt.includes("plow_send_message"), false);
assert.equal(prompt.includes("Do not use message"), false);

const worker = await readFile(path.join(root, "skills/marketing-worker/SKILL.md"), "utf8");
assert.match(worker, /^---\nname: marketing-worker\n/);
assert.match(worker, /sessions_spawn/);
assert.match(worker, /sessions_yield/);
assert.match(worker, /timeoutSeconds/);
assert.ok(worker.includes('action` `cancel'));
assert.match(worker, /content-pillars\.md/);
assert.match(worker, /content-editor\/SKILL\.md/);
assert.match(worker, /launch-kit\/SKILL\.md/);
assert.match(worker, /outreach\/SKILL\.md/);
assert.match(worker, /reply-guy\/SKILL\.md/);
assert.match(worker, /account-brief\/SKILL\.md/);
assert.match(worker, /warm-intro\/SKILL\.md/);
assert.match(worker, /proposal\/SKILL\.md/);
assert.match(worker, /call-prep\/SKILL\.md/);
assert.match(worker, /x-post\/SKILL\.md/);
assert.match(worker, /long-form\/SKILL\.md/);
assert.match(worker, /content-library\/SKILL\.md/);

for (const name of ["content-system", "content-editor", "content-cadence", "reply-guy", "launch-kit", "outreach", "positioning", "battlecard", "account-brief", "buying-signals", "warm-intro", "call-prep", "after-meeting", "objections", "proposal", "daily-distribution", "yolo", "content-library", "content-setup", "from-the-week", "x-post", "linkedin-post", "long-form", "draft-reply", "comedy", "x-daily", "li-daily", "content-shapes"]) {
  const body = await readFile(path.join(root, "skills", name, "SKILL.md"), "utf8");
  assert.match(body, new RegExp("^---\\nname: " + name + "\\n"));
}

for (const sheet of ["x.md", "linkedin.md", "long-form.md", "comedy.md", "launch-x.md", "launch-linkedin.md", "launch-video.md"]) {
  const body = await readFile(path.join(root, "skills/content-library", sheet), "utf8");
  assert.ok(body.startsWith("# "), sheet);
}

const delivery = await readFile(path.join(root, "skills/marketing-delivery/SKILL.md"), "utf8");
assert.match(delivery, /yolo\.json/);
const yolo = await readFile(path.join(root, "skills/yolo/SKILL.md"), "utf8");
assert.match(yolo, /--yolo off/);

const watch = await readFile(path.join(root, "skills/company-watch/SKILL.md"), "utf8");
assert.match(watch, /^---\nname: company-watch\n/);
assert.match(watch, /company-watch\.json/);
assert.match(watch, /openclaw cron add/);
const fetchScript = await readFile(path.join(root, "skills/company-watch/fetch.mjs"), "utf8");
assert.match(fetchScript, /hn\.algolia\.com/);

const dockerfile = await readFile(path.join(root, "Dockerfile"), "utf8");
assert.match(dockerfile, /sha256:6e5e1a11a8c6e2ef6ecaa5e7b429e778a9a3befaf416a09922aaaa4a5b21d647/);
assert.match(dockerfile, /COPY skills\/ \/opt\/plow\/skills\//);
assert.match(dockerfile, /Zoen for distribution/);
assert.match(dockerfile, /AGENT_ID=zoen-distribution/);

console.log("ok", files.length);
