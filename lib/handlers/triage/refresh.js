// POST /api/triage/refresh { refresh_token } -> new session + staff profile.
import { auth, staffFor, sessionOut } from "../../auth.js";
import { send, methodNotAllowed, readJson, text } from "../../http.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, "POST");
  const b = readJson(req);
  const token = b ? text(b.refresh_token, 400) : "";
  if (!token) return send(res, 400, { ok: false, error: "invalid" });
  const { data, error } = await auth().auth.refreshSession({ refresh_token: token });
  if (error || !data?.session) return send(res, 401, { ok: false, error: "expired" });
  const staff = await staffFor(data.user.id, data.user.email);
  if (!staff) return send(res, 403, { ok: false, error: "not_staff" });
  return send(res, 200, { ok: true, session: sessionOut(data.session), staff });
}
