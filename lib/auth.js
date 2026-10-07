// Volunteer authentication for the triage API. Volunteers sign in with
// Supabase Auth (email + password); every triage request carries the access
// token as a bearer and is checked against the staff table.
import { createClient } from "@supabase/supabase-js";
import { supabase } from "./supabase.js";
import { send } from "./http.js";

let authClient;
// Client for sign-in and refresh calls. Prefers the publishable key when set.
export function auth() {
  if (authClient) return authClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and a Supabase key must be set");
  authClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return authClient;
}

export class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

export function bearer(req) {
  const h = req.headers?.authorization || "";
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m ? m[1] : null;
}

export async function staffFor(userId, email) {
  const sb = supabase();
  const { data } = await sb.from("staff").select("user_id, name, role, email").eq("user_id", userId).maybeSingle();
  if (!data) return null;
  let wards = [];
  if (data.role === "triage") { const { data: w } = await sb.rpc("staff_wards", { p_user: userId }); wards = Array.isArray(w) ? w : []; }
  return { user_id: data.user_id, name: data.name, role: data.role, email: data.email || email, wards };
}

export const sessionOut = (s) => ({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at });

// Resolves the signed-in volunteer or throws HttpError 401/403.
export async function requireStaff(req, roles) {
  const token = bearer(req);
  if (!token) throw new HttpError(401, "unauthenticated");
  const { data, error } = await supabase().auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, "unauthenticated");
  const staff = await staffFor(data.user.id, data.user.email);
  if (!staff) throw new HttpError(403, "not_staff");
  if (roles && !roles.includes(staff.role)) throw new HttpError(403, "forbidden");
  return { user: data.user, staff };
}

export const actorOf = (s) => (s.staff.name ? `${s.staff.name} <${s.staff.email}>` : s.staff.email);

export function handleError(res, e) {
  if (e instanceof HttpError) return send(res, e.status, { ok: false, error: e.code });
  console.error(e);
  return send(res, 500, { ok: false, error: "server_error" });
}

// Wards a volunteer may work on. Owners and coordinators are unscoped (null);
// the content role never reaches a reports handler (requireStaff refuses it).
export async function scopeFor(s) {
  if (s.staff.role !== "triage") return null;
  const { data } = await supabase().rpc("staff_wards", { p_user: s.user.id });
  return Array.isArray(data) ? data : [];
}
export const isManager = (s) => s.staff.role === "owner" || s.staff.role === "coordinator";

// Roles. The owner sees everything; coordinators run operations; ward
// volunteers (triage) see only the reports of their wards; the content team
// sees only content. Handlers pass the allowed list to requireStaff.
export const ROLES = ["owner", "coordinator", "triage", "content"];
export const CONTENT_ROLES = ["owner", "coordinator", "content"];
export const REPORT_ROLES = ["owner", "coordinator", "triage"];
export const MANAGER_ROLES = ["owner", "coordinator"];
const roleOf = (s) => (s && s.staff ? s.staff.role : s && s.role) || "";
export const isOwner = (s) => roleOf(s) === "owner";
export const canContent = (s) => CONTENT_ROLES.includes(roleOf(s));
export const canReports = (s) => REPORT_ROLES.includes(roleOf(s));
