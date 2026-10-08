// GET /api/triage/team                      -> { ok, people, wards }: the roster and who covers which ward
// PUT /api/triage/team { user_id, name?, phone?, active?, wards?: [{ward, role}] } -> { ok, person }
// Owner and coordinator. Roles per ward: coordinator (a cluster of 5-6
// wards), lead (main lead) and support. Assignment is per person; the
// set_staff_wards() function replaces the person's list in one transaction.
import { supabase } from "../../supabase.js";
import { requireStaff, handleError, actorOf, MANAGER_ROLES, HttpError } from "../../auth.js";
import { send, methodNotAllowed, readJson, text, normalisePhone } from "../../http.js";

export const WARD_ROLES = ["coordinator", "lead", "support"];
const PEOPLE_COLS = "user_id, name, role, email, phone, active, created_at";

export function validateTeamPatch(b) {
  const out = {}, errors = [];
  if (!b || typeof b !== "object") return { value: out, errors: ["body"] };
  if ("name" in b) { const n = text(b.name, 120); if (n) out.name = n; else errors.push("name"); }
  if ("phone" in b) {
    if (b.phone === null || b.phone === "") out.phone = null;
    else { const p = normalisePhone(b.phone); if (p) out.phone = p; else errors.push("phone"); }
  }
  if ("active" in b) { if (typeof b.active === "boolean") out.active = b.active; else errors.push("active"); }
  let wards;
  if ("wards" in b) {
    if (!Array.isArray(b.wards)) errors.push("wards");
    else {
      wards = [];
      const seen = new Set();
      for (const w of b.wards) {
        const ward = parseInt(w && w.ward, 10), role = text(w && w.role, 20);
        if (!(ward >= 1 && ward <= 36) || !WARD_ROLES.includes(role)) { errors.push("wards"); break; }
        const k = `${ward}:${role}`;
        if (!seen.has(k)) { seen.add(k); wards.push({ ward, role }); }
      }
    }
  }
  if (!errors.length && !Object.keys(out).length && wards === undefined) errors.push("empty");
  return { value: out, wards, errors: [...new Set(errors)] };
}

async function roster(sb) {
  const [people, wv, wards] = await Promise.all([
    sb.from("staff").select(PEOPLE_COLS).order("created_at"),
    sb.from("ward_volunteers").select("user_id, ward, role"),
    sb.from("ward_assignments").select("*").order("ward")
  ]);
  if (people.error) throw people.error;
  if (wv.error) throw wv.error;
  if (wards.error) throw wards.error;
  const byUser = {};
  for (const x of wv.data || []) (byUser[x.user_id] = byUser[x.user_id] || []).push({ ward: x.ward, role: x.role });
  const list = (people.data || []).map((p) => ({ ...p, wards: (byUser[p.user_id] || []).sort((a, b) => a.ward - b.ward) }));
  return { people: list, wards: wards.data || [] };
}

export function makeHandler({ auth, sb: sbIn } = {}) {
  const requireAuth = auth || requireStaff;
  return async function handler(req, res, sb) {
  try {
    const s = await requireAuth(req, MANAGER_ROLES);
    sb = sb || sbIn || supabase();
    if (req.method === "GET") {
      res.setHeader("Cache-Control", "no-store");
      return send(res, 200, { ok: true, ...(await roster(sb)) });
    }
    if (req.method !== "PUT") return methodNotAllowed(res, "GET, PUT");
    const b = readJson(req);
    if (!b) return send(res, 400, { ok: false, error: "bad_json" });
    const userId = text(b.user_id, 60);
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return send(res, 400, { ok: false, error: "invalid", fields: ["user_id"] });
    const { value, wards, errors } = validateTeamPatch(b);
    if (errors.length) return send(res, 400, { ok: false, error: "invalid", fields: errors });
    const { data: st, error: se } = await sb.from("staff").select(PEOPLE_COLS).eq("user_id", userId).maybeSingle();
    if (se) throw se;
    if (!st) throw new HttpError(404, "not_found");
    if (Object.keys(value).length) {
      const { error } = await sb.from("staff").update(value).eq("user_id", userId);
      if (error) throw error;
    }
    let held = null;
    if (wards !== undefined) {
      const { data, error } = await sb.rpc("set_staff_wards", { p_user: userId, p_wards: wards, p_by: actorOf(s) });
      if (error) throw error;
      held = Array.isArray(data) ? data : wards;
    }
    const { data: after, error: ae } = await sb.from("staff").select(PEOPLE_COLS).eq("user_id", userId).maybeSingle();
    if (ae) throw ae;
    if (held === null) {
      const { data: wv } = await sb.from("ward_volunteers").select("ward, role").eq("user_id", userId);
      held = (wv || []).map((x) => ({ ward: x.ward, role: x.role })).sort((a, b) => a.ward - b.ward);
    }
    res.setHeader("Cache-Control", "no-store");
    return send(res, 200, { ok: true, person: { ...(after || st), wards: held } });
  } catch (e) { return handleError(res, e); }
  };
}

export default makeHandler();
