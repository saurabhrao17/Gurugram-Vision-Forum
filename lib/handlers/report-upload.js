// POST /api/report/upload-url { ref, token, files:[{name,size,type,kind}] }
// -> signed upload URLs in the private bucket, valid a few minutes, for the
// report the token belongs to. The browser PUTs each file straight to storage.
import { createHash } from "node:crypto";
import { supabase } from "../supabase.js";
import { send, methodNotAllowed, readJson, text } from "../http.js";
import { ALLOWED_TYPES, MAX_FILE_BYTES, MAX_FILES, safeName } from "../filing.js";

export async function reportForToken(sb, ref, token) {
  if (!/^GVF-\d{4}-[A-Z2-9]{5}$/.test(ref) || !/^[0-9a-f]{48}$/.test(token)) return null;
  const hash = createHash("sha256").update(token).digest("hex");
  const { data } = await sb.from("reports").select("id, ref, attachments, upload_token_expires").eq("ref", ref).eq("upload_token_hash", hash).maybeSingle();
  if (!data || !data.upload_token_expires || new Date(data.upload_token_expires) < new Date()) return null;
  return data;
}

export function validateFiles(list) {
  if (!Array.isArray(list) || !list.length || list.length > MAX_FILES) return null;
  const out = [];
  for (const f of list) {
    const name = safeName(f?.name);
    const size = Number(f?.size);
    const type = text(f?.type, 60);
    const kind = text(f?.kind, 40).replace(/[^a-z0-9_]/g, "") || null;
    if (!ALLOWED_TYPES.includes(type) || !Number.isFinite(size) || size <= 0 || size > MAX_FILE_BYTES) return null;
    out.push({ name, size, type, kind });
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, "POST");
  const b = readJson(req);
  if (!b) return send(res, 400, { ok: false, error: "bad_json" });
  const ref = text(b.ref, 20).toUpperCase(), token = text(b.token, 60);
  const sb = supabase();
  const report = await reportForToken(sb, ref, token);
  if (!report) return send(res, 403, { ok: false, error: "bad_token" });
  const files = validateFiles(b.files);
  if (!files) return send(res, 400, { ok: false, error: "invalid_files" });
  const existing = Array.isArray(report.attachments) ? report.attachments.length : 0;
  if (existing + files.length > MAX_FILES) return send(res, 400, { ok: false, error: "too_many_files" });
  const out = [];
  for (const [i, f] of files.entries()) {
    const path = `${ref}/${Date.now()}-${i}-${f.name}`;
    const { data, error } = await sb.storage.from("report-photos").createSignedUploadUrl(path);
    if (error) { console.error("signed upload url failed", error); return send(res, 500, { ok: false, error: "server_error" }); }
    out.push({ path, url: data.signedUrl, name: f.name, size: f.size, type: f.type, kind: f.kind });
  }
  return send(res, 200, { ok: true, uploads: out });
}
