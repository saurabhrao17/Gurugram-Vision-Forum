// GET /api/triage/wards                 -> every ward with its lead and support volunteer (any staff)
// PUT /api/triage/wards { ward, role, user_id | null } -> assign or clear (owner, coordinator)
import { supabase } from "../../lib/supabase.js";
import { requireStaff, handleError, isManager, actorOf } from "../../lib/auth.js";
import { send, methodNotAllowed, readJson, text } from "../../lib/http.js";

export default async function handler(req, res) {
  try {
    const s = await requireStaff(req);
    const sb = supabase();
    if (req.method === "GET") {
      const { data, error } = await sb.from("ward_assignments").select("*").order("ward");
      if (error) throw error;
      return send(res, 200, { ok: true, wards: data });
    }
    if (req.method === "PUT") {
      if (!isManager(s)) return send(res, 403, { ok: false, error: "forbidden" });
      const b = readJson(req);
      if (!b) return send(res, 400, { ok: false, error: "bad_json" });
      const ward = parseInt(b.ward, 10);
      const role = text(b.role, 10);
      const userId = b.user_id ? text(b.user_id, 60) : null;
      if (!(ward >= 1 && ward <= 36) || !["lead", "support"].includes(role)) return send(res, 400, { ok: false, error: "invalid" });
      if (userId) {
        const { data: st } = await sb.from("staff").select("user_id, role").eq("user_id", userId).maybeSingle();
        if (!st) return send(res, 400, { ok: false, error: "invalid", fields: ["user_id"] });
        const { error } = await sb.from("ward_volunteers").upsert({ ward, role, user_id: userId, assigned_at: new Date().toISOString(), assigned_by: actorOf(s) }, { onConflict: "ward,role" });
        if (error) throw error;
      } else {
        const { error } = await sb.from("ward_volunteers").delete().eq("ward", ward).eq("role", role);
        if (error) throw error;
      }
      const { data } = await sb.from("ward_assignments").select("*").eq("ward", ward).single();
      return send(res, 200, { ok: true, ward: data });
    }
    return methodNotAllowed(res, "GET, PUT");
  } catch (e) { return handleError(res, e); }
}
