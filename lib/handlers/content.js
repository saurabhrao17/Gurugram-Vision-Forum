// GET /api/content?kind=&limit=
// Published posts for the public site (news, stories, photos, videos, social
// posts, testimonials, popups) plus the social links. No auth; cached two
// minutes. Never includes created_by.
import { supabase } from "../supabase.js";
import { send, methodNotAllowed, text } from "../http.js";
import { KINDS, publicPost } from "../content.js";

export function parseLimit(v, dflt = 50, max = 200) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(Math.max(n, 1), max);
}

export async function handle(req, res, sb, env = process.env) {
  if (req.method !== "GET") return methodNotAllowed(res, "GET");
  const kind = text(req.query?.kind, 20).toLowerCase();
  if (kind && !KINDS.includes(kind)) return send(res, 400, { ok: false, error: "bad_kind" });
  const limit = parseLimit(req.query?.limit);
  const [{ data, error }, { data: social }] = await Promise.all([
    sb.rpc("content_public", { p_kind: kind || null, p_limit: limit }),
    sb.from("site_settings").select("value").eq("key", "social").maybeSingle()
  ]);
  if (error) {
    console.error("content lookup failed", error);
    return send(res, 500, { ok: false, error: "server_error" });
  }
  const posts = (Array.isArray(data) ? data : []).map((p) => publicPost(p, env.SUPABASE_URL)).filter(Boolean);
  res.setHeader("Cache-Control", "public, max-age=120");
  return send(res, 200, { ok: true, posts, settings: { social: (social && social.value) || {} } });
}

export default function handler(req, res) {
  return handle(req, res, supabase());
}
