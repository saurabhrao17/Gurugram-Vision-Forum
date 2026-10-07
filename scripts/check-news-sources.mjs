// Fetches every source in data/news-sources.json with a real network and
// reports what the fetcher would get: HTTP status, content type, items parsed
// and the first titles. Run from a machine (or GitHub Actions) that can reach
// *.gov.in; the sandbox used for development cannot.
//   node scripts/check-news-sources.mjs [--json out.json] [--timeout=15000]
import { readFile, writeFile } from "node:fs/promises";
import { parseRss, parseHtmlLinks, USER_AGENT } from "../lib/news-fetch.js";

const args = process.argv.slice(2);
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const timeoutMs = Number((args.find((a) => a.startsWith("--timeout=")) || "").split("=")[1]) || 15000;
const sources = JSON.parse(await readFile(new URL("../data/news-sources.json", import.meta.url), "utf8"));

async function probe(s) {
  const out = { id: s.id, name: s.name, type: s.type, url: s.url, selector: s.selector || "", status: null, contentType: "", bytes: 0, items: 0, titles: [], error: null };
  if (!s.url || s.type === "none") { out.error = "no page"; return out; }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(s.url, { headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,application/xml,application/rss+xml,*/*" }, redirect: "follow", signal: ctl.signal });
    out.status = r.status;
    out.contentType = (r.headers.get("content-type") || "").slice(0, 60);
    const body = await r.text();
    out.bytes = body.length;
    if (!r.ok) { out.error = "http " + r.status; return out; }
    const items = s.type === "rss" ? parseRss(body, s.url) : parseHtmlLinks(body, s.selector, s.url);
    out.items = items.length;
    out.titles = items.slice(0, 3).map((i) => (i.title || "").slice(0, 90) + (i.published_at ? " (" + String(i.published_at).slice(0, 10) + ")" : ""));
    if (!items.length) out.error = s.type === "rss" ? (/<(rss|feed|rdf:RDF)\b/i.test(body) ? "feed with no items" : "not a feed") : (/<a\b/i.test(body) ? "no links matched" : "no anchors (JS-only page?)");
  } catch (e) {
    out.error = e?.name === "AbortError" ? "timeout" : String(e?.message || e).slice(0, 160);
  } finally { clearTimeout(t); }
  return out;
}

const results = [];
for (const s of sources) results.push(await probe(s));
const ok = results.filter((r) => !r.error && r.items > 0);
const lines = ["| id | type | status | items | first titles | error |", "| --- | --- | --- | --- | --- | --- |"];
for (const r of results) lines.push(`| ${r.id} | ${r.type} | ${r.status ?? ""} | ${r.items} | ${r.titles.join(" · ").replace(/\|/g, "/")} | ${r.error || ""} |`);
const table = lines.join("\n");
console.log(table);
console.log(`\n${ok.length} of ${results.filter((r) => r.type !== "none").length} sources with a page return items.`);
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, "## News sources\n\n" + table + "\n", { flag: "a" });
if (jsonOut) await writeFile(jsonOut, JSON.stringify(results, null, 2));
