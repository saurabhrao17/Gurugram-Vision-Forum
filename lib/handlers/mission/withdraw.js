// POST /api/mission/withdraw -> switches off ONLY the caller's own access.
// The member id comes from the verified token, never from the request body.
// The write goes through mission_withdraw_self (supabase/migrations/
// 20261114010000_mission_withdraw.sql), which names the actor for the history.
import { supabase } from "../../supabase.js";
import { requireMember, reply, methodNot, fail } from "../../mission-auth.js";

export function makeHandler(deps = {}) {
  return async function handler(req, res) {
    if (req.method !== "POST") return methodNot(res, "POST");
    try {
      const sb = deps.sb || supabase();
      const m = await requireMember(req, null, { ...deps, sb });
      const { data, error } = await sb.rpc("mission_withdraw_self", { p_user: m.user.id });
      if (error) throw new Error("mission_withdraw_self failed");
      return reply(res, 200, { ok: true, withdrawn: data === true });
    } catch (e) { return fail(res, e); }
  };
}
export default makeHandler();
