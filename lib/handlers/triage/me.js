// GET /api/triage/me -> the signed-in volunteer's profile.
import { requireStaff, handleError } from "../../auth.js";
import { send, methodNotAllowed } from "../../http.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, "GET");
  try {
    const s = await requireStaff(req);
    return send(res, 200, { ok: true, staff: s.staff });
  } catch (e) { return handleError(res, e); }
}
