// News fetcher for the daily cron. Sources come from the news_sources table
// (seeded from data/news-sources.json when empty). Each source is RSS/Atom
// or an HTML page with a simple selector; parsing is regex-based on purpose
// so the function carries no HTML or XML dependency.
import { readFile } from "node:fs/promises";

export const USER_AGENT = "GurugramVisionForumBot/1.0 (+https://gurugramvisionforum.org)";
export const FETCH_TIMEOUT_MS = 8000;
export const ITEMS_PER_SOURCE = 20;
const MAX_BODY = 1.5 * 1024 * 1024;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
export function decodeEntities(s) {
  return String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k in ENTITIES) return ENTITIES[k];
    if (k.startsWith("#x")) { const c = parseInt(k.slice(2), 16); return Number.isFinite(c) ? String.fromCodePoint(c) : m; }
    if (k.startsWith("#")) { const c = parseInt(k.slice(1), 10); return Number.isFinite(c) ? String.fromCodePoint(c) : m; }
    return m;
  });
}

const stripCdata = (s) => String(s || "").replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
const stripTags = (s) => String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
// Tags are stripped before and after decoding so escaped HTML (Atom type="html") loses its markup too.
export const cleanText = (s) => stripTags(decodeEntities(stripTags(stripCdata(s)))).trim();

// First <tag>…</tag> inside a block, or null. Handles namespaced tags (dc:date).
function tagText(block, tag) {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}\\s*>`, "i").exec(block);
  return m ? m[1] : null;
}

function isoDate(s) {
  const t = Date.parse(cleanText(s));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function resolveUrl(href, baseUrl) {
  const h = decodeEntities(String(href || "").trim());
  if (!h || /^(javascript|mailto|tel):/i.test(h)) return null;
  try { return new URL(h, baseUrl || undefined).toString(); } catch { return null; }
}

// RSS 2.0 (<item>) and Atom (<entry>) → [{ title, url, published_at }].
export function parseRss(xml, baseUrl) {
  const src = String(xml || "");
  const out = [];
  const blocks = src.match(/<(?:item|entry)(?:\s[^>]*)?>[\s\S]*?<\/(?:item|entry)\s*>/gi) || [];
  for (const b of blocks) {
    const title = cleanText(tagText(b, "title"));
    let url = null;
    const linkTag = /<link\b([^>]*?)(?:\/>|>([\s\S]*?)<\/link\s*>)/gi;
    let m, alt = null, first = null;
    while ((m = linkTag.exec(b))) {
      const attrs = m[1] || "", inner = cleanText(m[2]);
      const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs);
      const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(attrs);
      const cand = href ? href[1] : inner;
      if (!cand) continue;
      if (!first) first = cand;
      if (href && (!rel || rel[1] === "alternate")) { alt = cand; break; }
    }
    url = resolveUrl(alt || first || cleanText(tagText(b, "guid")), baseUrl);
    if (!title || !url || !/^https?:/i.test(url)) continue;
    const date = tagText(b, "pubDate") || tagText(b, "published") || tagText(b, "updated") || tagText(b, "dc:date") || tagText(b, "lastBuildDate");
    out.push({ title: title.slice(0, 300), url: url.slice(0, 1000), published_at: date ? isoDate(date) : null });
  }
  return out;
}

// Narrows an HTML document to the first element matching `tag.class`, `#id`
// or `tag`. Returns the whole document when nothing matches.
export function scopeHtml(html, selector) {
  const src = String(html || "");
  const sel = String(selector || "").trim();
  if (!sel) return src;
  let open;
  const idm = /^#([\w-]+)$/.exec(sel), clsm = /^([a-z][\w-]*)?\.([\w-]+)$/i.exec(sel), tagm = /^([a-z][\w-]*)$/i.exec(sel);
  if (idm) open = new RegExp(`<([a-z][\\w-]*)\\b[^>]*\\bid\\s*=\\s*["']${idm[1]}["'][^>]*>`, "i");
  else if (clsm) open = new RegExp(`<(${clsm[1] || "[a-z][\\w-]*"})\\b[^>]*\\bclass\\s*=\\s*["'](?:[^"']*\\s)?${clsm[2]}(?:\\s[^"']*)?["'][^>]*>`, "i");
  else if (tagm) open = new RegExp(`<(${tagm[1]})\\b[^>]*>`, "i");
  else return src;
  const m = open.exec(src);
  if (!m) return src;
  const tag = m[1].toLowerCase();
  const start = m.index + m[0].length;
  // Walk to the matching close tag, counting nesting of the same tag.
  const walker = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  walker.lastIndex = start;
  let depth = 1, w;
  while ((w = walker.exec(src))) {
    depth += w[1] ? -1 : 1;
    if (depth === 0) return src.slice(start, w.index);
  }
  return src.slice(start);
}

// Anchors inside the selected element → [{ title, url }]. Without a selector
// (or when it matches nothing useful) every anchor whose text is 20..200
// characters counts. Relative hrefs resolve against baseUrl.
export function parseHtmlLinks(html, selector, baseUrl) {
  const pick = (scope, minLen) => {
    const out = [], seen = new Set();
    const re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
    let m;
    while ((m = re.exec(scope))) {
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[1]);
      if (!href) continue;
      const url = resolveUrl(href[1] ?? href[2] ?? href[3], baseUrl);
      if (!url || !/^https?:/i.test(url) || /#$/.test(url)) continue;
      const title = cleanText(m[2]);
      if (title.length < minLen || title.length > 200) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ title, url, published_at: null });
    }
    return out;
  };
  // A selector list ("table td a, .notice a") is tried left to right; each
  // candidate scopes on its first token (the container), ignoring the rest.
  const src = String(html || "");
  const candidates = String(selector || "").split(",").map((s) => s.trim().split(/\s+/)[0] || "").filter((s) => s && s.toLowerCase() !== "a");
  for (const sel of candidates) {
    const scoped = scopeHtml(src, sel);
    if (scoped === src) continue;
    const found = pick(scoped, 8);
    if (found.length) return found;
  }
  return pick(src, 20);
}

async function fetchText(url, fetchImpl, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.5" }, redirect: "follow", signal: ctrl.signal });
    if (!r.ok) throw new Error(`http ${r.status}`);
    const body = await r.text();
    return body.length > MAX_BODY ? body.slice(0, MAX_BODY) : body;
  } finally { clearTimeout(timer); }
}

// Fetches and parses one source. Returns { items, error } and never throws.
export async function fetchSource(source, fetchImpl = fetch, { timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  if (!source || !source.url || source.type === "none") return { items: [], error: null, skipped: true };
  try {
    const body = await fetchText(source.url, fetchImpl, timeoutMs);
    let items;
    if (source.type === "rss") items = parseRss(body, source.url);
    else if (source.type === "html") items = parseHtmlLinks(body, source.selector, source.url);
    else return { items: [], error: `unknown type ${source.type}`, skipped: false };
    if (source.type === "rss" && !items.length && /<a\b/i.test(body) && !/<(rss|feed|rdf:RDF)\b/i.test(body)) {
      return { items: [], error: "not a feed", skipped: false };
    }
    return { items: items.slice(0, ITEMS_PER_SOURCE), error: null, skipped: false };
  } catch (e) {
    const msg = e?.name === "AbortError" ? "timeout" : String(e?.message || e);
    return { items: [], error: msg.slice(0, 200), skipped: false };
  }
}

// All sources, each in isolation → [{ id, items, error, skipped }].
export async function fetchSources(sources, fetchImpl = fetch, opts = {}) {
  const out = [];
  for (const s of sources || []) {
    const r = await fetchSource(s, fetchImpl, opts);
    out.push({ id: s.id, ...r });
  }
  return out;
}

// data/news-sources.json, written by hand; missing file → [].
export async function loadSourcesFile(url = new URL("../data/news-sources.json", import.meta.url)) {
  try {
    const raw = JSON.parse(await readFile(url, "utf8"));
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.sources) ? raw.sources : [];
    return list.filter((s) => s && typeof s.id === "string" && typeof s.name === "string").map((s) => ({
      id: s.id, name: s.name, url: s.url || null, type: ["rss", "html", "none"].includes(s.type) ? s.type : "none",
      selector: s.selector || null, home: s.home || null, note: s.note || null, enabled: s.enabled !== false
    }));
  } catch { return []; }
}
