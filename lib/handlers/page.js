// Server-rendered, indexable pages for search engines and sharing, built
// from site/data.js plus live Supabase data. Reached through vercel.json
// rewrites (/guides, /guide/:issue, /ward/:n, /blog, /blog/:slug and the
// same under /hi/) as /api/index?path=page/<...>; the router hands the rest
// of the path over in req.query.page. The hash-routed app is untouched;
// these pages link into it.
import { supabase } from "../supabase.js";
import { methodNotAllowed } from "../http.js";
import { gvf } from "../site-data.js";
import { sendHtml, notFound } from "../seo/layout.js";
import { renderGuide, renderGuides } from "../seo/guides.js";
import { renderWard, wardById } from "../seo/wards.js";
import { renderBlogIndex, renderBlogPost } from "../seo/blog.js";
import { social, topicFor, postsFor, wardAreas, wardCounts, blogPosts, blogPost, mergePosts, staticPosts } from "../seo/data.js";

const SLUG_RE = /^[a-z0-9-]{1,120}$/;

// The page path after "page": from req.query.page (router), else from the
// rewrite's ?path=, else from the URL itself.
export function subParts(req) {
  const q = req.query || {};
  let raw = q.page ?? q.path;
  if (raw == null && req.url) {
    try {
      const u = new URL(req.url, "http://local");
      raw = u.searchParams.get("page") ?? u.searchParams.get("path") ?? u.pathname.replace(/^\/api\/?(index\/?)?/, "");
    } catch { raw = ""; }
  }
  const parts = (Array.isArray(raw) ? raw : String(raw || "").split("/")).map((s) => { try { return decodeURIComponent(s); } catch { return s; } }).filter(Boolean);
  if (parts[0] === "page") parts.shift();
  return parts;
}

// Resolve the page: { lang, kind, arg } or null.
export function route(parts) {
  const p = parts.slice();
  let lang = "en";
  if (p[0] === "hi") { lang = "hi"; p.shift(); }
  if (p.length === 1 && p[0] === "guides") return { lang, kind: "guides" };
  if (p.length === 1 && p[0] === "blog") return { lang, kind: "blog" };
  if (p.length === 2 && p[0] === "guide" && SLUG_RE.test(p[1])) return { lang, kind: "guide", arg: p[1] };
  if (p.length === 2 && p[0] === "ward" && /^\d{1,3}$/.test(p[1])) return { lang, kind: "ward", arg: Number(p[1]) };
  if (p.length === 2 && p[0] === "blog" && SLUG_RE.test(p[1])) return { lang, kind: "post", arg: p[1] };
  return null;
}

const sbOrNull = () => { try { return supabase(); } catch { return null; } };

export async function handle(req, res, sb, env = process.env) {
  if (req.method !== "GET" && req.method !== "HEAD") return methodNotAllowed(res, "GET, HEAD");
  const r = route(subParts(req));
  const lang = r ? r.lang : "en";
  if (!r) return sendHtml(res, 404, notFound(lang));
  const G = gvf();
  const soc = social(sb);
  try {
    if (r.kind === "guides") {
      const posts = mergePosts(await blogPosts(sb, env, 20));
      return sendHtml(res, 200, renderGuides({ lang, posts, social: await soc }));
    }
    if (r.kind === "guide") {
      const cat = (G.CATS || []).find((c) => c.id === r.arg);
      if (!cat) return sendHtml(res, 404, notFound(lang, `/guide/${r.arg}`));
      const [topic, posts] = await Promise.all([topicFor(sb, cat.id), postsFor(sb, cat.id, env)]);
      return sendHtml(res, 200, renderGuide(cat, { lang, live: { topic, posts }, social: await soc }));
    }
    if (r.kind === "ward") {
      const w = wardById(r.arg);
      if (!w) return sendHtml(res, 404, notFound(lang, `/ward/${r.arg}`));
      const [areas, counts] = await Promise.all([wardAreas(sb, w.n), wardCounts(sb, w.n)]);
      return sendHtml(res, 200, renderWard(w, { lang, live: { areas, counts }, social: await soc }));
    }
    if (r.kind === "blog") {
      const posts = mergePosts(await blogPosts(sb, env));
      return sendHtml(res, 200, renderBlogIndex(posts, { lang, social: await soc }));
    }
    if (r.kind === "post") {
      const live = await blogPost(sb, r.arg, env);
      const post = live || staticPosts().find((p) => p.slug === r.arg) || null;
      if (!post) return sendHtml(res, 404, notFound(lang, `/blog/${r.arg}`));
      return sendHtml(res, 200, renderBlogPost(post, { lang, social: await soc }));
    }
  } catch (e) {
    console.error("page render failed", e);
  }
  return sendHtml(res, 404, notFound(lang));
}

export default function handler(req, res) {
  return handle(req, res, sbOrNull());
}
