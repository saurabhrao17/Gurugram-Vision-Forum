// POST /api/mission/refresh { refresh_token } -> new session + { member: { role } }.
// Keeps a member signed in; a member who was switched off gets 403 and no session.
import { auth, sessionOut } from "../../auth.js";
import { readJson, text } from "../../http.js";
import { reply, methodNot, fail, memberFor } from "../../mission-auth.js";

export function makeHandler(deps = {}) {
  return async function handler(req, res) {
    if (req.method !== "POST") return methodNot(res, "POST");
    try {
      const b = readJson(req);
      const token = b ? text(b.refresh_token, 400) : "";
      if (!token) return reply(res, 400, { ok: false, error: "invalid" });
      const client = deps.authClient || auth();
      const { data, error } = await client.auth.refreshSession({ refresh_token: token });
      if (error || !data?.session) return reply(res, 401, { ok: false, error: "expired" });
      const member = await memberFor(data.user.id, deps.sb);
      if (!member) return reply(res, 403, { ok: false, error: "not_member" });
      return reply(res, 200, { ok: true, session: sessionOut(data.session), member: { role: member.role } });
    } catch (e) { return fail(res, e); }
  };
}
export default makeHandler();
