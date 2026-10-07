// POST /api/report/attach { ref, token, files:[{path,name,size,type,kind}] }
// Records uploaded files on the report after checking they exist in storage.
import { supabase } from "../supabase.js";
import { send, methodNotAllowed, readJson, text } from "../http.js";
import { reportForToken, validateFiles } from "./report-upload.js";

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
  const paths = (b.files || []).map((f) => text(f?.path, 200));
  if (paths.some((p) => !p.startsWith(ref + "/") || p.includes(".."))) return send(res, 400, { ok: false, error: "invalid_files" });
  const { data: objects, error } = await sb.storage.from("report-photos").list(ref, { limit: 100 });
  if (error) { console.error("list failed", error); return send(res, 500, { ok: false, error: "server_error" }); }
  const present = new Set((objects || []).map((o) => `${ref}/${o.name}`));
  const rows = files.map((f, i) => ({ ...f, path: paths[i], uploaded_at: new Date().toISOString() })).filter((f) => present.has(f.path));
  if (!rows.length) return send(res, 400, { ok: false, error: "not_uploaded" });
  const { data, error: e2 } = await sb.rpc("report_attach", { p_ref: ref, p_files: rows });
  if (e2) { console.error("attach failed", e2); return send(res, 500, { ok: false, error: "server_error" }); }
  return send(res, 200, { ok: true, attached: rows.length, total: Array.isArray(data) ? data.length : rows.length });
}
