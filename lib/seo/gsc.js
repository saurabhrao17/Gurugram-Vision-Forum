// Google Search Console data for the SEO desk (cron step `gsc`):
//   - top queries and pages over the last 28 days (Search Analytics API),
//   - Google's index status for a rotating set of the site's pages (URL
//     Inspection API, 2,000 a day free; we use INSPECT_PER_RUN a night),
//   - the sitemap's status (submitted and indexed counts, errors).
// Auth is a Google Cloud service account added as a user on the Search
// Console property: GSC_SERVICE_ACCOUNT holds its JSON key (client_email,
// private_key). A signed JWT is exchanged for a one-hour token with Node's
// own crypto; no SDK. GSC_SITE overrides the property (default the Domain
// property sc-domain:<host>). Read-only scope; nothing is ever changed in
// Search Console.
import { createSign } from "node:crypto";
import { siteUrl } from "./site.js";

export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
export const ROWS = 100;
export const INSPECT_PER_RUN = 10;
export const WINDOW_DAYS = 28;
export const LAG_DAYS = 2;          // Search Console data trails by about two days
// URL inspections take several seconds each; stop starting new ones once the
// step has run this long, so the whole call stays inside the function's
// 60-second limit. The rest wait for the next night (oldest first).
export const BUDGET_MS = 35000;
const DAY = 86400000;
const TIMEOUT_MS = 15000;

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

export function readServiceAccount(env) {
  const raw = env && env.GSC_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const j = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!j || !j.client_email || !j.private_key) return null;
    return { email: j.client_email, key: String(j.private_key).replace(/\\n/g, "\n") };
  } catch { return null; }
}

export function gscSite(env) {
  if (env && env.GSC_SITE) return String(env.GSC_SITE);
  try { return `sc-domain:${new URL(siteUrl(env)).host}`; } catch { return null; }
}

// RS256 JWT for the token exchange.
export function signJwt(sa, now = Date.now(), scope = SCOPE) {
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.email, scope, aud: TOKEN_URL, iat, exp: iat + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${b64url(signer.sign(sa.key))}`;
}

async function call(fetchImpl, url, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetchImpl(url, { ...init, signal: ctrl.signal });
    const j = await r.json().catch(() => null);
    if (!r.ok) { const e = new Error(`${r.status} ${(j && j.error && (j.error.message || j.error_description || j.error)) || ""}`.trim().slice(0, 200)); e.status = r.status; throw e; }
    return j;
  } finally { clearTimeout(timer); }
}

export async function accessToken(sa, fetchImpl, now = Date.now()) {
  const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signJwt(sa, now) });
  const j = await call(fetchImpl, TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() });
  if (!j || !j.access_token) throw new Error("no access_token");
  return j.access_token;
}

export function windowOf(now = Date.now()) {
  const end = new Date(now - LAG_DAYS * DAY);
  const start = new Date(end.getTime() - (WINDOW_DAYS - 1) * DAY);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

// Search Analytics rows -> seo_search rows.
export function searchRows(json, dim, period, site = "") {
  return ((json && json.rows) || []).map((r) => {
    let key = String((r.keys && r.keys[0]) || "");
    if (dim === "page" && site && key.startsWith(site)) key = key.slice(site.length) || "/";
    return { source: "google", dim, key: key.slice(0, 500), clicks: Math.round(r.clicks || 0), impressions: Math.round(r.impressions || 0), ctr: r.ctr != null ? Math.round(r.ctr * 10000) / 10000 : null, position: r.position != null ? Math.round(r.position * 100) / 100 : null, period_start: period.start, period_end: period.end };
  }).filter((r) => r.key);
}

// URL Inspection result -> seo_index row.
export function indexRow(url, json, now = Date.now()) {
  const s = (json && json.inspectionResult && json.inspectionResult.indexStatusResult) || {};
  return { url, verdict: s.verdict || null, coverage: s.coverageState || null, indexing: s.indexingState || null, robots: s.robotsTxtState || null, google_canonical: s.googleCanonical || null, last_crawl: s.lastCrawlTime || null, checked_at: new Date(now).toISOString() };
}

// Sitemaps list -> one seo_site row.
export function sitemapRow(json, now = Date.now()) {
  const list = (json && json.sitemap) || [];
  const sm = list[0];
  if (!sm) return { key: "gsc_sitemap", ok: false, detail: "No sitemap submitted to Google", data: {}, checked_at: new Date(now).toISOString() };
  const web = (sm.contents || []).find((c) => c.type === "web") || (sm.contents || [])[0] || {};
  const errors = Number(sm.errors) || 0;
  return { key: "gsc_sitemap", ok: !errors && !sm.isPending, detail: `${web.submitted || 0} URLs submitted${web.indexed != null ? `, ${web.indexed} indexed` : ""}${errors ? `, ${errors} errors` : ""}${sm.lastDownloaded ? `; read by Google ${String(sm.lastDownloaded).slice(0, 10)}` : sm.isPending ? "; Google has not read it yet" : ""}`,
    data: { path: sm.path, submitted: Number(web.submitted) || 0, indexed: web.indexed != null ? Number(web.indexed) : null, errors, warnings: Number(sm.warnings) || 0, last_downloaded: sm.lastDownloaded || null, pending: !!sm.isPending }, checked_at: new Date(now).toISOString() };
}

export async function gscStep(sb, env, { fetch: fetchImpl = null, now = Date.now(), urls = [], budgetMs = BUDGET_MS, clock = Date.now } = {}) {
  const started = clock();
  const out = { queries: 0, pages: 0, inspected: 0, sitemap: null };
  const sa = readServiceAccount(env);
  if (!sa) { out.skipped = env && env.GSC_SERVICE_ACCOUNT ? "bad_key" : "no_key"; return out; }
  if (!fetchImpl) { out.skipped = "no_fetch"; return out; }
  const site = gscSite(env);
  const origin = siteUrl(env);
  const token = await accessToken(sa, fetchImpl, now);
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const enc = encodeURIComponent(site);
  const period = windowOf(now);
  const errors = [];
  for (const dim of ["query", "page"]) {
    try {
      const j = await call(fetchImpl, `https://www.googleapis.com/webmasters/v3/sites/${enc}/searchAnalytics/query`, { method: "POST", headers: auth, body: JSON.stringify({ startDate: period.start, endDate: period.end, dimensions: [dim], rowLimit: ROWS }) });
      const rows = searchRows(j, dim, period, origin);
      if (rows.length) { const { error } = await sb.from("seo_search").upsert(rows, { onConflict: "source,dim,key,period_end" }); if (error) throw new Error(`seo_search upsert: ${error.message || error}`); }
      out[dim === "query" ? "queries" : "pages"] = rows.length;
    } catch (e) { errors.push(`${dim}: ${e.message}`); }
  }
  try {
    const j = await call(fetchImpl, `https://www.googleapis.com/webmasters/v3/sites/${enc}/sitemaps`, { headers: auth });
    const row = sitemapRow(j, now);
    const { error } = await sb.from("seo_site").upsert(row, { onConflict: "key" });
    if (error) throw new Error(`seo_site upsert: ${error.message || error}`);
    out.sitemap = row.detail;
  } catch (e) { errors.push(`sitemaps: ${e.message}`); }
  // URL Inspection: the pages Google was asked about longest ago first.
  try {
    const { data } = await sb.from("seo_index").select("url, checked_at");
    const when = new Map((data || []).map((r) => [r.url, Date.parse(r.checked_at) || 0]));
    const queue = (urls || []).slice().sort((a, b) => (when.get(a) || 0) - (when.get(b) || 0)).slice(0, INSPECT_PER_RUN);
    for (const u of queue) {
      if (clock() - started > budgetMs) { out.deferred = queue.length - out.inspected; break; }
      const j = await call(fetchImpl, "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { method: "POST", headers: auth, body: JSON.stringify({ inspectionUrl: u, siteUrl: site }) });
      const { error } = await sb.from("seo_index").upsert(indexRow(u, j, now), { onConflict: "url" });
      if (error) throw new Error(`seo_index upsert: ${error.message || error}`);
      out.inspected++;
    }
  } catch (e) { errors.push(`inspect: ${e.message}`); }
  if (errors.length) { out.errors = errors; if (!out.queries && !out.pages && !out.inspected && !out.sitemap) throw new Error(errors.join("; ").slice(0, 300)); }
  return out;
}
