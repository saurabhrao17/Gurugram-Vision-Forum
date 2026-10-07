// GET /api/public/report?ref=GVF-2026-ABCDE
// Anonymised public view of one report: stage, dates, area, ward and the
// stage history. Never a name, phone, email, description, spot, ticket,
// filing details or attachments. The database function already omits them;
// the allowlist below is defence in depth.
import { supabase } from "../supabase.js";
import { send, methodNotAllowed, text } from "../http.js";

export const REF_RE = /^GVF-\d{4}-[A-Z2-9]{5}$/;

const PUBLIC_KEYS = [
  "ref", "issue_type", "issue_label", "area", "ward", "stage",
  "created_at", "updated_at", "official_filed_at", "resolved_at",
  "desk", "official_channel", "lat", "lng", "source", "events", "followers"
];

export function publicFields(row) {
  if (!row || typeof row !== "object") return null;
  const out = {};
  for (const k of PUBLIC_KEYS) if (k in row) out[k] = row[k];
  if (Array.isArray(out.events)) {
    out.events = out.events.map((e) => ({ stage: e?.stage ?? null, created_at: e?.created_at ?? null }));
  }
  return out;
}

export async function handle(req, res, sb) {
  if (req.method !== "GET") return methodNotAllowed(res, "GET");
  const ref = text(req.query?.ref, 20).toUpperCase();
  if (!REF_RE.test(ref)) return send(res, 400, { ok: false, error: "bad_ref" });
  const { data, error } = await sb.rpc("public_report", { p_ref: ref });
  if (error) {
    console.error("public report lookup failed", error);
    return send(res, 500, { ok: false, error: "server_error" });
  }
  if (!data) return send(res, 404, { ok: false, error: "not_found" });
  res.setHeader("Cache-Control", "public, max-age=60");
  return send(res, 200, { ok: true, report: publicFields(data) });
}

export default function handler(req, res) {
  return handle(req, res, supabase());
}
