// GET /llms.txt and /llms-full.txt (rewritten to /api/index?path=llms and
// path=llms-full): the Markdown map of the site and the full text of every
// guide for AI answer engines (lib/seo/geo.js). Built from site/data.js and
// the published posts; cached at the edge for an hour.
import { supabase } from "../supabase.js";
import { methodNotAllowed } from "../http.js";
import { blogPosts, mergePosts } from "../seo/data.js";
import { buildLlms, buildLlmsFull } from "../seo/geo.js";

function send(res, body) {
  res.status(200);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  res.end(body);
}

export async function handle(req, res, sb, env = process.env, full = false) {
  if (req.method !== "GET" && req.method !== "HEAD") return methodNotAllowed(res, "GET, HEAD");
  if (full) return send(res, buildLlmsFull({ env }));
  const posts = mergePosts(await blogPosts(sb, env, 30));
  return send(res, buildLlms({ posts, env }));
}

const sbOrNull = () => { try { return supabase(); } catch { return null; } };
export default function handler(req, res) { return handle(req, res, sbOrNull()); }
export function full(req, res) { return handle(req, res, null, process.env, true); }
