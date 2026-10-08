// GET /api/dashboard: counts by cause, ward and stage, plus the Forum's
// commitments as actuals. Counts only, never names and never one report
// (owner's decision, 8 Oct 2026: counts are public from the first report;
// what they are made of stays with the team).
import { supabase } from "../supabase.js";
import { send, methodNotAllowed } from "../http.js";

export default async function handler(req, res) {
  // Read by the embed widget on other sites (counts only, nothing personal).
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.setHeader("Access-Control-Allow-Methods", "GET"); return res.status(204).end(); }
  if (req.method !== "GET") return methodNotAllowed(res, "GET");
  const sb = supabase();
  const [summary, byIssue, byWard, linkRows] = await Promise.all([
    sb.from("dashboard_summary").select("*").single(),
    sb.from("dashboard_by_issue").select("*"),
    sb.from("dashboard_by_ward").select("*"),
    sb.from("link_status").select("checked_at, ok").not("checked_at", "is", null)
  ]);
  const err = summary.error || byIssue.error || byWard.error;
  if (err) {
    console.error("dashboard query failed", err);
    return send(res, 500, { ok: false, error: "server_error" });
  }
  const s = summary.data;
  // The nightly link check (00:00 IST, from Mumbai): when it last ran and how
  // many official links failed, so the footer's "Links verified" date is live.
  const lr = Array.isArray(linkRows.data) ? linkRows.data : [];
  const links = { checked_at: lr.reduce((m, r) => (r.checked_at && (!m || r.checked_at > m) ? r.checked_at : m), null), total: lr.length, broken: lr.filter((r) => r.ok === false).length };
  res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=3600");
  return send(res, 200, {
    ok: true,
    published: true,
    total: s.total,
    updated_at: s.computed_at,
    source: "Gurugram Vision Forum case system",
    summary: s,
    by_issue: byIssue.data.filter((r) => r.total > 0),
    by_ward: byWard.data.filter((r) => r.total > 0),
    links
  });
}
