// Sign-in guard for the private Mission page (/mission). A person gets in only
// when their Supabase Auth token is valid AND they have an ACTIVE row in
// public.mission_member. Being a desk volunteer or the desk owner is not
// enough, and being a Mission member gives nothing on /api/triage/* (the desk
// checks its own staff table). lib/auth.js is reused by import and not changed.
// Mission code must never import mail, outbox, social, newsletter, audience,
// replies, reports, visitor or brief code (tests/unit/mission-signin.test.mjs).
import { supabase } from "./supabase.js";
import { bearer, HttpError } from "./auth.js";

export const MISSION_ROLES = ["viewer", "contributor", "admin"];

// Every Mission answer is private: never kept by the browser or the CDN.
export function reply(res, status, body) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Vary", "Authorization");
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export function methodNot(res, allow) {
  res.setHeader("Allow", allow);
  reply(res, 405, { ok: false, error: "method_not_allowed" });
}

export function fail(res, e) {
  if (e instanceof HttpError) return reply(res, e.status, { ok: false, error: e.code });
  console.error(e);
  return reply(res, 500, { ok: false, error: "server_error" });
}

// The active member row for a user, or null. A database error throws: the
// answer is then 500 (closed), never "allowed".
export async function memberFor(userId, sb = supabase()) {
  const { data, error } = await sb.from("mission_member").select("user_id, role, active").eq("user_id", userId).maybeSingle();
  if (error) throw new Error("mission_member lookup failed");
  if (!data || data.active !== true || !MISSION_ROLES.includes(data.role)) return null;
  return { user_id: data.user_id, role: data.role };
}

// Resolves the signed-in member or throws HttpError 401 / 403.
// deps ({ sb, getUser }) are injectable for tests.
export async function requireMember(req, roles, deps = {}) {
  const token = bearer(req);
  if (!token) throw new HttpError(401, "unauthenticated");
  const sb = deps.sb || supabase();
  const { data, error } = await (deps.getUser ? deps.getUser(token) : sb.auth.getUser(token));
  if (error || !data?.user) throw new HttpError(401, "unauthenticated");
  const member = await memberFor(data.user.id, sb);
  if (!member) throw new HttpError(403, "not_member");
  if (roles && !roles.includes(member.role)) throw new HttpError(403, "forbidden");
  return { user: data.user, member };
}
