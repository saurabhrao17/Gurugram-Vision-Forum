// GET   /api/triage/joins?status=all|new|contacted|onboarded|declined&q=   -> { ok, joins, counts }
// GET   /api/triage/joins?format=csv&status=                               -> joins.csv download
// PATCH /api/triage/joins/<id> { status?, notes? }                        -> { ok, join }
// Owner and coordinator only: the sign-ups from the public Join form, with a
// small workflow (new -> contacted -> onboarded | declined) and internal
// notes. Nothing here is ever rendered publicly.
import { supabase } from "../../supabase.js";
import { requireStaff, handleError, actorOf, MANAGER_ROLES, HttpError } from "../../auth.js";
import { send, methodNotAllowed, readJson, text } from "../../http.js";
import { toCsv } from "./visitors.js";

export const STATUSES = ["new", "contacted", "onboarded", "declined"];
const COLS = "id, name, phone, email, role, area, note, status, notes, handled_by, created_at, updated_at";
const CSV_COLS = ["name", "phone", "email", "role", "area", "note", "status", "notes", "created_at"];
const LIST_MAX = 500;
const NOTES_MAX = 4000;

// Validates a PATCH body: only status and notes, both optional, at least one.
export function validateJoinPatch(b) {
  const out = {}, errors = [];
  if (b && "status" in b) { const s = text(b.status, 20); if (STATUSES.includes(s)) out.status = s; else errors.push("status"); }
  if (b && "notes" in b) { if (typeof b.notes === "string") out.notes = b.notes.trim().slice(0, NOTES_MAX) || null; else errors.push("notes"); }
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
      const { value, errors } = validateJoinPatch(b);
      if (errors.length) return send(res, 400, { ok: false, error: "invalid", fields: errors });
      const row = { ...value, handled_by: actorOf(s), updated_at: new Date().toISOString() };
      const { data, error } = await sb.from("joins").update(row).eq("id", id).select(COLS).maybeSingle();
      if (error) throw error;
      if (!data) throw new HttpError(404, "not_found");
      res.setHeader("Cache-Control", "no-store");
      return send(res, 200, { ok: true, join: data });
    }
    if (req.method !== "GET") return methodNotAllowed(res, "GET, PATCH");

    const status = text(qs.status, 20) || "all";
    const q = text(qs.q, 80).replace(/[,()%\\]/g, " ").trim();
    let query = sb.from("joins").select(text(qs.format, 10) === "csv" ? CSV_COLS.join(", ") : COLS).order("created_at", { ascending: false }).limit(LIST_MAX);
    if (STATUSES.includes(status)) query = query.eq("status", status);
    if (q) query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%,area.ilike.%${q}%`);

    if (text(qs.format, 10) === "csv") {
      const { data, error } = await query;
      if (error) throw error;
      res.status(200);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="join-requests.csv"');
      res.setHeader("Cache-Control", "no-store");
      return res.end(toCsv(data || [], CSV_COLS));
    }

    const [list, all] = await Promise.all([query, sb.from("joins").select("status")]);
    if (list.error) throw list.error;
    if (all.error) throw all.error;
    const counts = { new: 0, contacted: 0, onboarded: 0, declined: 0, total: 0 };
    for (const r of all.data || []) { counts.total++; if (r.status in counts) counts[r.status]++; }
    res.setHeader("Cache-Control", "no-store");
    return send(res, 200, { ok: true, joins: list.data || [], counts, status, q });
  } catch (e) { return handleError(res, e); }
  };
}

export default makeHandler();
