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

// Narrows an HTML document to the elements matching `tag.class`, `#id` or
// `tag` (every match, concatenated, so a list of cards or several tables all
// count). Returns the whole document when nothing matches.
export function scopeHtml(html, selector) {
  const src = String(html || "");
  const sel = String(selector || "").trim();
  if (!sel) return src;
  let open;
  const idm = /^#([\w-]+)$/.exec(sel), clsm = /^([a-z][\w-]*)?\.([\w-]+)$/i.exec(sel), tagm = /^([a-z][\w-]*)$/i.exec(sel);
  if (idm) open = new RegExp(`<([a-z][\\w-]*)\\b[^>]*\\bid\\s*=\\s*["']${idm[1]}["'][^>]*>`, "gi");
  else if (clsm) open = new RegExp(`<(${clsm[1] || "[a-z][\\w-]*"})\\b[^>]*\\bclass\\s*=\\s*["'](?:[^"']*\\s)?${clsm[2]}(?:\\s[^"']*)?["'][^>]*>`, "gi");
  else if (tagm) open = new RegExp(`<(${tagm[1]})\\b[^>]*>`, "gi");
  else return src;
  const parts = [];
  let m;
  while ((m = open.exec(src))) {
    const tag = m[1].toLowerCase();
    const start = m.index + m[0].length;
    // Walk to the matching close tag, counting nesting of the same tag.
    const walker = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
    walker.lastIndex = start;
    let depth = 1, w, end = src.length;
    while ((w = walker.exec(src))) {
      depth += w[1] ? -1 : 1;
      if (depth === 0) { end = w.index; break; }
    }
    parts.push(src.slice(start, end));
    open.lastIndex = Math.max(open.lastIndex, end);
    if (parts.length >= 200) break;
  }
  return parts.length ? parts.join("\n") : src;
}

// Navigation and chrome that must never be mistaken for news.
const NAV_TEXT = /^(skip to (main )?content|home|main menu|contact( us)?|about( us)?|sitemap|site map|login|log in|sign in|register|feedback|screen reader( access)?|accessibility|english|hindi|हिंदी|हिन्दी|font size|a\+|a-|print|share|search|rti|faq|faqs|disclaimer|privacy policy|terms (of use|and conditions)|copyright policy|hyperlink policy|help|back to top|read more|more|view (all|more)\b.*|click here|next|previous|previous page|next page|share (on|of) .+|citizen login|employee login|proceed to payment|check payment status|pay your bill|my account)$/i;
const NEWSY_URL = /(notice|notif|press|news|circular|order|tender|announce|advert|bulletin|release|whatsnew|what-s-new|updates?|public|\.pdf(\?|$))/i;
const DATE_NEAR = /\b(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+\d{4}|(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/i;
export function stripChrome(html) {
  return String(html || "").replace(/<(script|style|nav|header|footer|aside|noscript)\b[\s\S]*?<\/\1\s*>/gi, " ");
}
// Indian pages print dates day first: 07/10/2026 is 7 October.
export function parseDateText(s) {
  const t = cleanText(s).replace(/(\d)(st|nd|rd|th)\b/i, "$1");
  const dmy = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/.exec(t);
  if (dmy) {
    const y = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    const d = new Date(Date.UTC(y, Number(dmy[2]) - 1, Number(dmy[1])));
    return Number.isNaN(d.getTime()) || d.getUTCMonth() !== Number(dmy[2]) - 1 ? null : d.toISOString();
  }
  return isoDate(t);
}
// Anchor texts that are not titles: the title sits elsewhere in the row.
const JUNK_TITLE = /^(view|download|pdf|open|read|details?|click here|link)?\s*(\(?\s*\d+(\.\d+)?\s*(kb|mb|bytes?)\s*\)?)?\s*$/i;
// The text of the enclosing table row or list item minus the anchor's own
// text and any date: used when the anchor says only "View (2 MB)".
function rowTitle(scope, idx, len, anchorText) {
  const before = scope.slice(Math.max(0, idx - 600), idx), after = scope.slice(idx + len, idx + len + 600);
  const rowOpen = /<(tr|li)\b[^>]*>/gi; let m, start = -1; while ((m = rowOpen.exec(before))) start = m.index + m[0].length;
  const rowClose = /<\/(tr|li)\s*>/i.exec(after);
  if (start < 0 || !rowClose) return null;
  const row = before.slice(start) + " " + after.slice(0, rowClose.index);
  let t = cleanText(row.replace(/<\/(td|th|div|p|span)\s*>/gi, " | ")).replace(/\s*\|\s*/g, " | ");
  if (anchorText) t = t.replace(anchorText, " ");
  t = t.replace(DATE_NEAR, " ").replace(/\b\d+(\.\d+)?\s*(kb|mb)\b/gi, " ").replace(/\b(view|download|pdf)\b/gi, " ");
  const parts = t.split("|").map((x) => x.replace(/\s+/g, " ").trim()).filter((x) => x.length >= 8 && !/^\d+\.?$/.test(x));
  return parts.length ? parts.sort((a, b) => b.length - a.length)[0].slice(0, 200) : null;
}
// A date printed in the anchor's own row or list item (bounded by the nearest
// block boundaries, at most 200 characters each side), if any.
const BLOCK = /<\/?(li|tr|p|div|article|td|h[1-6]|section)\b[^>]*>/gi;
function dateNear(scope, idx, len) {
  const before = scope.slice(Math.max(0, idx - 200), idx), after = scope.slice(idx + len, idx + len + 200);
  let b = before, m, last = -1; BLOCK.lastIndex = 0; while ((m = BLOCK.exec(before))) last = m.index + m[0].length; if (last >= 0) b = before.slice(last);
  let a = after; BLOCK.lastIndex = 0; const n = BLOCK.exec(after); if (n) a = after.slice(0, n.index);
  const dm = DATE_NEAR.exec(cleanText(b) + " | " + cleanText(a));
  if (dm) return parseDateText(dm[0]);
  // Not in the anchor's own cell: try the whole table row or list item.
  const rb = scope.slice(Math.max(0, idx - 600), idx), ra = scope.slice(idx + len, idx + len + 600);
  const ro = /<(tr|li)\b[^>]*>/gi; let r, rs = -1; while ((r = ro.exec(rb))) rs = r.index + r[0].length;
  const rc = /<\/(tr|li)\s*>/i.exec(ra);
  if (rs < 0 || !rc) return null;
  const rm = DATE_NEAR.exec(cleanText(rb.slice(rs)) + " | " + cleanText(ra.slice(0, rc.index)));
  return rm ? parseDateText(rm[0]) : null;
}

// Anchors inside the selected element → [{ title, url, published_at }].
// Without a selector (or when it matches nothing useful) the page minus its
// navigation, header, footer and asides is scanned, and only anchors that
// look like notices count: a date printed next to them, or a URL that says
// notice/press/order/tender/pdf. Relative hrefs resolve against baseUrl.
export function parseHtmlLinks(html, selector, baseUrl) {
  const pick = (scope, minLen, strict) => {
    const out = [], seen = new Set();
    const re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
    let m;
    while ((m = re.exec(scope))) {
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[1]);
      if (!href) continue;
      const url = resolveUrl(href[1] ?? href[2] ?? href[3], baseUrl);
      if (!url || !/^https?:/i.test(url) || /#$/.test(url)) continue;
      let title = cleanText(m[2]).replace(/^(click here\s*(-+&?g?t?;?>?|→|:)?\s*)/i, "").replace(/^["“”']+|["“”']+$/g, "").trim();
      // "View (2 MB)", "Download", "198.08 KB": the title is in the same row.
      if (JUNK_TITLE.test(title)) title = rowTitle(scope, m.index, m[0].length, title) || title;
      if (title.length < minLen || title.length > 200 || NAV_TEXT.test(title)) continue;
      if (seen.has(url)) continue;
      const when = dateNear(scope, m.index, m[0].length);
      if (strict && !when && !NEWSY_URL.test(url)) continue;
      seen.add(url);
      out.push({ title, url, published_at: when });
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
    const found = pick(scoped, 8, false);
    if (found.length) return found;
  }
  return pick(stripChrome(src), 20, true);
}

export const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
async function fetchText(url, fetchImpl, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const accept = "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.5";
    let r = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT, Accept: accept }, redirect: "follow", signal: ctrl.signal });
    // Some government hosts refuse unknown bots (403/406) but serve browsers; one retry with a browser UA.
    if (r.status === 403 || r.status === 406) r = await fetchImpl(url, { headers: { "User-Agent": BROWSER_UA, Accept: accept, "Accept-Language": "en-IN,en;q=0.9,hi;q=0.8" }, redirect: "follow", signal: ctrl.signal });
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
    const cause = e?.cause && (e.cause.code || e.cause.message) ? " (" + (e.cause.code || e.cause.message) + ")" : "";
    const msg = e?.name === "AbortError" ? "timeout" : String(e?.message || e) + cause;
    return { items: [], error: msg.slice(0, 200), skipped: false };
  }
}

// All sources, each in isolation → [{ id, items, error, skipped }].
// Sources are fetched together (each with its own timeout) so a slow
// government host costs one timeout, not the whole function's budget.
export async function fetchSources(sources, fetchImpl = fetch, opts = {}) {
  return Promise.all((sources || []).map(async (s) => ({ id: s.id, ...(await fetchSource(s, fetchImpl, opts)) })));
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
