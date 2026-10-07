// GET /api/public/reports?limit=500
// Pins for the public map: reference, issue type, stage, ward and rounded
// coordinates, newest first, plus counts. Nothing that identifies a reporter.
import { supabase } from "../supabase.js";
import { send, methodNotAllowed } from "../http.js";

const PIN_KEYS = ["ref", "issue_type", "stage", "ward", "lat", "lng", "created_at"];

export function publicPin(row) {
  if (!row || typeof row !== "object") return null;
  const out = {};
  for (const k of PIN_KEYS) if (k in row) out[k] = row[k];
  return out;
}

export function parseLimit(v, dflt = 500) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(Math.max(n, 1), 1000);
}

export async function handle(req, res, sb) {
  if (req.method !== "GET") return methodNotAllowed(res, "GET");
  const limit = parseLimit(req.query?.limit);
  const { data, error } = await sb.rpc("public_reports_recent", { p_limit: limit });
  if (error) {
    console.error("public reports query failed", error);
    return send(res, 500, { ok: false, error: "server_error" });
  }
  const reports = Array.isArray(data?.reports) ? data.reports.map(publicPin).filter(Boolean) : [];
  const counts = {
    total: Number(data?.counts?.total) || 0,
    with_location: Number(data?.counts?.with_location) || 0
  };
  res.setHeader("Cache-Control", "public, max-age=300");
  return send(res, 200, { ok: true, reports, counts, computed_at: data?.computed_at || new Date().toISOString() });
}

export default function handler(req, res) {
  return handle(req, res, supabase());
}
