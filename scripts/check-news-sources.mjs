// Fetches every source in data/news-sources.json with a real network and
// reports what the fetcher would get: HTTP status, content type, items parsed
// and the first titles. Run from a machine (or GitHub Actions) that can reach
// *.gov.in; the sandbox used for development cannot.
//   node scripts/check-news-sources.mjs [--json out.json] [--timeout=15000]
import { readFile, writeFile } from "node:fs/promises";
import { parseRss, parseHtmlLinks, stripChrome, USER_AGENT, BROWSER_UA } from "../lib/news-fetch.js";

const args = process.argv.slice(2);
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const timeoutMs = Number((args.find((a) => a.startsWith("--timeout=")) || "").split("=")[1]) || 15000;
const dump = args.includes("--dump");
const sources = JSON.parse(await readFile(new URL("../data/news-sources.json", import.meta.url), "utf8"));
let candidates = [];
if (args.includes("--candidates")) { try { candidates = JSON.parse(await readFile(args[args.indexOf("--candidates") + 1], "utf8")); } catch (e) { console.error("candidates:", e.message); } }

// Ancestor chain for each anchor (tag#id.class), from a cheap tag tokenizer.
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
function anchorsWithChain(html, baseUrl, max) {
  const out = []; const stack = [];
  const re = /<(\/?)([a-zA-Z][\w:-]*)([^>]*)>/g; let m;
  while ((m = re.exec(html)) && out.length < max) {
    const close = m[1] === "/", tag = m[2].toLowerCase(), attrs = m[3] || "";
    if (close) { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === tag) { stack.length = i; break; } continue; }
    if (tag === "a") {
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
      const end = html.indexOf("</a", m.index);
      const text = (end > 0 ? html.slice(m.index + m[0].length, end) : "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (href && text.length >= 8) out.push({ text: text.slice(0, 70), href: (href[1] ?? href[2] ?? href[3] ?? "").slice(0, 90), chain: stack.slice(-5).map((s) => s.tag + (s.id ? "#" + s.id : "") + (s.cls ? "." + s.cls.split(/\s+/).slice(0, 2).join(".") : "")).join(">") });
      continue;
    }
    if (VOID.has(tag) || /\/\s*$/.test(attrs)) continue;
    const id = /\bid\s*=\s*["']([^"']+)["']/i.exec(attrs), cls = /\bclass\s*=\s*["']([^"']+)["']/i.exec(attrs);
    stack.push({ tag, id: id ? id[1] : "", cls: cls ? cls[1].trim() : "" });
    if (stack.length > 60) stack.shift();
  }
  return out;
}

async function probe(s) {
  const out = { id: s.id, name: s.name, type: s.type, url: s.url, selector: s.selector || "", status: null, contentType: "", bytes: 0, items: 0, titles: [], error: null };
  if (!s.url || s.type === "none") { out.error = "no page"; return out; }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    let r = await fetch(s.url, { headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,application/xml,application/rss+xml,*/*" }, redirect: "follow", signal: ctl.signal });
    if (r.status === 403 || r.status === 406) { r = await fetch(s.url, { headers: { "user-agent": BROWSER_UA, accept: "text/html,application/xhtml+xml,application/xml,application/rss+xml,*/*", "accept-language": "en-IN,en;q=0.9" }, redirect: "follow", signal: ctl.signal }); out.retriedAsBrowser = true; }
    out.status = r.status;
    out.finalUrl = r.url;
    out.contentType = (r.headers.get("content-type") || "").slice(0, 60);
    const body = await r.text();
    out.bytes = body.length;
    if (!r.ok) { out.error = "http " + r.status; return out; }
    const items = s.type === "rss" ? parseRss(body, s.url) : parseHtmlLinks(body, s.selector, s.url);
    out.items = items.length;
    out.titles = items.slice(0, 3).map((i) => (i.title || "").slice(0, 90) + (i.published_at ? " (" + String(i.published_at).slice(0, 10) + ")" : ""));
    if (!items.length) out.error = s.type === "rss" ? (/<(rss|feed|rdf:RDF)\b/i.test(body) ? "feed with no items" : "not a feed") : (/<a\b/i.test(body) ? "no links matched" : "no anchors (JS-only page?)");
    if (dump && s.type !== "rss") out.anchors = anchorsWithChain(stripChrome(body), s.url, 40);
    if (dump && s.type === "rss") out.head = body.slice(0, 300).replace(/\s+/g, " ");
  } catch (e) {
    const cause = e?.cause ? " (" + (e.cause.code || e.cause.message || "") + ")" : "";
    out.error = (e?.name === "AbortError" ? "timeout" : String(e?.message || e).slice(0, 160)) + cause;
  } finally { clearTimeout(t); }
  return out;
}

const results = [];
for (const s of sources) results.push(await probe(s));
for (const cnd of candidates) results.push(await probe({ id: "candidate:" + cnd.id, name: cnd.id, type: cnd.type || "html", url: cnd.url, selector: cnd.selector || "" }));
const ok = results.filter((r) => !r.error && r.items > 0);
const lines = ["| id | type | status | items | first titles | error |", "| --- | --- | --- | --- | --- | --- |"];
for (const r of results) lines.push(`| ${r.id} | ${r.type} | ${r.status ?? ""} | ${r.items} | ${r.titles.join(" · ").replace(/\|/g, "/")} | ${r.error || ""} |`);
const table = lines.join("\n");
console.log(table);
if (dump) for (const r of results) {
  if (r.head) console.log("\n## " + r.id + " (feed head)\n" + r.head);
  if (r.anchors && r.anchors.length) { console.log("\n## " + r.id + " anchors (" + (r.finalUrl || r.url) + ")"); for (const a of r.anchors) console.log("  [" + a.chain + "] " + a.text + " -> " + a.href); }
}
console.log(`\n${ok.length} of ${results.filter((r) => r.type !== "none").length} sources with a page return items.`);
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, "## News sources\n\n" + table + "\n", { flag: "a" });
if (jsonOut) await writeFile(jsonOut, JSON.stringify(results, null, 2));
