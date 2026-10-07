// POST /api/triage/password { password } -> the signed-in volunteer changes their own password.
import { requireStaff, handleError } from "../../auth.js";
import { supabase } from "../../supabase.js";
import { send, methodNotAllowed, readJson } from "../../http.js";

export function validatePassword(p) {
  if (typeof p !== "string" || p.length < 10 || p.length > 128) return "Use 10 to 128 characters.";
  if (!/[a-z]/i.test(p) || !/\d/.test(p)) return "Use letters and at least one number.";
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, "POST");
  try {
    const s = await requireStaff(req);
    const b = readJson(req) || {};
    const err = validatePassword(b.password);
    if (err) return send(res, 400, { ok: false, error: "weak_password", message: err });
    const { error } = await supabase().auth.admin.updateUserById(s.staff.user_id, { password: b.password });
    if (error) { console.error("password change failed", error); return send(res, 500, { ok: false, error: "server_error" }); }
    return send(res, 200, { ok: true });
  } catch (e) { return handleError(res, e); }
}
