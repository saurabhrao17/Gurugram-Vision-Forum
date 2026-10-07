// POST /api/triage/login { email, password } -> session + staff profile.
// Accounts are created by the coordinator (see api/triage/staff.js).
import { auth, staffFor, sessionOut } from "../../lib/auth.js";
import { send, methodNotAllowed, readJson, text, isEmail } from "../../lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, "POST");
  const b = readJson(req);
  if (!b) return send(res, 400, { ok: false, error: "bad_json" });
  const email = text(b.email, 160).toLowerCase();
  const password = typeof b.password === "string" ? b.password : "";
  if (!isEmail(email) || !password) return send(res, 400, { ok: false, error: "invalid" });
  const { data, error } = await auth().auth.signInWithPassword({ email, password });
  if (error || !data?.session) return send(res, 401, { ok: false, error: "bad_credentials" });
  const staff = await staffFor(data.user.id, data.user.email);
  if (!staff) return send(res, 403, { ok: false, error: "not_staff" });
  return send(res, 200, { ok: true, session: sessionOut(data.session), staff });
}
