// POST /api/mission/login { email, password } -> session + { member: { role } }.
// A valid account that is not an active Mission member gets 403 and no session.
import { auth, sessionOut } from "../../auth.js";
import { readJson, text, isEmail } from "../../http.js";
import { reply, methodNot, fail, memberFor } from "../../mission-auth.js";

export function makeHandler(deps = {}) {
  return async function handler(req, res) {
    if (req.method !== "POST") return methodNot(res, "POST");
    try {
      const b = readJson(req);
      if (!b) return reply(res, 400, { ok: false, error: "bad_json" });
      const email = text(b.email, 160).toLowerCase();
      const password = typeof b.password === "string" ? b.password.slice(0, 200) : "";
      if (!isEmail(email) || !password) return reply(res, 400, { ok: false, error: "invalid" });
      const client = deps.authClient || auth();
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data?.session) return reply(res, 401, { ok: false, error: "bad_credentials" });
      const member = await memberFor(data.user.id, deps.sb);
      if (!member) return reply(res, 403, { ok: false, error: "not_member" });
      return reply(res, 200, { ok: true, session: sessionOut(data.session), member: { role: member.role } });
    } catch (e) { return fail(res, e); }
  };
}
export default makeHandler();
