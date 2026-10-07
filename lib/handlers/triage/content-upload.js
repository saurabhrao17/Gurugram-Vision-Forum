// POST /api/triage/content/upload-url { name, size, type }
// -> a signed upload URL in the public `media` bucket for one file. The desk
// PUTs the file straight to storage, then saves the returned path on the
// post as media_path. Managers only.
import { supabase } from "../../supabase.js";
import { requireStaff, handleError } from "../../auth.js";
import { send, methodNotAllowed, readJson, text } from "../../http.js";
import { safeName } from "../../filing.js";
import { MEDIA_TYPES, MAX_MEDIA_BYTES, mediaUrl } from "../../content.js";

// Returns { name, size, type } or null when the file may not be uploaded.
export function validateUpload(f) {
  if (!f || typeof f !== "object") return null;
  const name = safeName(f.name);
  const size = Number(f.size);
  const type = text(f.type, 60).toLowerCase();
  if (!MEDIA_TYPES.includes(type)) return null;
  if (!Number.isFinite(size) || size <= 0 || size > MAX_MEDIA_BYTES) return null;
  return { name, size, type };
}

export function uploadPath(name, now = new Date()) {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `posts/${yyyy}/${mm}/${now.getTime()}-${name}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, "POST");
  try {
    await requireStaff(req, ["owner", "coordinator"]);
    const b = readJson(req);
    if (!b) return send(res, 400, { ok: false, error: "bad_json" });
    const f = validateUpload(b);
    if (!f) return send(res, 400, { ok: false, error: "invalid_file" });
    const path = uploadPath(f.name);
    const { data, error } = await supabase().storage.from("media").createSignedUploadUrl(path);
    if (error) { console.error("signed upload url failed", error); return send(res, 500, { ok: false, error: "server_error" }); }
    return send(res, 200, { ok: true, path, url: data.signedUrl, token: data.token, public_url: mediaUrl(process.env.SUPABASE_URL, path), name: f.name, size: f.size, type: f.type });
  } catch (e) { return handleError(res, e); }
}
