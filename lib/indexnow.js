// IndexNow client and the site's canonical origin.
//
// IndexNow (https://www.indexnow.org) is a one-call "these URLs changed"
// ping shared by Bing, Yandex, Naver and Seznam. Google does not take part;
// it finds the same pages through the sitemap. The key is proved by serving
// it at ${SITE_URL}/indexnow-key.txt (keyLocation). Never throws: the daily
// cron must carry on whatever the search engines answer.
export const INDEXNOW_URL = "https://api.indexnow.org/indexnow";
export const INDEXNOW_MAX_URLS = 10000;
export const DEFAULT_SITE = "https://gurugramvisionforum.org";
const TIMEOUT_MS = 8000;

// The public origin, without a trailing slash: SITE_URL, then Vercel's
// production URL, then the domain.
export function siteUrl(env = process.env) {
  const raw = (env && env.SITE_URL) || (env && env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "") || DEFAULT_SITE;
  return String(raw).trim().replace(/\/+$/, "");
}

// Only absolute URLs on the site's own host are sent; duplicates are dropped.
export function cleanUrls(urls, site) {
  let host;
  try { host = new URL(site).host; } catch { return []; }
  const out = [];
  const seen = new Set();
  for (const u of Array.isArray(urls) ? urls : []) {
    if (typeof u !== "string") continue;
    let parsed;
    try { parsed = new URL(u); } catch { continue; }
    if (parsed.host !== host || !/^https?:$/.test(parsed.protocol)) continue;
    const s = parsed.toString();
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= INDEXNOW_MAX_URLS) break;
  }
  return out;
}

// POST {host, key, keyLocation, urlList} -> { ok, status, count }.
// Without a key, a client or any URL the result says skipped.
export async function pingIndexNow(env = process.env, urls = [], fetchImpl = globalThis.fetch) {
  const key = env && typeof env.INDEXNOW_KEY === "string" ? env.INDEXNOW_KEY.trim() : "";
  const site = siteUrl(env);
  const urlList = cleanUrls(urls, site);
  if (!key) return { ok: false, status: 0, count: 0, skipped: "no_key" };
  if (!fetchImpl) return { ok: false, status: 0, count: 0, skipped: "no_fetch" };
  if (!urlList.length) return { ok: true, status: 0, count: 0, skipped: "no_urls" };
  const body = { host: new URL(site).host, key, keyLocation: `${site}/indexnow-key.txt`, urlList };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetchImpl(INDEXNOW_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    const status = Number(r && r.status) || 0;
    // 200 and 202 are acceptance; anything else is reported, not thrown.
    return { ok: status === 200 || status === 202, status, count: urlList.length };
  } catch (e) {
    return { ok: false, status: 0, count: urlList.length, error: String(e && e.message || e).slice(0, 160) };
  } finally { clearTimeout(timer); }
}
