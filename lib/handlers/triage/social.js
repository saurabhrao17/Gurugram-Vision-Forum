// Social publishing from the desk (owner, coordinators, content team).
// GET  /api/triage/social            -> { ok, channels, shares: [...last 200 rows] }
// GET  /api/triage/social?post_id=   -> { ok, channels, shares: rows of that post }
// POST /api/triage/social { post_id, platforms: ["facebook", ...] }
//      queues the shares and sends them at once; { ok, results: [{platform,status,url,error}] }
// Tokens stay in the environment; the desk only ever learns which platforms are connected.
import { supabase } from "../../supabase.js";
import { requireStaff, handleError, actorOf, CONTENT_ROLES } from "../../auth.js";
import { send, methodNotAllowed, readJson, text } from "../../http.js";
import { channels, queueShares, flushSocial, PLATFORM_KEYS } from "../../social.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function makeHandler({ auth, sb: sbIn, env: envIn, fetchImpl, sleep } = {}) {
  const requireAuth = auth || requireStaff;
  return async function handler(req, res) {
    if (req.method !== "GET" && req.method !== "POST") return methodNotAllowed(res, "GET, POST");
    try {
      const s = await requireAuth(req, CONTENT_ROLES);
      const env = envIn || process.env;
      const sb = sbIn || supabase();
      if (req.method === "GET") {
        const postId = text(req.query?.post_id, 40);
        let q = sb.from("social_posts").select("id, post_id, platform, status, external_url, last_error, attempts, created_at, sent_at").order("created_at", { ascending: false }).limit(200);
        if (postId) { if (!UUID.test(postId)) return send(res, 400, { ok: false, error: "invalid", fields: ["post_id"] }); q = q.eq("post_id", postId); }
        const { data, error } = await q;
        if (error) throw error;
        return send(res, 200, { ok: true, channels: channels(env), shares: data || [] });
      }
      const b = readJson(req) || {};
      const postId = text(b.post_id, 40);
      const platforms = Array.isArray(b.platforms) ? b.platforms.map((p) => String(p).toLowerCase()).filter((p) => PLATFORM_KEYS.includes(p)) : [];
      if (!UUID.test(postId) || !platforms.length) return send(res, 400, { ok: false, error: "invalid", fields: ["post_id", "platforms"].filter((k) => (k === "post_id" ? !UUID.test(postId) : !platforms.length)) });
      const { data: post, error: pe } = await sb.from("posts").select("id, published").eq("id", postId).maybeSingle();
      if (pe) throw pe;
      if (!post) return send(res, 404, { ok: false, error: "not_found" });
      if (!post.published) return send(res, 409, { ok: false, error: "not_published" });
      const notConnected = platforms.filter((p) => !channels(env).find((c) => c.platform === p)?.configured);
      if (notConnected.length) return send(res, 409, { ok: false, error: "not_connected", platforms: notConnected });
      const queued = await queueShares(sb, postId, platforms, actorOf(s));
      const already = queued.filter((q) => q.already).map((q) => ({ platform: q.platform, status: "sent", already: true }));
      const r = await flushSocial(sb, env, { fetch: fetchImpl || globalThis.fetch, postId, limit: 10, sleep });
      return send(res, 200, { ok: true, results: already.concat(r.results), sent: r.sent, failed: r.failed, skipped: r.skipped });
    } catch (e) { return handleError(res, e); }
  };
}

export default makeHandler();
