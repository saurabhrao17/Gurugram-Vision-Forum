// GET /api/mission/me -> { ok, member: { role } } for the signed-in active member.
import { requireMember, reply, methodNot, fail } from "../../mission-auth.js";

export function makeHandler(deps = {}) {
  return async function handler(req, res) {
    if (req.method !== "GET") return methodNot(res, "GET");
    try {
      const m = await requireMember(req, null, deps);
      return reply(res, 200, { ok: true, member: { role: m.member.role } });
    } catch (e) { return fail(res, e); }
  };
}
export default makeHandler();
