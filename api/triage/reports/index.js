// GET /api/triage/reports?stage=open|0..4&issue=&ward=&flag=overdue&q=&offset=&limit=
// Staff only. Returns the list the desk works from plus the stage counts.
import { supabase } from "../../../lib/supabase.js";
import { requireStaff, handleError } from "../../../lib/auth.js";
import { send, methodNotAllowed, text } from "../../../lib/http.js";

const COLS = "ref, issue_type, issue_label, affects, area, ward, councillor, spot, lat, lng, stage, desk, official_channel, official_ticket, official_filed_at, escalated_to, resolved_at, source, reporter_name, created_at, updated_at, unmapped_overdue, filed_overdue, events_count, last_event_at";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, "GET");
  try {
    await requireStaff(req);
    const qs = req.query || {};
    const stage = text(qs.stage, 5) || "open";
    const issue = text(qs.issue, 40);
    const ward = parseInt(qs.ward, 10);
    const flag = text(qs.flag, 20);
    const search = text(qs.q, 80).replace(/[,()%\\]/g, " ").trim();
    const limit = Math.min(Math.max(parseInt(qs.limit, 10) || 50, 1), 100);
    const offset = Math.max(parseInt(qs.offset, 10) || 0, 0);

    const sb = supabase();
    let q = sb.from("triage_reports").select(COLS, { count: "exact" }).order("created_at", { ascending: false }).range(offset, offset + limit - 1);
    if (stage === "open") q = q.lt("stage", 4);
    else if (/^[0-4]$/.test(stage)) q = q.eq("stage", Number(stage));
    if (issue) q = q.eq("issue_type", issue);
    if (Number.isInteger(ward) && ward >= 1 && ward <= 36) q = q.eq("ward", ward);
    if (flag === "overdue") q = q.or("unmapped_overdue.eq.true,filed_overdue.eq.true");
    if (search) q = q.or(`ref.ilike.%${search}%,area.ilike.%${search}%,spot.ilike.%${search}%,reporter_name.ilike.%${search}%,official_ticket.ilike.%${search}%`);

    const [list, summary] = await Promise.all([q, sb.from("dashboard_summary").select("total, received, filed, escalated, resolved, unmapped_past_due, filed_past_due").single()]);
    if (list.error) { console.error(list.error); return send(res, 500, { ok: false, error: "server_error" }); }
    return send(res, 200, { ok: true, reports: list.data, total: list.count, offset, limit, summary: summary.data || null });
  } catch (e) { return handleError(res, e); }
}
