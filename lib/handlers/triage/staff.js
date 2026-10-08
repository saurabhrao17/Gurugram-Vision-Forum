// Volunteer accounts. Owners and coordinators may list and add (coordinators
// may add triage and content accounts, only the owner may add coordinators);
// owners may remove.
// GET    /api/triage/staff
// POST   /api/triage/staff   { email, password, name, role, phone? }
// DELETE /api/triage/staff   { user_id }
import { supabase } from "../../supabase.js";
import { requireStaff, handleError, isOwner, MANAGER_ROLES } from "../../auth.js";
import { send, methodNotAllowed, readJson, text, isEmail, normalisePhone } from "../../http.js";

// Roles an account may be created with; "owner" is set in the database only.
export const CREATABLE_ROLES = ["coordinator", "triage", "content"];
export const COORDINATOR_CREATABLE = ["triage", "content"];

export default async function handler(req, res) {
  try {
    const s = await requireStaff(req, MANAGER_ROLES);
    const sb = supabase();

    if (req.method === "GET") {
      const [{ data, error }, { data: wv }] = await Promise.all([
        sb.from("staff").select("user_id, name, role, email, phone, active, created_at").order("created_at"),
        sb.from("ward_volunteers").select("user_id, ward, role")
      ]);
      if (error) throw error;
      const byUser = {};
      (wv || []).forEach((x) => { (byUser[x.user_id] = byUser[x.user_id] || []).push({ ward: x.ward, role: x.role }); });
      return send(res, 200, { ok: true, staff: data.map((x) => ({ ...x, wards: (byUser[x.user_id] || []).sort((a, b) => a.ward - b.ward) })) });
    }

    if (req.method === "POST") {
      const b = readJson(req);
      if (!b) return send(res, 400, { ok: false, error: "bad_json" });
      const email = text(b.email, 160).toLowerCase();
      const password = typeof b.password === "string" ? b.password : "";
      const name = text(b.name, 120);
      const role = text(b.role, 20) || "triage";
      const phone = b.phone ? normalisePhone(b.phone) : null;
      const errors = [];
      if (b.phone && !phone) errors.push("phone");
      if (!isEmail(email)) errors.push("email");
      if (password.length < 10) errors.push("password");
      if (!name) errors.push("name");
      if (!CREATABLE_ROLES.includes(role)) errors.push("role");
      else if (!isOwner(s) && !COORDINATOR_CREATABLE.includes(role)) errors.push("role");
      if (errors.length) return send(res, 400, { ok: false, error: "invalid", fields: errors });

      const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
      if (error) {
        const dup = /already|exists|registered/i.test(error.message || "");
        return send(res, dup ? 409 : 500, { ok: false, error: dup ? "exists" : "server_error" });
      }
      const { error: e2 } = await sb.from("staff").insert({ user_id: data.user.id, name, role, email, phone });
      if (e2) throw e2;
      return send(res, 201, { ok: true, staff: { user_id: data.user.id, name, role, email, phone } });
    }

    if (req.method === "DELETE") {
      if (!isOwner(s)) return send(res, 403, { ok: false, error: "forbidden" });
      const b = readJson(req);
      const userId = b ? text(b.user_id, 60) : "";
      if (!userId) return send(res, 400, { ok: false, error: "invalid" });
      if (userId === s.user.id) return send(res, 400, { ok: false, error: "cannot_remove_self" });
      const { error } = await sb.from("staff").delete().eq("user_id", userId);
      if (error) throw error;
      await sb.auth.admin.deleteUser(userId).catch((e) => console.error("auth delete failed", e));
      return send(res, 200, { ok: true });
    }

    return methodNotAllowed(res, "GET, POST, DELETE");
  } catch (e) { return handleError(res, e); }
}
