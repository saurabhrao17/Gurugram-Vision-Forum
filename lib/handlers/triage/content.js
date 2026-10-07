// Content management for owners and coordinators.
// GET    /api/triage/content?kind=            -> every post, newest first
// POST   /api/triage/content   { kind, title, ... }  -> creates (full validation)
// PATCH  /api/triage/content   { id, ...fields }     -> partial update
// DELETE /api/triage/content   { id }                -> removes the post and its media object
// PUT    /api/triage/content   { settings: { social: { x, facebook, instagram, youtube, whatsapp } } }
import { supabase } from "../../supabase.js";
import { requireStaff, handleError, actorOf } from "../../auth.js";
import { send, methodNotAllowed, readJson, text } from "../../http.js";
import { KINDS, validatePost, slugFor, httpsUrl, mediaUrl } from "../../content.js";

const MANAGERS = ["owner", "coordinator"];
const SOCIAL_KEYS = ["x", "facebook", "instagram", "youtube", "whatsapp"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Each social link must be an https URL or empty. Returns { value, errors }.
export function validateSocial(input) {
  const b = input && typeof input === "object" ? input : {};
  const value = {};
  const errors = [];
  for (const k of SOCIAL_KEYS) {
    if (!(k in b)) continue;
    const u = httpsUrl(b[k], 300);
    if (u === null) errors.push(k); else value[k] = u;
  }
  return { value, errors };
}

const withUrl = (row, env = process.env) => ({ ...row, media_url: row.media_path && env.SUPABASE_URL ? mediaUrl(env.SUPABASE_URL, row.media_path) : null });

export async function handle(req, res, sb, s) {
  if (req.method === "GET") {
    const kind = text(req.query?.kind, 20).toLowerCase();
    if (kind && !KINDS.includes(kind)) return send(res, 400, { ok: false, error: "bad_kind" });
    let q = sb.from("posts").select("*").order("created_at", { ascending: false }).limit(500);
    if (kind) q = q.eq("kind", kind);
    const [{ data, error }, { data: settings }] = await Promise.all([q, sb.from("site_settings").select("key, value, updated_at")]);
    if (error) throw error;
    const st = {};
    (settings || []).forEach((r) => { st[r.key] = r.value; });
    return send(res, 200, { ok: true, posts: (data || []).map((r) => withUrl(r)), settings: st });
  }

  if (req.method === "POST") {
    const b = readJson(req);
    if (!b) return send(res, 400, { ok: false, error: "bad_json" });
    const { value, errors } = validatePost(b);
    if (errors.length) return send(res, 400, { ok: false, error: "invalid", fields: errors });
    const row = { ...value, created_by: actorOf(s) };
    if (row.published && !row.published_at) row.published_at = new Date().toISOString();
    for (let attempt = 0; attempt < 3; attempt++) {
      row.slug = slugFor(row.title);
      const { data, error } = await sb.from("posts").insert(row).select("*").single();
      if (!error) return send(res, 201, { ok: true, post: withUrl(data) });
      if (error.code !== "23505") throw error;
    }
    return send(res, 500, { ok: false, error: "server_error" });
  }

  if (req.method === "PATCH") {
    const b = readJson(req);
    if (!b) return send(res, 400, { ok: false, error: "bad_json" });
    const id = text(b.id, 40);
    if (!UUID.test(id)) return send(res, 400, { ok: false, error: "invalid", fields: ["id"] });
    const { id: _id, created_by: _cb, slug: _slug, ...fields } = b;
    const { value, errors } = validatePost(fields, { partial: true });
    if (errors.length) return send(res, 400, { ok: false, error: "invalid", fields: errors });
    if (!Object.keys(value).length) return send(res, 400, { ok: false, error: "empty" });
    const { data: current, error: e0 } = await sb.from("posts").select("id, published, published_at, media_path").eq("id", id).maybeSingle();
    if (e0) throw e0;
    if (!current) return send(res, 404, { ok: false, error: "not_found" });
    const patch = { ...value };
    if (patch.published && !(patch.published_at || current.published_at)) patch.published_at = new Date().toISOString();
    const { data, error } = await sb.from("posts").update(patch).eq("id", id).select("*").single();
    if (error) throw error;
    // A replaced media file is removed from storage; failures are logged only.
    if ("media_path" in value && current.media_path && current.media_path !== value.media_path) {
      await sb.storage.from("media").remove([current.media_path]).catch((e) => console.error("media remove failed", e));
    }
    return send(res, 200, { ok: true, post: withUrl(data) });
  }

  if (req.method === "DELETE") {
    const b = readJson(req);
    const id = b ? text(b.id, 40) : "";
    if (!UUID.test(id)) return send(res, 400, { ok: false, error: "invalid", fields: ["id"] });
    const { data, error } = await sb.from("posts").delete().eq("id", id).select("id, media_path").maybeSingle();
    if (error) throw error;
    if (!data) return send(res, 404, { ok: false, error: "not_found" });
    if (data.media_path) await sb.storage.from("media").remove([data.media_path]).catch((e) => console.error("media remove failed", e));
    return send(res, 200, { ok: true, id });
  }

  if (req.method === "PUT") {
    const b = readJson(req);
    if (!b || !b.settings || typeof b.settings !== "object") return send(res, 400, { ok: false, error: "bad_json" });
    const out = {};
    if ("social" in b.settings) {
      const { value, errors } = validateSocial(b.settings.social);
      if (errors.length) return send(res, 400, { ok: false, error: "invalid", fields: errors.map((k) => "social." + k) });
      const { data: cur } = await sb.from("site_settings").select("value").eq("key", "social").maybeSingle();
      const merged = { ...((cur && cur.value) || {}), ...value };
      const { error } = await sb.from("site_settings").upsert({ key: "social", value: merged, updated_at: new Date().toISOString() });
      if (error) throw error;
      out.social = merged;
    }
    if (!Object.keys(out).length) return send(res, 400, { ok: false, error: "empty" });
    return send(res, 200, { ok: true, settings: out });
  }

  return methodNotAllowed(res, "GET, POST, PATCH, DELETE, PUT");
}

export default async function handler(req, res) {
  try {
    const s = await requireStaff(req, MANAGERS);
    return await handle(req, res, supabase(), s);
  } catch (e) { return handleError(res, e); }
}
