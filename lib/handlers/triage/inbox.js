// GET   /api/triage/inbox?status=all|new|read|done -> { ok, items, counts }
// PATCH /api/triage/inbox/<id> { status?, notes? }   -> { ok, item }
// Owner and coordinator: mail that reached the Forum through the inbound
// email hook, worked from the desk like join requests. Nothing here is public.
import { supabase } from "../../supabase.js";
import { requireStaff, handleError, actorOf, MANAGER_ROLES, HttpError } from "../../auth.js";
import { send, methodNotAllowed, readJson, text } from "../../http.js";

export const INBOX_STATUSES = ["new", "read", "done"];
const COLS = "id, source, from_email, from_name, subject, body_text, received_at, status, notes, handled_by, updated_at";
const LIST_MAX = 300;

export function validateInboxPatch(b) {
  const out = {}, errors = [];
  if (b && "status" in b) { const s = text(b.status, 10); if (INBOX_STATUSES.includes(s)) out.status = s; else errors.push("status"); }
  if (b && "notes" in b) { if (typeof b.notes === "string") out.notes = b.notes.trim().slice(0, 4000) || null; else errors.push("notes"); }
  if (!errors.length && !Object.keys(out).length) errors.push("empty");
  return { value: out, errors };
}

export function makeHandler({ auth, sb: sbIn } = {}) {
  const requireAuth = auth || requireStaff;
  return async function handler(req, res, sb) {
  try {
    const s = await requireAuth(req, MANAGER_ROLES);
    sb = sb || sbIn || supabase();
    const qs = req.query || {};
    const id = text(qs.id, 60);
    if (req.method === "PATCH") {
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "not_found");
      const b = readJson(req);
      if (!b) return send(res, 400, { ok: false, error: "bad_json" });
      const { value, errors } = validateInboxPatch(b);
      if (errors.length) return send(res, 400, { ok: false, error: "invalid", fields: errors });
      const { data, error } = await sb.from("inbox").update({ ...value, handled_by: actorOf(s), updated_at: new Date().toISOString() }).eq("id", id).select(COLS).maybeSingle();
      if (error) throw error;
      if (!data) throw new HttpError(404, "not_found");
      res.setHeader("Cache-Control", "no-store");
      return send(res, 200, { ok: true, item: data });
    }
    if (req.method !== "GET") return methodNotAllowed(res, "GET, PATCH");
    const status = text(qs.status, 10) || "all";
    let q = sb.from("inbox").select(COLS).order("received_at", { ascending: false }).limit(LIST_MAX);
    if (INBOX_STATUSES.includes(status)) q = q.eq("status", status);
    const [list, all] = await Promise.all([q, sb.from("inbox").select("status")]);
    if (list.error) throw list.error;
    if (all.error) throw all.error;
    const counts = { new: 0, read: 0, done: 0, total: 0 };
    for (const r of all.data || []) { counts.total++; if (r.status in counts) counts[r.status]++; }
    res.setHeader("Cache-Control", "no-store");
    return send(res, 200, { ok: true, items: list.data || [], counts, status });
  } catch (e) { return handleError(res, e); }
  };
}

export default makeHandler();
