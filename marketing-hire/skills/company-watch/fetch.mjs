import { readFile, writeFile } from "node:fs/promises";

const watchPath = process.env.COMPANY_WATCH_PATH ?? "/var/lib/plow/workspace/company-watch.json";
const statePath = process.env.COMPANY_WATCH_STATE ?? "/var/lib/plow/workspace/company-watch-state.json";
const hoursArg = process.argv.indexOf("--hours");
const hoursFlag = hoursArg === -1 ? undefined : Number(process.argv[hoursArg + 1]);

const watch = JSON.parse(await readFile(watchPath, "utf8"));
const company = String(watch.company ?? "").trim();
if (!company) throw new Error("company-watch.json needs a company");
const aliases = asList(watch.aliases);
const competitors = asList(watch.competitors);
const exclude = asList(watch.exclude).map((word) => word.toLowerCase());

let state = { seen: [], lastRun: 0 };
try {
  state = { ...state, ...JSON.parse(await readFile(statePath, "utf8")) };
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const seen = new Set(Array.isArray(state.seen) ? state.seen : []);
const now = Date.now();
const hours = Number.isFinite(hoursFlag)
  ? hoursFlag
  : state.lastRun
    ? Math.min(48, Math.max(1, (now - state.lastRun) / 3_600_000 + 1))
    : 24 * 7;
const since = Math.floor((now - hours * 3_600_000) / 1000);

const mentions = [];
const errors = [];
const sources = new Set(asList(watch.sources).map((source) => source.toLowerCase()));
const use = (name) => sources.size === 0 || sources.has(name);

for (const query of [company, ...aliases]) {
  if (use("hackernews")) await collect("hackernews", "company", query, () => hackerNews(query, since), mentions, errors, seen, exclude);
  if (use("reddit")) await collect("reddit", "company", query, () => reddit(query, since), mentions, errors, seen, exclude);
}
for (const query of competitors) {
  if (use("hackernews")) await collect("hackernews", "competitor", query, () => hackerNews(query, since), mentions, errors, seen, exclude);
  if (use("reddit")) await collect("reddit", "competitor", query, () => reddit(query, since), mentions, errors, seen, exclude);
}

const fresh = mentions.filter((item) => !seen.has(item.id)).slice(0, 12);
for (const item of fresh) seen.add(item.id);
await writeFile(statePath, JSON.stringify({
  seen: [...seen].slice(-500),
  lastRun: now,
}, null, 2));

process.stdout.write(JSON.stringify({
  company,
  hours: Math.round(hours),
  mentions: fresh,
  errors,
}, null, 2) + "\n");

function asList(value) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function blocked(text, excludeWords) {
  const haystack = text.toLowerCase();
  return excludeWords.some((word) => word && haystack.includes(word));
}

async function collect(source, about, query, load, mentions, errors, seen, excludeWords) {
  try {
    for (const item of await load()) {
      const text = `${item.title} ${item.excerpt}`;
      if (blocked(text, excludeWords) || seen.has(item.id)) continue;
      mentions.push({ ...item, source, about, query });
    }
  } catch (error) {
    errors.push({ source, query, message: error instanceof Error ? error.message : String(error) });
  }
}

async function hackerNews(query, sinceSeconds) {
  const url = new URL("https://hn.algolia.com/api/v1/search_by_date");
  url.searchParams.set("query", query);
  url.searchParams.set("tags", "(story,comment)");
  url.searchParams.set("hitsPerPage", "8");
  url.searchParams.set("numericFilters", `created_at_i>${sinceSeconds}`);
  const body = await getJson(url);
  return (body.hits ?? []).map((hit) => ({
    id: `hn:${hit.objectID}`,
    title: clip(hit.title || hit.story_title || "Hacker News"),
    url: hit.url || hit.story_url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
    excerpt: clip(hit.story_text || hit.comment_text || ""),
    points: hit.points ?? null,
    comments: hit.num_comments ?? null,
  }));
}

async function reddit(query, sinceSeconds) {
  const url = new URL("https://www.reddit.com/search.json");
  url.searchParams.set("q", query);
  url.searchParams.set("sort", "new");
  url.searchParams.set("limit", "8");
  const body = await getJson(url, { "user-agent": "zoen-distribution-hire/1.0" });
  return (body.data?.children ?? [])
    .map((child) => child.data)
    .filter((post) => post && post.created_utc >= sinceSeconds)
    .map((post) => ({
      id: `reddit:${post.name}`,
      title: clip(post.title || "Reddit"),
      url: post.url?.startsWith("http") ? post.url : `https://www.reddit.com${post.permalink}`,
      excerpt: clip(post.selftext || ""),
      points: post.score ?? null,
      comments: post.num_comments ?? null,
    }));
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${url.hostname} HTTP ${response.status}`);
  return response.json();
}

function clip(text) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > 240 ? `${flat.slice(0, 239)}…` : flat;
}
