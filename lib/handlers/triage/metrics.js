// GET /api/triage/metrics -> { ok, generated_at, totals, wards, people, brief }
// Owner and coordinator: the ageing tracker (open reports by age per ward,
// overdue, last week's flow, last activity) and per-person activity (actions
// on the timeline, open and overdue in their wards), plus today's brief text.
import { supabase } from "../../supabase.js";
import { requireStaff, handleError, MANAGER_ROLES } from "../../auth.js";
import { send, methodNotAllowed } from "../../http.js";
import { buildBrief, totalsOf } from "../../brief.js";
import { siteUrl } from "../../indexnow.js";

export async function loadMetrics(sb, env = process.env, now = Date.now()) {
  const [a, p] = await Promise.all([sb.rpc("ward_ageing"), sb.rpc("staff_activity")]);
  if (a.error) throw a.error;
  if (p.error) throw p.error;
  const wards = Array.isArray(a.data) ? a.data : [];
  const people = Array.isArray(p.data) ? p.data : [];
  const brief = buildBrief({ wards, people, now, siteUrl: siteUrl(env) || "https://gurugramvisionforum.org" });
  return { generated_at: new Date(now).toISOString(), totals: totalsOf(wards), wards, people, brief: { text: brief.text, line: brief.line, idle: brief.idle } };
}

export function makeHandler({ auth, sb: sbIn } = {}) {
  const requireAuth = auth || requireStaff;
  return async function handler(req, res, sb) {
  if (req.method !== "GET") return methodNotAllowed(res, "GET");
  try {
    await requireAuth(req, MANAGER_ROLES);
    sb = sb || sbIn || supabase();
    const m = await loadMetrics(sb);
    res.setHeader("Cache-Control", "no-store");
    return send(res, 200, { ok: true, ...m });
  } catch (e) { return handleError(res, e); }
  };
}

export default makeHandler();
