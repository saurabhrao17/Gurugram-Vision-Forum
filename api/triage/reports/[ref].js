// GET  /api/triage/reports/:ref        -> full report with reporter details and events (staff only)
// PATCH /api/triage/reports/:ref       -> { issue_type?, ward?, desk?, stage?, official_channel?, official_ticket?, escalated_to?, resolution_note?, note? }
import { supabase } from "../../../lib/supabase.js";
import { requireStaff, handleError, actorOf } from "../../../lib/auth.js";
import { send, methodNotAllowed, readJson, text } from "../../../lib/http.js";

const REF = /^GVF-\d{4}-[A-Z2-9]{5}$/;

// Keeps only the fields the desk may change; "" clears a field. Returns { patch, note, errors }.
export function validatePatch(b) {
  const errors = [];
  const patch = {};
  const str = (k, max) => { if (k in b) { if (b[k] == null || typeof b[k] === "string") patch[k] = text(b[k] || "", max); else errors.push(k); } };
  str("desk", 200); str("official_channel", 80); str("official_ticket", 80); str("escalated_to", 200); str("resolution_note", 2000);
  if ("issue_type" in b) { const v = text(b.issue_type, 40); if (v) patch.issue_type = v; else errors.push("issue_type"); }
  if ("stage" in b) { const n = parseInt(b.stage, 10); if (Number.isInteger(n) && n >= 0 && n <= 4) patch.stage = n; else errors.push("stage"); }
  if ("ward" in b) {
    if (b.ward === "" || b.ward == null) patch.ward = "";
    else { const n = parseInt(b.ward, 10); if (Number.isInteger(n) && n >= 1 && n <= 36) patch.ward = n; else errors.push("ward"); }
  }
  const note = text(b.note, 2000);
  return { patch, note, errors };
}

async function load(sb, ref) {
  const { data: report, error } = await sb.from("triage_reports").select("*").eq("ref", ref).maybeSingle();
  if (error) throw error;
  if (!report) return null;
  const { data: events } = await sb.from("report_events").select("stage, note, actor, created_at").eq("report_id", report.id).order("created_at", { ascending: true });
  delete report.ip_hash; delete report.user_agent;
  return { report, events: events || [] };
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "PATCH") return methodNotAllowed(res, "GET, PATCH");
  try {
    const s = await requireStaff(req);
    const ref = text(req.query?.ref, 20).toUpperCase();
    if (!REF.test(ref)) return send(res, 400, { ok: false, error: "invalid" });
    const sb = supabase();

    if (req.method === "PATCH") {
      const b = readJson(req);
      if (!b) return send(res, 400, { ok: false, error: "bad_json" });
      const { patch, note, errors } = validatePatch(b);
      if (errors.length) return send(res, 400, { ok: false, error: "invalid", fields: errors });
      if (!Object.keys(patch).length && !note) return send(res, 400, { ok: false, error: "empty" });
      const { data, error } = await sb.rpc("triage_update_report", { p_ref: ref, p_patch: patch, p_actor: actorOf(s), p_note: note || null });
      if (error) {
        if (error.code === "23503") return send(res, 400, { ok: false, error: "invalid", fields: ["issue_type"] });
        if (error.code === "23514" || error.code === "22003") return send(res, 400, { ok: false, error: "invalid", fields: ["stage"] });
        console.error("triage update failed", error);
        return send(res, 500, { ok: false, error: "server_error" });
      }
      if (!data) return send(res, 404, { ok: false, error: "not_found" });
    }

    const out = await load(sb, ref);
    if (!out) return send(res, 404, { ok: false, error: "not_found" });
    return send(res, 200, { ok: true, ...out });
  } catch (e) { return handleError(res, e); }
}
