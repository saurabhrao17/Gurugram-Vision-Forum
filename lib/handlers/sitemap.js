// GET /sitemap.xml (rewritten to /api/index?path=sitemap): every server-
// rendered page in both languages with hreflang alternates, plus the app's
// main routes. Posts carry their published date; guides and wards the
// template build date.
import { supabase } from "../supabase.js";
import { methodNotAllowed } from "../http.js";
import { gvf } from "../site-data.js";
import { SITE_URL, BUILD_DATE, APP_ROUTES, WARD_COUNT } from "../seo/site.js";
import { esc, hiPath } from "../seo/layout.js";
import { blogPosts, mergePosts, isoDate } from "../seo/data.js";

const url = (p) => SITE_URL + p;

function entry(path, lastmod, alternates) {
  let s = `  <url>\n    <loc>${esc(url(path))}</loc>\n`;
  if (lastmod) s += `    <lastmod>${esc(lastmod)}</lastmod>\n`;
  if (alternates) {
    const en = alternates.en, hi = alternates.hi;
    s += `    <xhtml:link rel="alternate" hreflang="en-IN" href="${esc(url(en))}"/>\n`;
    s += `    <xhtml:link rel="alternate" hreflang="hi-IN" href="${esc(url(hi))}"/>\n`;
    s += `    <xhtml:link rel="alternate" hreflang="x-default" href="${esc(url(en))}"/>\n`;
  }
  return s + "  </url>\n";
}

// Both language entries for one English path.
function pair(path, lastmod) {
  const alt = { en: path, hi: hiPath(path) };
  return entry(path, lastmod, alt) + entry(alt.hi, lastmod, alt);
}

export function buildSitemap(posts) {
  const G = gvf();
  let out = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n`;
  for (const p of APP_ROUTES) out += entry(p, BUILD_DATE);
  out += pair("/guides", BUILD_DATE);
  for (const c of G.CATS || []) out += pair(`/guide/${c.id}`, BUILD_DATE);
  for (let n = 1; n <= WARD_COUNT; n++) out += pair(`/ward/${n}`, BUILD_DATE);
  out += pair("/blog", BUILD_DATE);
  for (const p of posts || []) out += pair(`/blog/${p.slug}`, isoDate(p.date) || BUILD_DATE);
  return out + "</urlset>\n";
}

export async function handle(req, res, sb, env = process.env) {
  if (req.method !== "GET" && req.method !== "HEAD") return methodNotAllowed(res, "GET, HEAD");
  const posts = mergePosts(await blogPosts(sb, env, 500));
  res.status(200);
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  res.end(buildSitemap(posts));
}

export default function handler(req, res) {
  let sb = null;
  try { sb = supabase(); } catch { sb = null; }
  return handle(req, res, sb);
}
