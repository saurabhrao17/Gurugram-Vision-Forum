// GET /api/status?ref=GVF-2026-ABCDE&last4=1234
// Returns stage and dates only when the reference and the last four digits of
// the reporter's mobile match. Anything else is 404.
import { supabase } from "../lib/supabase.js";
import { send, methodNotAllowed, text } from "../lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, "GET");
  const ref = text(req.query?.ref, 20).toUpperCase();
  const last4 = text(req.query?.last4, 4);
  if (!/^GVF-\d{4}-[A-Z2-9]{5}$/.test(ref) || !/^\d{4}$/.test(last4)) {
    return send(res, 400, { ok: false, error: "invalid" });
  }
  const { data, error } = await supabase().rpc("report_status", { p_ref: ref, p_last4: last4 });
  if (error) {
    console.error("status lookup failed", error);
    return send(res, 500, { ok: false, error: "server_error" });
  }
  if (!data) return send(res, 404, { ok: false, error: "not_found" });
  return send(res, 200, { ok: true, report: data });
}
