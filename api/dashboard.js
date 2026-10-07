// GET /api/dashboard: counts by cause, ward and stage, plus the Forum's
// commitments as actuals. Counts only, never names. Published to the public
// page once 50 reports exist (HANDOFF.md section 1, rule 4).
import { supabase } from "../lib/supabase.js";
import { send, methodNotAllowed } from "../lib/http.js";

const PUBLISH_AT = 50;

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, "GET");
  const sb = supabase();
  const [summary, byIssue, byWard] = await Promise.all([
    sb.from("dashboard_summary").select("*").single(),
    sb.from("dashboard_by_issue").select("*"),
    sb.from("dashboard_by_ward").select("*")
  ]);
  const err = summary.error || byIssue.error || byWard.error;
  if (err) {
    console.error("dashboard query failed", err);
    return send(res, 500, { ok: false, error: "server_error" });
  }
  const s = summary.data;
  const published = (s.total || 0) >= PUBLISH_AT;
  res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=3600");
  return send(res, 200, {
    ok: true,
    published,
    publish_at: PUBLISH_AT,
    total: s.total,
    updated_at: s.computed_at,
    source: "Gurugram Vision Forum case system",
    summary: published ? s : null,
    by_issue: published ? byIssue.data.filter((r) => r.total > 0) : null,
    by_ward: published ? byWard.data.filter((r) => r.total > 0) : null
  });
}
