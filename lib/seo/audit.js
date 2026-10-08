// The automated SEO desk: what a retained SEO consultant would check every
// night, done by the cron and shown on the desk's SEO tab (owner,
// coordinator, content team). Four parts:
//   - pageList(): every URL the sitemap lists (the app's routes, the guide,
//     ward and blog pages in both languages).
//   - auditHtml(): the on-page checks on one fetched page (title, meta
//     description, one H1, self canonical, hreflang pair, structured data,
//     Open Graph, lang attribute, viewport, word count, image alt text,
//     internal links) -> issues and a 0-100 score; seoStep() rotates through
//     the least-recently-checked pages and stores the result in seo_pages.
//   - vitalsStep(): Core Web Vitals and Lighthouse scores for a few key
//     pages through Google's free PageSpeed Insights API -> seo_vitals.
//   - mentionsStep(): where the Forum is named in the news (Google News
//     RSS) -> seo_mentions, the off-page view.
// Plus opportunities() (content gaps: what the city talks about this
// fortnight that the site has not covered) and checklist() (the standing
// technical set-up, automatic items proved by the audit rows, manual ones
// ticked from the desk). Nothing here touches reports.
import { gvf } from "../site-data.js";
import { APP_ROUTES, WARD_COUNT, siteUrl } from "./site.js";
import { hiPath } from "./layout.js";
import { parseRss, USER_AGENT } from "../news-fetch.js";

export const PAGES_PER_RUN = 40;
export const PAGE_TIMEOUT_MS = 8000;
export const PAGE_CONCURRENCY = 6;
export const VITALS_PER_RUN = 1;          // PageSpeed takes 20-40 s a page; one a night rotates the key pages weekly
export const VITALS_TIMEOUT_MS = 50000;
export const VITALS_PAGES = ["/", "/report", "/guide/roads", "/ward/1", "/blog", "/hi/guide/roads", "/guides"];
export const MENTION_QUERIES = ['"Gurugram Vision Forum"', '"Gurgaon Vision Forum"', "gurugramvisionforum.org"];
export const OPPORTUNITY_DAYS = 14;
export const PSI_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

// Limits a consultant would hold the pages to.
export const RULES = {
  title: [15, 70],
  description: [50, 160],
  words: { app: 0, index: 80, guide: 150, ward: 100, blog: 150 }
};

const DAY = 86400000;

// ---------------------------------------------------------------------------
// Every URL in the sitemap, with its kind and language.
// ---------------------------------------------------------------------------
export function pageList(posts = [], site = siteUrl()) {
  const G = gvf();
  const out = [];
  const add = (path, kind, lang) => out.push({ url: site + path, path, kind, lang });
  const both = (path, kind) => { add(path, kind, "en"); add(hiPath(path), kind, "hi"); };
  for (const p of APP_ROUTES) add(p, "app", "en");
  both("/guides", "index");
  for (const c of G.CATS || []) both(`/guide/${c.id}`, "guide");
  for (let n = 1; n <= WARD_COUNT; n++) both(`/ward/${n}`, "ward");
  both("/blog", "index");
  for (const p of posts || []) if (p && p.slug) both(`/blog/${p.slug}`, "blog");
  return out;
}

// ---------------------------------------------------------------------------
// HTML helpers (no DOM library on the function: a few careful regexes).
// ---------------------------------------------------------------------------
const decode = (s) => String(s || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
const clean = (s) => decode(s).replace(/\s+/g, " ").trim();
const attr = (tag, name) => { const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag); return m ? decode(m[1] ?? m[2] ?? m[3] ?? "") : null; };
const tags = (html, name) => html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) || [];
const head = (html) => { const m = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html); return m ? m[1] : html; };
const body = (html) => { const m = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html); return m ? m[1] : html; };

function metaContent(h, key, by = "name") {
  for (const t of tags(h, "meta")) { const k = attr(t, by); if (k && k.toLowerCase() === key.toLowerCase()) return attr(t, "content"); }
  return null;
}
function links(h, rel) {
  return tags(h, "link").filter((t) => (attr(t, "rel") || "").toLowerCase().split(/\s+/).includes(rel));
}
function textOf(html) {
  return clean(String(html).replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ").replace(/<[^>]+>/g, " "));
}
const wordCount = (s) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;

// ---------------------------------------------------------------------------
// The on-page audit. `kind` decides which rules apply: the app's routes
// share one HTML shell (the hash-routed site), so they get the technical
// checks only; the server-rendered pages get the content rules too.
// Returns { title, description, words, h1, canonical, issues, score, facts }.
// ---------------------------------------------------------------------------
export function auditHtml(html, { url, lang = "en", kind = "guide", status = 200 } = {}) {
  const src = String(html || "");
  const h = head(src), b = body(src);
  const issues = [];
  const add = (code, level, detail) => issues.push({ code, level, detail });
  const facts = {};

  if (status !== 200) { add("status", "error", `HTTP ${status}`); return { title: null, description: null, words: 0, issues, score: 0, facts }; }

  const titleM = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(h);
  const title = titleM ? clean(titleM[1]) : "";
  const description = clean(metaContent(h, "description") || "");
  const htmlTag = tags(src, "html")[0] || "";
  const langAttr = attr(htmlTag, "lang") || "";
  const canon = links(h, "canonical").map((t) => attr(t, "href")).filter(Boolean);
  const alts = links(h, "alternate").map((t) => ({ hreflang: (attr(t, "hreflang") || "").toLowerCase(), href: attr(t, "href") }));
  const h1s = (b.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi) || []).map((x) => textOf(x));
  const objs = [];
  const ld = (src.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || []);
  const og = { title: metaContent(h, "og:title", "property"), description: metaContent(h, "og:description", "property"), image: metaContent(h, "og:image", "property") };
  const imgs = tags(b, "img");
  const noAlt = imgs.filter((t) => attr(t, "alt") === null).length;
  const viewport = metaContent(h, "viewport");
  const robots = (metaContent(h, "robots") || "").toLowerCase();
  const anchors = tags(b, "a").map((t) => attr(t, "href") || "");
  let origin = null; try { origin = new URL(url).origin; } catch { origin = null; }
  const internal = anchors.filter((a) => a.startsWith("/") || (origin && a.startsWith(origin))).length;
  const words = wordCount(textOf(b));
  const isApp = kind === "app";

  // Title
  if (!title) add("title_missing", "error", "No <title>");
  else if (title.length < RULES.title[0]) add("title_short", "warn", `${title.length} characters; aim for ${RULES.title[0]}-${RULES.title[1]}`);
  else if (title.length > RULES.title[1]) add("title_long", "warn", `${title.length} characters; Google shows about ${RULES.title[1]} before cutting`);
  // Description
  if (!description) add("description_missing", "error", "No meta description");
  else if (description.length < RULES.description[0]) add("description_short", "warn", `${description.length} characters; aim for ${RULES.description[0]}-${RULES.description[1]}`);
  else if (description.length > RULES.description[1]) add("description_long", "warn", `${description.length} characters; cut to ${RULES.description[1]}`);
  // H1
  if (!isApp) {
    if (h1s.length === 0) add("h1_missing", "error", "No H1");
    else if (h1s.length > 1) add("h1_multiple", "warn", `${h1s.length} H1 headings`);
  }
  // Canonical
  if (!canon.length) add("canonical_missing", "error", "No canonical link");
  else if (canon.length > 1) add("canonical_multiple", "error", `${canon.length} canonical links`);
  else if (url && canon[0] !== url) add("canonical_other", isApp ? "info" : "warn", `Canonical points to ${canon[0]}`);
  // hreflang: the server-rendered pages come in an English and a Hindi version
  if (!isApp) {
    const codes = new Set(alts.map((a) => a.hreflang));
    const want = ["en-in", "hi-in", "x-default"].filter((c) => !codes.has(c));
    if (want.length) add("hreflang_missing", "warn", `Missing hreflang ${want.join(", ")}`);
    const self = alts.find((a) => a.hreflang === (lang === "hi" ? "hi-in" : "en-in"));
    if (self && url && self.href !== url) add("hreflang_self", "warn", `hreflang for this language points to ${self.href}`);
  }
  // Structured data
  if (!ld.length) add("jsonld_missing", isApp ? "info" : "warn", "No JSON-LD structured data");
  else {
    const types = [];
    for (const s of ld) {
      const inner = s.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "");
      try { const j = JSON.parse(inner); for (const o of Array.isArray(j) ? j : [j]) if (o && o["@type"]) { types.push(String(o["@type"])); objs.push(o); } }
      catch { add("jsonld_invalid", "error", "JSON-LD does not parse"); }
    }
    facts.schema = types;
    const missing = schemaProblems(objs);
    if (missing.length) add("schema_incomplete", "warn", missing.slice(0, 4).join("; "));
  }
  // Open Graph
  if (!og.title || !og.description) add("og_missing", "warn", "Open Graph title or description missing");
  if (!og.image) add("og_image_missing", "info", "No og:image; shares show no picture");
  // Technical
  if (!langAttr) add("lang_missing", "warn", "No lang attribute on <html>");
  else if (!langAttr.toLowerCase().startsWith(lang)) add("lang_mismatch", "warn", `lang="${langAttr}" on a ${lang} page`);
  if (!viewport) add("viewport_missing", "error", "No viewport meta: fails mobile-first indexing");
  if (/noindex/.test(robots)) add("noindex", "error", "robots noindex: this page will not be indexed");
  if (noAlt) add("img_alt", "warn", `${noAlt} image${noAlt === 1 ? "" : "s"} without alt text`);
  // Content
  const need = RULES.words[kind] || 0;
  if (need && words < need) add("thin", "warn", `${words} words; aim for at least ${need}`);
  if (!isApp && internal < 3) add("links_few", "info", `${internal} internal links; add related pages`);
  if (!isApp && title && h1s[0] && !similar(title, h1s[0])) add("title_h1_differ", "info", "Title and H1 say different things");

  facts.h1 = h1s[0] || null;
  facts.canonical = canon[0] || null;
  facts.hreflang = alts.length;
  facts.internal_links = internal;
  facts.images = imgs.length;
  facts.og = !!(og.title && og.description);
  facts.og_image = !!og.image;
  facts.lang = langAttr || null;
  facts.out = internalPaths(anchors, origin);
  facts.official = anchors.filter(isOfficial).length;
  if (!isApp) facts.geo = geoChecks({ b, objs, words, kind, official: facts.official });
  return { title: title || null, description: description || null, words, issues, score: scoreOf(issues), facts };
}

function similar(a, b) {
  const w = (s) => new Set(String(s).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
  const A = w(a), B = w(b);
  let hit = 0;
  for (const x of B) if (A.has(x)) hit++;
  return B.size === 0 || hit / B.size >= 0.4;
}

// The site's own paths a page links to (no query, no hash, no /api), for
// the link graph: broken internal links and orphan pages.
export function internalPaths(anchors, origin) {
  const out = new Set();
  for (const a of anchors || []) {
    if (!a || a.startsWith("#") || a.startsWith("//") || /^(mailto|tel|javascript):/i.test(a)) continue;
    let path = null;
    if (a.startsWith("/")) path = a;
    else if (origin && a.startsWith(origin)) path = a.slice(origin.length) || "/";
    if (!path) continue;
    path = path.split("#")[0].split("?")[0] || "/";
    if (path.startsWith("/api/")) continue;
    if (path.length > 1) path = path.replace(/\/+$/, "");
    out.add(path);
    if (out.size >= 150) break;
  }
  return [...out];
}

// Links to official government sources (what an answer engine trusts most).
export const isOfficial = (href) => /^https?:\/\/([a-z0-9-]+\.)*(gov\.in|nic\.in|gov|india\.gov\.in)(\/|$|:)/i.test(String(href || ""));

// Required properties per schema.org type, the way Google's rich-result
// rules and answer engines read them.
const REQUIRED = {
  FAQPage: (o) => Array.isArray(o.mainEntity) && o.mainEntity.length && o.mainEntity.every((q) => q && q.name && q.acceptedAnswer && q.acceptedAnswer.text) ? null : "FAQPage needs questions with answers",
  HowTo: (o) => o.name && Array.isArray(o.step) && o.step.length ? null : "HowTo needs a name and steps",
  BreadcrumbList: (o) => Array.isArray(o.itemListElement) && o.itemListElement.length && o.itemListElement.every((i) => i && i.position && i.name && i.item) ? null : "BreadcrumbList items need position, name and item",
  BlogPosting: (o) => o.headline && o.datePublished && o.author && o.publisher ? null : "BlogPosting needs headline, datePublished, author and publisher",
  NewsArticle: (o) => o.headline && o.datePublished && o.author && o.publisher ? null : "NewsArticle needs headline, datePublished, author and publisher",
  Article: (o) => o.headline && o.datePublished && o.author ? null : "Article needs headline, datePublished and author",
  Organization: (o) => o.name && o.url ? null : "Organization needs name and url",
  WebSite: (o) => o.name && o.url ? null : "WebSite needs name and url"
};
export function schemaProblems(objs) {
  const out = [];
  for (const o of objs || []) { const f = REQUIRED[o && o["@type"]]; const m = f ? f(o) : null; if (m && !out.includes(m)) out.push(m); }
  return out;
}

// GEO readiness: what makes a page easy for an answer engine to quote and
// cite. Each check is pass/fail; the score is the share passed.
export const GEO_CHECKS = {
  answer: "Direct answer right under the heading",
  structured: "Structured data answer engines read (FAQ, HowTo, Article)",
  dated: "Dated, so freshness is visible",
  sources: "Cites official sources",
  questions: "Question-style headings",
  publisher: "Publisher identity (Organization)",
  depth: "Enough substance to quote"
};
export function geoChecks({ b = "", objs = [], words = 0, kind = "guide", official = 0 } = {}) {
  const after = b.split(/<\/h1>/i)[1] || "";
  const lead = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(after);
  const leadText = lead ? textOf(lead[1]) : "";
  const types = objs.map((o) => String(o["@type"] || ""));
  const heads = (b.match(/<(h2|h3|summary)\b[^>]*>[\s\S]*?<\/\1>/gi) || []).map((x) => textOf(x));
  const dated = objs.some((o) => o.dateModified || o.datePublished) || /<time\b[^>]*datetime=/i.test(b);
  const need = kind === "blog" || kind === "guide" ? 300 : 120;
  const checks = {
    answer: leadText.length >= 30 && leadText.length <= 320,
    structured: types.some((t) => ["FAQPage", "HowTo", "BlogPosting", "NewsArticle", "Article", "CollectionPage", "WebPage", "Blog"].includes(t)),
    dated,
    sources: kind === "index" ? true : official >= (kind === "guide" ? 2 : 1),
    questions: kind === "guide" || kind === "blog" ? heads.some((x) => /[?？]\s*$/.test(x)) : true,
    publisher: objs.some((o) => o["@type"] === "Organization" && o.name && o.url),
    depth: words >= need
  };
  const keys = Object.keys(checks);
  return { score: Math.round(keys.filter((k) => checks[k]).length / keys.length * 100), missing: keys.filter((k) => !checks[k]) };
}

export const WEIGHT = { error: 25, warn: 8, info: 2 };
export function scoreOf(issues) {
  let s = 100;
  for (const i of issues || []) s -= WEIGHT[i.level] || 0;
  return Math.max(0, Math.min(100, s));
}

// Issue codes explained for the desk, with what the fix is.
export const ISSUE_TEXT = {
  status: "The page did not answer 200",
  title_missing: "Missing title", title_short: "Title too short", title_long: "Title too long",
  description_missing: "Missing meta description", description_short: "Description too short", description_long: "Description too long",
  h1_missing: "No H1 heading", h1_multiple: "More than one H1",
  canonical_missing: "No canonical", canonical_multiple: "Several canonicals", canonical_other: "Canonical points elsewhere",
  hreflang_missing: "hreflang incomplete", hreflang_self: "hreflang self link wrong",
  jsonld_missing: "No structured data", jsonld_invalid: "Structured data does not parse",
  og_missing: "Open Graph incomplete", og_image_missing: "No share image",
  lang_missing: "No lang attribute", lang_mismatch: "lang attribute mismatch",
  viewport_missing: "No viewport meta", noindex: "Page is noindex",
  img_alt: "Images without alt text", thin: "Thin content", links_few: "Few internal links",
  title_h1_differ: "Title and H1 differ", duplicate_title: "Duplicate title", duplicate_description: "Duplicate description",
  schema_incomplete: "Structured data incomplete", broken_link: "Links to a missing page", orphan: "No page links here"
};

// Duplicates across the stored pages: computed on read, not stored, so a
// fixed page clears the other one too. The app's routes share one shell by
// design and are left out.
export function duplicates(rows) {
  const byTitle = new Map(), byDesc = new Map();
  for (const r of rows || []) {
    if (r.kind === "app" || r.status !== 200) continue;
    if (r.title) { const k = r.title.toLowerCase(); byTitle.set(k, (byTitle.get(k) || []).concat(r.url)); }
    if (r.description) { const k = r.description.toLowerCase(); byDesc.set(k, (byDesc.get(k) || []).concat(r.url)); }
  }
  const out = new Map();
  const mark = (map, code) => { for (const [, urls] of map) if (urls.length > 1) for (const u of urls) out.set(u, (out.get(u) || []).concat({ code, level: "warn", detail: `Same as ${urls.length - 1} other page${urls.length > 2 ? "s" : ""}` })); };
  mark(byTitle, "duplicate_title");
  mark(byDesc, "duplicate_description");
  return out;
}

// ---------------------------------------------------------------------------
// Fetching with a deadline.
// ---------------------------------------------------------------------------
async function getPage(url, fetchImpl, timeoutMs = PAGE_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const r = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: ctrl.signal });
    const html = await r.text();
    return { status: Number(r.status) || 0, html, ms: Date.now() - t0, final: r.url || url };
  } catch (e) {
    return { status: 0, html: "", ms: Date.now() - t0, error: String(e && e.message || e).slice(0, 120) };
  } finally { clearTimeout(timer); }
}

async function inBatches(items, n, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(...await Promise.all(items.slice(i, i + n).map(fn)));
  return out;
}

// ---------------------------------------------------------------------------
// Cron step: audit the least-recently-checked pages and store the rows.
// ---------------------------------------------------------------------------
export async function seoStep(sb, env, { fetch: fetchImpl = null, posts = null, limit = PAGES_PER_RUN, now = Date.now() } = {}) {
  const out = { total: 0, checked: 0, avg_score: null, errors: 0, remaining: 0 };
  const site = siteUrl(env);
  const all = pageList(posts || [], site);
  out.total = all.length;
  if (!fetchImpl) { out.skipped = "no_fetch"; return out; }
  const { data: known, error } = await sb.from("seo_pages").select("url, checked_at");
  if (error) throw new Error(`seo_pages select: ${error.message || error}`);
  const when = new Map((known || []).map((r) => [r.url, r.checked_at ? Date.parse(r.checked_at) : 0]));
  const queue = all.slice().sort((a, b) => (when.get(a.url) || 0) - (when.get(b.url) || 0)).slice(0, limit);
  out.remaining = Math.max(0, all.length - queue.length);
  const checkedAt = new Date(now).toISOString();
  const rows = await inBatches(queue, PAGE_CONCURRENCY, async (p) => {
    const r = await getPage(p.url, fetchImpl);
    const a = auditHtml(r.html, { url: p.url, lang: p.lang, kind: p.kind, status: r.status });
    if (r.error) a.issues.unshift({ code: "status", level: "error", detail: r.error });
    return { url: p.url, path: p.path, lang: p.lang, kind: p.kind, status: r.status, ms: r.ms, title: a.title, description: a.description, words: a.words, score: a.score, issues: a.issues, facts: a.facts, checked_at: checkedAt };
  });
  if (rows.length) {
    const { error: ue } = await sb.from("seo_pages").upsert(rows, { onConflict: "url" });
    if (ue) throw new Error(`seo_pages upsert: ${ue.message || ue}`);
  }
  // Internal links to paths outside the sitemap: check the least recently
  // checked ones (a page linking to a missing page is a broken link).
  try { out.links = await linkCheck(sb, rows, all, fetchImpl, site, now); } catch (e) { console.error("seo link check failed", e); out.links = { error: String(e && e.message || e).slice(0, 120) }; }
  try { out.site = await siteChecks(sb, env, fetchImpl, now); } catch (e) { console.error("seo site checks failed", e); out.site = { error: String(e && e.message || e).slice(0, 120) }; }
  // Pages that left the sitemap (an unpublished post) are dropped.
  const live = new Set(all.map((p) => p.url));
  const gone = (known || []).map((r) => r.url).filter((u) => !live.has(u));
  if (gone.length) { const { error: de } = await sb.from("seo_pages").delete().in("url", gone.slice(0, 200)); if (de) console.error("seo_pages cleanup failed", de); }
  out.checked = rows.length;
  out.errors = rows.filter((r) => r.status !== 200).length;
  out.avg_score = rows.length ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length) : null;
  return out;
}

// ---------------------------------------------------------------------------
// The link crawl. Paths the app serves without being in the sitemap (its own
// views and static files) are known good; anything else a page links to is
// fetched and its status kept in seo_links.
// ---------------------------------------------------------------------------
export const LINKS_PER_RUN = 25;
const APP_VIEWS = /^\/(report|track|directory|rights|who|wards|charter|dashboard|updates|join|about|accessibility|privacy|map|desk|r|fix|news|pulse)(\/[^/]+)?$/;
const STATIC_FILES = /^\/(styles\.css|app\.js|data\.js|boot\.js|embed\.js|sw\.js|favicon\.svg|og\.png|icon-(192|512)\.png|manifest\.webmanifest|robots\.txt|sitemap\.xml|llms\.txt|llms-full\.txt|indexnow-key\.txt)$/;
export function unknownTargets(rows, sitemapPaths) {
  const known = new Set(sitemapPaths);
  const out = new Set();
  for (const r of rows || []) for (const p of (r.facts && r.facts.out) || []) {
    if (known.has(p) || APP_VIEWS.test(p) || STATIC_FILES.test(p) || p === "/" || p === "/hi") continue;
    out.add(p);
  }
  return [...out];
}

async function linkCheck(sb, rows, all, fetchImpl, site, now) {
  const targets = unknownTargets(rows, all.map((p) => p.path));
  if (!targets.length) return { targets: 0, checked: 0, broken: 0 };
  const { data, error } = await sb.from("seo_links").select("url, checked_at");
  if (error) throw new Error(`seo_links select: ${error.message || error}`);
  const when = new Map((data || []).map((r) => [r.url, Date.parse(r.checked_at) || 0]));
  const queue = targets.sort((a, b) => (when.get(a) || 0) - (when.get(b) || 0)).slice(0, LINKS_PER_RUN);
  const checked = await inBatches(queue, PAGE_CONCURRENCY, async (path) => {
    const r = await getPage(site + path, fetchImpl);
    return { url: path, status: r.status, ok: r.status >= 200 && r.status < 400, checked_at: new Date(now).toISOString() };
  });
  const { error: ue } = await sb.from("seo_links").upsert(checked, { onConflict: "url" });
  if (ue) throw new Error(`seo_links upsert: ${ue.message || ue}`);
  return { targets: targets.length, checked: checked.length, broken: checked.filter((x) => !x.ok).length };
}

// On read: inbound links per page, orphans and broken links with the pages
// that carry them. Orphans only count once the whole sitemap has been
// audited (`complete`), or every page not yet crawled would look orphaned.
export function linkGraph(pages, linkRows = [], { complete = false } = {}) {
  const inbound = new Map();
  for (const p of pages || []) for (const t of (p.facts && p.facts.out) || []) if (t !== p.path) inbound.set(t, (inbound.get(t) || 0) + 1);
  const orphans = complete ? (pages || []).filter((p) => p.kind !== "app" && p.status === 200 && !inbound.get(p.path) && p.path !== "/").map((p) => p.path) : [];
  const broken = (linkRows || []).filter((l) => l.ok === false).map((l) => ({ url: l.url, status: l.status, sources: (pages || []).filter((p) => ((p.facts && p.facts.out) || []).includes(l.url)).map((p) => p.path).slice(0, 10) }));
  return { inbound: Object.fromEntries(inbound), orphans, broken };
}

// ---------------------------------------------------------------------------
// Site-wide checks, stored one row per key in seo_site.
// ---------------------------------------------------------------------------
async function probe(url, fetchImpl, { redirect = "follow", timeoutMs = PAGE_TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT }, redirect, signal: ctrl.signal });
    const get = (k) => (r.headers && typeof r.headers.get === "function" ? r.headers.get(k) : null);
    const text = redirect === "manual" ? "" : await r.text().catch(() => "");
    return { status: Number(r.status) || 0, get, text };
  } catch (e) {
    return { status: 0, get: () => null, text: "", error: String(e && e.message || e).slice(0, 100) };
  } finally { clearTimeout(timer); }
}

export function judgeSite({ robots, sitemap, llms, home, www, http, host }) {
  const rows = [];
  const add = (key, ok, detail, data = {}) => rows.push({ key, ok: !!ok, detail, data });
  const rb = robots.text || "";
  const bots = ["GPTBot", "OAI-SearchBot", "PerplexityBot", "ClaudeBot", "Google-Extended"].filter((b) => rb.includes(`User-agent: ${b}`));
  const blocksAll = /User-agent:\s*\*\s*\n(?:[^\n]*\n)*?Disallow:\s*\/\s*(\n|$)/i.test(rb);
  add("robots", robots.status === 200 && /Sitemap:/i.test(rb) && !blocksAll, robots.status !== 200 ? `robots.txt answered ${robots.status || robots.error}` : blocksAll ? "robots.txt blocks the whole site" : `Sitemap named; ${bots.length} AI crawlers welcomed by name`, { ai_bots: bots });
  const urls = (sitemap.text.match(/<url>/g) || []).length;
  add("sitemap", sitemap.status === 200 && urls > 0, sitemap.status === 200 ? `${urls} URLs listed` : `sitemap.xml answered ${sitemap.status || sitemap.error}`, { urls });
  const llmsOk = llms.status === 200 && /^# /.test(llms.text || "");
  add("llms", llmsOk, llmsOk ? `${(llms.text.match(/\]\(/g) || []).length} links for AI engines` : `llms.txt answered ${llms.status || llms.error}`);
  const hdr = { hsts: !!home.get("strict-transport-security"), csp: !!home.get("content-security-policy"), nosniff: (home.get("x-content-type-options") || "").includes("nosniff"), frame: !!home.get("x-frame-options") || /frame-ancestors/.test(home.get("content-security-policy") || "") };
  const missing = Object.keys(hdr).filter((k) => !hdr[k]);
  add("headers", home.status === 200 && !missing.length, missing.length ? `Missing: ${missing.join(", ")}` : "HSTS, CSP, nosniff and framing rules set", hdr);
  const loc = (r) => r.get("location") || "";
  add("www", www.status >= 300 && www.status < 400 && loc(www).includes(host) && !loc(www).includes("www."), www.status >= 300 && www.status < 400 ? `www answers ${www.status} to ${loc(www)}` : `www answered ${www.status || www.error}`);
  add("https", http.status >= 300 && http.status < 400 && loc(http).startsWith("https://"), http.status >= 300 && http.status < 400 ? `http answers ${http.status} to https` : `http answered ${http.status || http.error}`);
  return rows;
}

export async function siteChecks(sb, env, fetchImpl, now = Date.now()) {
  const site = siteUrl(env);
  let host = ""; try { host = new URL(site).host; } catch { host = ""; }
  const [robots, sitemap, llms, home, www, http] = await Promise.all([
    probe(site + "/robots.txt", fetchImpl), probe(site + "/sitemap.xml", fetchImpl), probe(site + "/llms.txt", fetchImpl), probe(site + "/", fetchImpl),
    probe(`https://www.${host}/`, fetchImpl, { redirect: "manual" }), probe(`http://${host}/`, fetchImpl, { redirect: "manual" })
  ]);
  const rows = judgeSite({ robots, sitemap, llms, home, www, http, host }).map((r) => ({ ...r, checked_at: new Date(now).toISOString() }));
  const { error } = await sb.from("seo_site").upsert(rows, { onConflict: "key" });
  if (error) throw new Error(`seo_site upsert: ${error.message || error}`);
  return { checked: rows.length, failing: rows.filter((r) => !r.ok).map((r) => r.key) };
}

// ---------------------------------------------------------------------------
// Core Web Vitals through PageSpeed Insights (free with a key; without one
// the call shares an anonymous daily allowance that is usually spent).
// ---------------------------------------------------------------------------
export function parseVitals(json, { url, strategy = "mobile" } = {}) {
  const lr = json && json.lighthouseResult;
  if (!lr) return null;
  const cat = lr.categories || {}, au = lr.audits || {};
  const pct = (c) => (c && Number.isFinite(c.score) ? Math.round(c.score * 100) : null);
  const num = (k) => (au[k] && Number.isFinite(au[k].numericValue) ? au[k].numericValue : null);
  const ms = (k) => { const v = num(k); return v == null ? null : Math.round(v); };
  const cls = num("cumulative-layout-shift");
  return {
    url, strategy,
    performance: pct(cat.performance), seo: pct(cat.seo), accessibility: pct(cat.accessibility), best_practices: pct(cat["best-practices"]),
    lcp_ms: ms("largest-contentful-paint"), cls: cls == null ? null : Math.round(cls * 1000) / 1000, tbt_ms: ms("total-blocking-time"), fcp_ms: ms("first-contentful-paint"), speed_index_ms: ms("speed-index")
  };
}

export async function vitalsStep(sb, env, { fetch: fetchImpl = null, limit = VITALS_PER_RUN, now = Date.now(), pages = VITALS_PAGES } = {}) {
  const out = { checked: 0, failed: 0 };
  if (!fetchImpl) { out.skipped = "no_fetch"; return out; }
  const site = siteUrl(env);
  const { data: last, error } = await sb.from("seo_vitals").select("url, checked_at").order("checked_at", { ascending: false }).limit(200);
  if (error) throw new Error(`seo_vitals select: ${error.message || error}`);
  const when = new Map();
  for (const r of last || []) if (!when.has(r.url)) when.set(r.url, Date.parse(r.checked_at) || 0);
  const queue = pages.map((p) => site + p).sort((a, b) => (when.get(a) || 0) - (when.get(b) || 0)).slice(0, limit);
  for (const url of queue) {
    const q = new URLSearchParams({ url, strategy: "mobile" });
    for (const c of ["performance", "seo", "accessibility", "best-practices"]) q.append("category", c);
    if (env.PAGESPEED_API_KEY) q.set("key", env.PAGESPEED_API_KEY);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), VITALS_TIMEOUT_MS);
    try {
      const r = await fetchImpl(`${PSI_URL}?${q}`, { signal: ctrl.signal });
      const j = await r.json().catch(() => null);
      const row = r.ok ? parseVitals(j, { url }) : null;
      if (!row) {
        out.failed++;
        // 429 is Google's daily quota: without a key every caller shares one
        // anonymous allowance, which is usually spent. The desk tells the
        // owner to add the free PAGESPEED_API_KEY.
        out.reason = r.status === 429 ? (env.PAGESPEED_API_KEY ? "quota" : "no_key_quota") : `http_${r.status}`;
        console.error("pagespeed failed", url, r.status, j && j.error && j.error.message);
        continue;
      }
      const { error: ie } = await sb.from("seo_vitals").insert({ ...row, checked_at: new Date(now).toISOString() });
      if (ie) throw new Error(`seo_vitals insert: ${ie.message || ie}`);
      out.checked++;
    } catch (e) {
      if (/seo_vitals insert/.test(String(e && e.message))) throw e;
      out.failed++; console.error("pagespeed failed", url, e && e.message);
    } finally { clearTimeout(timer); }
  }
  const cutoff = new Date(now - 180 * DAY).toISOString();
  const { error: de } = await sb.from("seo_vitals").delete().lt("checked_at", cutoff);
  if (de) console.error("seo_vitals cleanup failed", de);
  return out;
}

// ---------------------------------------------------------------------------
// Mentions: the Forum's name in the news.
// ---------------------------------------------------------------------------
export const mentionSearchUrl = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;

export async function mentionsStep(sb, env, { fetch: fetchImpl = null, queries = MENTION_QUERIES, now = Date.now() } = {}) {
  const out = { found: 0, new: 0 };
  if (!fetchImpl) { out.skipped = "no_fetch"; return out; }
  const site = siteUrl(env);
  let host = ""; try { host = new URL(site).host; } catch { host = ""; }
  const rows = new Map();
  for (const q of queries) {
    const url = mentionSearchUrl(q);
    const r = await getPage(url, fetchImpl);
    if (r.status !== 200 || !r.html) continue;
    for (const item of parseRss(r.html, url)) {
      if (host && item.url.includes(host)) continue;
      if (!rows.has(item.url)) rows.set(item.url, { url: item.url, title: item.title, source: sourceOf(item.title), published_at: item.published_at, fetched_at: new Date(now).toISOString() });
    }
  }
  out.found = rows.size;
  if (rows.size) {
    const { data: ins, error } = await sb.from("seo_mentions").upsert([...rows.values()], { onConflict: "url", ignoreDuplicates: true }).select("id");
    if (error) throw new Error(`seo_mentions upsert: ${error.message || error}`);
    out.new = Array.isArray(ins) ? ins.length : 0;
  }
  return out;
}

// Google News titles end with " - Publisher".
export function sourceOf(title) {
  const m = / [-–] ([^-–]{2,60})$/.exec(String(title || ""));
  return m ? m[1].trim() : null;
}

// ---------------------------------------------------------------------------
// Content opportunities: what the city discussed in the last fortnight
// (public signals only) set against what the site published; the gaps are
// the next posts to write, each with a page to point it at.
// ---------------------------------------------------------------------------
export function opportunities(signals, posts, { now = Date.now(), days = OPPORTUNITY_DAYS, cats = null } = {}) {
  const G = cats ? { CATS: cats } : gvf();
  const name = new Map((G.CATS || []).map((c) => [c.id, c.label || c.name || c.id]));
  const since = now - days * DAY;
  const groups = new Map();
  for (const s of signals || []) {
    const t = Date.parse(s.posted_at || 0) || 0;
    if (t < since || !s.issue_type || s.issue_type === "other") continue;
    const k = `${s.issue_type}|${s.area || ""}`;
    const g = groups.get(k) || { issue_type: s.issue_type, area: s.area || null, n: 0, examples: [] };
    g.n++;
    if (g.examples.length < 2 && s.title) g.examples.push({ title: s.title, url: s.url });
    groups.set(k, g);
  }
  const covered = (g) => (posts || []).some((p) => {
    const t = Date.parse(p.published_at || p.created_at || 0) || 0;
    if (t < since - 14 * DAY) return false;
    const hay = `${p.title || ""} ${p.summary || ""} ${(p.tags || []).join(" ")}`.toLowerCase();
    // "Roads, footpaths" covers a post that names either; the issue id counts too (tags).
    const terms = String(name.get(g.issue_type) || "").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean).concat(g.issue_type);
    return terms.some((t) => hay.includes(t)) && (!g.area || hay.includes(String(g.area).toLowerCase()));
  });
  return [...groups.values()]
    .filter((g) => g.n >= 2 && !covered(g))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8)
    .map((g) => {
      const issue = name.get(g.issue_type) || g.issue_type;
      const where = g.area ? ` in ${g.area}` : " in Gurugram";
      return {
        issue_type: g.issue_type, area: g.area, mentions: g.n,
        title: `${issue}${where}: what residents are reporting and where to file it`,
        target: `/guide/${g.issue_type}`,
        why: `${g.n} public posts in ${days} days, nothing published on it`,
        examples: g.examples
      };
    });
}

// ---------------------------------------------------------------------------
// The standing checklist: what is in place, proved by the audit rows where
// it can be, with the two things only a person can do (register the site
// with Search Console and Bing Webmaster Tools) ticked from the desk.
// ---------------------------------------------------------------------------
export function checklist({ env = {}, settings = {}, pages = [], vitals = null, vitalsReason = null, links = null, autopost = null, mentions = 0 } = {}) {
  const rendered = pages.filter((p) => p.kind !== "app" && p.status === 200);
  const has = (code) => rendered.some((p) => (p.issues || []).some((i) => i.code === code));
  const all = (fn) => rendered.length > 0 && rendered.every(fn);
  const seo = settings.seo || {};
  const items = [];
  const item = (key, title, ok, detail, auto = true, setting = null) => items.push({ key, title, ok: ok === null ? null : !!ok, detail, auto, ...(setting ? { setting } : {}) });
  item("https", "HTTPS with HSTS", true, "Vercel issues the certificate; HSTS preload header set for every response");
  item("mobile", "Mobile-first: viewport on every page", rendered.length ? !has("viewport_missing") : null, rendered.length ? `${rendered.length} rendered pages checked` : "Waiting for the first audit");
  item("titles", "Unique titles and descriptions", rendered.length ? !has("title_missing") && !has("description_missing") && !has("duplicate_title") : null, rendered.length ? "Each guide, ward and post page writes its own" : "Waiting for the first audit");
  item("canonical", "Self-referencing canonical", rendered.length ? all((p) => !(p.issues || []).some((i) => i.code.startsWith("canonical"))) : null, "Keeps /hi and query variants from splitting rank");
  item("hreflang", "hreflang en-IN / hi-IN / x-default", rendered.length ? !has("hreflang_missing") && !has("hreflang_self") : null, "Both languages are declared as one pair");
  item("schema", "Structured data (JSON-LD)", rendered.length ? !has("jsonld_missing") && !has("jsonld_invalid") : null, "Organization, FAQ and Article markup on the rendered pages");
  item("og", "Open Graph for shares", rendered.length ? !has("og_missing") : null, "Title, description and image for WhatsApp, Facebook and X previews");
  item("sitemap", "XML sitemap with lastmod", true, "/sitemap.xml lists every page in both languages; submitted to Search Console");
  item("robots", "robots.txt", true, "Allows every public page, names the sitemap, keeps /api and the desk out");
  item("indexnow", "IndexNow ping (Bing, Yandex, Naver, Seznam)", !!env.INDEXNOW_KEY && seo.indexnow !== false, env.INDEXNOW_KEY ? (seo.indexnow !== false ? "New posts and the daily pages are pinged every morning" : "Switched off in Content settings") : "Add INDEXNOW_KEY in Vercel");
  item("links", "Nightly official-link check", links ? !links.broken : null, links ? `${links.total} links checked ${links.checked_at ? "on " + links.checked_at.slice(0, 10) : ""}${links.broken ? `; ${links.broken} broken` : ""}` : "No link run yet");
  item("content", "Fresh content: weekly data round-up", autopost ? autopost.enabled !== false : null, autopost ? (autopost.enabled !== false ? "Drafted from the pulse every week, published after review" : "Switched off in Content settings") : "Setting not read");
  item("vitals", "Core Web Vitals (mobile)", vitals ? (vitals.performance ?? 0) >= 70 && (vitals.lcp_ms == null || vitals.lcp_ms <= 2500) : null, vitals ? `Performance ${vitals.performance ?? "?"}, LCP ${vitals.lcp_ms != null ? (vitals.lcp_ms / 1000).toFixed(1) + " s" : "?"} on ${vitals.url}` : vitalsReason === "no_key_quota" ? "Google refused the call: add the free PAGESPEED_API_KEY in Vercel" : vitalsReason === "quota" ? "PageSpeed quota spent for today; it retries tonight" : env.PAGESPEED_API_KEY ? "Waiting for the first PageSpeed run" : "Waiting for the first PageSpeed run; add the free PAGESPEED_API_KEY in Vercel");
  item("thin", "No thin pages", rendered.length ? !has("thin") : null, rendered.length ? "Every rendered page carries enough words to answer a search" : "Waiting for the first audit");
  item("gsc", "Google Search Console verified", !!seo.gsc_verified, seo.gsc_verified ? "Domain property verified; sitemap submitted" : "Tick once the domain is verified", false, "gsc_verified");
  item("bing", "Bing Webmaster Tools verified", !!seo.bing_verified, seo.bing_verified ? "Imported from Search Console" : "Free: import the site from Search Console at bing.com/webmasters", false, "bing_verified");
  item("mentions", "Off-page: the Forum in the news", mentions > 0, mentions ? `${mentions} mention${mentions === 1 ? "" : "s"} found by Google News` : "None found yet; every mention is a link opportunity");
  return items;
}
