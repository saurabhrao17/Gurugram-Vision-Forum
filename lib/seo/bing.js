// Bing Webmaster Tools data for the SEO desk (cron step `bing`): queries
// and pages over the last 28 days and Bing's crawl and index counts. Bing
// also feeds Copilot and DuckDuckGo, so this is the second search view.
// Auth is the account's API key (Bing Webmaster Tools → Settings → API
// access), BING_WEBMASTER_API_KEY. The site URL Bing knows the property by
// is looked up with GetUserSites (an imported Search Console domain can be
// registered as http or https, with or without the trailing slash).
// Read-only calls only.
import { siteUrl } from "./site.js";

export const BING_API = "https://ssl.bing.com/webmaster/api.svc/json/";
export const WINDOW_DAYS = 28;
const DAY = 86400000;
const TIMEOUT_MS = 15000;

// "/Date(1316156400000-0700)/" -> ms
export function bingDate(s) {
  const m = /\/Date\((-?\d+)([+-]\d{4})?\)\//.exec(String(s || ""));
  return m ? Number(m[1]) : (Date.parse(s) || 0);
}

async function bing(fetchImpl, method, params, key) {
  const q = new URLSearchParams({ ...params, apikey: key });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetchImpl(`${BING_API}${method}?${q}`, { headers: { accept: "application/json" }, signal: ctrl.signal });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${method} ${r.status} ${(j && (j.Message || j.ErrorCode)) || ""}`.trim().slice(0, 160));
    return j && "d" in j ? j.d : j;
  } finally { clearTimeout(timer); }
}

// The registered site URL that matches our host, verified sites first.
export function pickSite(list, host) {
  const sites = (Array.isArray(list) ? list : []).filter((s) => s && s.Url);
  const mine = sites.filter((s) => { try { return new URL(s.Url).host.replace(/^www\./, "") === host.replace(/^www\./, ""); } catch { return false; } });
  mine.sort((a, b) => (b.IsVerified ? 1 : 0) - (a.IsVerified ? 1 : 0) || (b.Url.startsWith("https") ? 1 : 0) - (a.Url.startsWith("https") ? 1 : 0));
  return mine[0] ? mine[0].Url : null;
}

// Daily rows -> 28-day totals per key (impression-weighted position).
export function sumStats(rows, dim, { now = Date.now(), site = "" } = {}) {
  const since = now - WINDOW_DAYS * DAY;
  const by = new Map();
  let first = Infinity, last = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    const t = bingDate(r.Date);
    if (t && t < since) continue;
    let key = String(r.Query || "");
    if (dim === "page" && site) { const base = site.replace(/\/+$/, ""); if (key.startsWith(base)) key = key.slice(base.length) || "/"; }
    if (!key) continue;
    const a = by.get(key) || { clicks: 0, impressions: 0, posw: 0 };
    a.clicks += Number(r.Clicks) || 0;
    a.impressions += Number(r.Impressions) || 0;
    a.posw += (Number(r.AvgImpressionPosition) || 0) * (Number(r.Impressions) || 0);
    by.set(key, a);
    if (t) { first = Math.min(first, t); last = Math.max(last, t); }
  }
  const end = new Date(last || now).toISOString().slice(0, 10);
  const start = new Date(Number.isFinite(first) ? first : now - WINDOW_DAYS * DAY).toISOString().slice(0, 10);
  return [...by.entries()].map(([key, a]) => ({ source: "bing", dim, key: key.slice(0, 500), clicks: a.clicks, impressions: a.impressions, ctr: a.impressions ? Math.round(a.clicks / a.impressions * 10000) / 10000 : null, position: a.impressions ? Math.round(a.posw / a.impressions * 100) / 100 : null, period_start: start, period_end: end }))
    .sort((x, y) => y.impressions - x.impressions).slice(0, 100);
}

export function crawlRow(rows, now = Date.now()) {
  const list = (Array.isArray(rows) ? rows : []).slice().sort((a, b) => bingDate(b.Date) - bingDate(a.Date));
  const x = list[0];
  if (!x) return { key: "bing_crawl", ok: null, detail: "Bing has not reported a crawl yet", data: {}, checked_at: new Date(now).toISOString() };
  const errs = (Number(x.CrawlErrors) || 0) + (Number(x.Code4xx) || 0) + (Number(x.Code5xx) || 0);
  const data = { date: new Date(bingDate(x.Date)).toISOString().slice(0, 10), crawled: Number(x.CrawledPages) || 0, in_index: Number(x.InIndex) || 0, in_links: Number(x.InLinks) || 0, errors: Number(x.CrawlErrors) || 0, code4xx: Number(x.Code4xx) || 0, code5xx: Number(x.Code5xx) || 0, blocked: Number(x.BlockedByRobotsTxt) || 0 };
  return { key: "bing_crawl", ok: errs === 0, detail: `${data.in_index} pages in Bing's index, ${data.crawled} crawled on ${data.date}${errs ? `, ${errs} errors` : ""}`, data, checked_at: new Date(now).toISOString() };
}

export async function bingStep(sb, env, { fetch: fetchImpl = null, now = Date.now() } = {}) {
  const out = { site: null, queries: 0, pages: 0, crawl: null };
  const key = env && env.BING_WEBMASTER_API_KEY;
  if (!key) { out.skipped = "no_key"; return out; }
  if (!fetchImpl) { out.skipped = "no_fetch"; return out; }
  const origin = siteUrl(env);
  let host = ""; try { host = new URL(origin).host; } catch { host = ""; }
  const site = pickSite(await bing(fetchImpl, "GetUserSites", {}, key), host);
  if (!site) { out.skipped = "site_not_in_account"; return out; }
  out.site = site;
  const errors = [];
  for (const [method, dim] of [["GetQueryStats", "query"], ["GetPageStats", "page"]]) {
    try {
      const rows = sumStats(await bing(fetchImpl, method, { siteUrl: site }, key), dim, { now, site });
      if (rows.length) { const { error } = await sb.from("seo_search").upsert(rows, { onConflict: "source,dim,key,period_end" }); if (error) throw new Error(`seo_search upsert: ${error.message || error}`); }
      out[dim === "query" ? "queries" : "pages"] = rows.length;
    } catch (e) { errors.push(e.message); }
  }
  try {
    const row = crawlRow(await bing(fetchImpl, "GetCrawlStats", { siteUrl: site }, key), now);
    const { error } = await sb.from("seo_site").upsert(row, { onConflict: "key" });
    if (error) throw new Error(`seo_site upsert: ${error.message || error}`);
    out.crawl = row.detail;
  } catch (e) { errors.push(e.message); }
  if (errors.length) { out.errors = errors; if (!out.queries && !out.pages && !out.crawl) throw new Error(errors.join("; ").slice(0, 300)); }
  return out;
}
