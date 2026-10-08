// GET   /api/triage/subscribers?status=all|confirmed|pending|unsubscribed&q=  -> { ok, items, counts, sync }
// GET   /api/triage/subscribers?export=csv                                     -> subscribers.csv
// POST  /api/triage/subscribers { email, lang }                                -> { ok, status: "check_email" }  (sends the confirmation mail; never subscribes anyone silently)
// PATCH /api/triage/subscribers/<id> { action: unsubscribe|resubscribe|sync|delete } -> { ok, item } (delete: { ok, deleted: true })
// Owner only: the weekly-digest list is personal data, kept like the visitor
// register. Every change is mirrored to Resend contacts (lib/audience.js).
import { supabase } from "../../supabase.js";
import { requireStaff, handleError, HttpError } from "../../auth.js";
import { send, methodNotAllowed, readJson, text } from "../../http.js";
import { toCsv } from "./visitors.js";
import { validateSubscribe, confirmMail, newToken } from "../subscribe.js";
import { syncEnabled, syncSubscriber, pushDelete } from "../../audience.js";
import { queueMail } from "../../outbox.js";

export const SUB_STATUSES = ["all", "confirmed", "pending", "unsubscribed"];
export const SUB_ACTIONS = ["unsubscribe", "resubscribe", "sync", "delete"];
const COLS = "id, email, lang, source, created_at, confirmed_at, unsubscribed_at, synced_at, sync_error, external_id";
const CSV_COLS = ["email", "lang", "status", "source", "created_at", "confirmed_at", "unsubscribed_at", "synced_at"];
const LIST_MAX = 500;
const EXPORT_MAX = 10000;

export const statusOf = (r) => (r.unsubscribed_at ? "unsubscribed" : r.confirmed_at ? "confirmed" : "pending");

export function countsOf(rows) {
  const c = { total: 0, confirmed: 0, pending: 0, unsubscribed: 0, synced: 0, sync_failed: 0 };
  for (const r of rows || []) {
    c.total++; c[statusOf(r)]++;
    if (r.confirmed_at && r.synced_at) c.synced++;
    if (r.confirmed_at && !r.synced_at && r.sync_error) c.sync_failed++;
  }
  return c;
}

export function validateAction(b) {
  const a = text(b?.action, 20);
  return SUB_ACTIONS.includes(a) ? { value: a, errors: [] } : { value: null, errors: ["action"] };
}

function applyStatus(q, status) {
  if (status === "confirmed") return q.not("confirmed_at", "is", null).is("unsubscribed_at", null);
  if (status === "pending") return q.is("confirmed_at", null).is("unsubscribed_at", null);
  if (status === "unsubscribed") return q.not("unsubscribed_at", "is", null);
  return q;
}

export function makeHandler({ auth, sb: sbIn, env: envIn, fetchImpl, mailImpl } = {}) {
  const requireAuth = auth || requireStaff;
  return async function handler(req, res, sb) {
  try {
    await requireAuth(req, ["owner"]);
    sb = sb || sbIn || supabase();
    const env = envIn || process.env;
    const f = fetchImpl || fetch;
    const qs = req.query || {};
    res.setHeader("Cache-Control", "no-store");

    if (req.method === "PATCH") {
      const id = parseInt(text(qs.id, 20), 10);
      if (!Number.isFinite(id) || id <= 0) throw new HttpError(404, "not_found");
      const b = readJson(req);
      if (!b) return send(res, 400, { ok: false, error: "bad_json" });
      const { value: action, errors } = validateAction(b);
      if (errors.length) return send(res, 400, { ok: false, error: "invalid", fields: errors });
      const { data: row, error } = await sb.from("subscribers").select(COLS).eq("id", id).maybeSingle();
      if (error) throw error;
      if (!row) throw new HttpError(404, "not_found");
      const now = new Date().toISOString();
      if (action === "delete") {
        if (row.confirmed_at) await pushDelete(env, row.email, f).catch(() => null);
        const { error: de } = await sb.from("subscribers").delete().eq("id", id);
        if (de) throw de;
        return send(res, 200, { ok: true, deleted: true, id });
      }
      let patch = null;
      if (action === "unsubscribe" && !row.unsubscribed_at) patch = { unsubscribed_at: now, synced_at: null, updated_at: now };
      if (action === "resubscribe" && row.unsubscribed_at) {
        // Only someone who once confirmed can be put back; a pending address gets a fresh confirmation mail instead.
        if (!row.confirmed_at) return send(res, 409, { ok: false, error: "unconfirmed" });
        patch = { unsubscribed_at: null, synced_at: null, updated_at: now };
      }
      if (action === "sync") patch = { synced_at: null, sync_error: null, updated_at: now };
      let item = row;
      if (patch) {
        const { data, error: ue } = await sb.from("subscribers").update(patch).eq("id", id).select(COLS).maybeSingle();
        if (ue) throw ue;
        item = data || { ...row, ...patch };
      }
      const r = await syncSubscriber(sb, env, item, f);
      if (r.ok) item = { ...item, synced_at: now, sync_error: null };
      else if (!r.skipped) item = { ...item, sync_error: r.error || "failed" };
      return send(res, 200, { ok: true, item, sync: r });
    }

    if (req.method === "POST") {
      const b = readJson(req);
      if (!b) return send(res, 400, { ok: false, error: "bad_json" });
      const { errors, out } = validateSubscribe({ ...b, source: "desk" });
      if (errors.length) return send(res, 400, { ok: false, error: "invalid", fields: errors });
      const { data: existing, error } = await sb.from("subscribers").select("id, confirmed_at, unsubscribed_at").eq("email", out.email).maybeSingle();
      if (error) throw error;
      if (existing && existing.confirmed_at && !existing.unsubscribed_at) return send(res, 200, { ok: true, status: "already_subscribed" });
      const token = newToken();
      const { error: ue } = await sb.from("subscribers").upsert({ email: out.email, lang: out.lang, token, source: "desk", confirmed_at: null, unsubscribed_at: null, synced_at: null, sync_error: null }, { onConflict: "email" });
      if (ue) throw ue;
      const q = await queueMail(sb, env, confirmMail(out.email, out.lang, token, env), mailImpl ? { send: mailImpl } : {});
      return send(res, 200, { ok: true, status: "check_email", sent: q.sent });
    }

    if (req.method !== "GET") return methodNotAllowed(res, "GET, POST, PATCH");
    const status = SUB_STATUSES.includes(text(qs.status, 20)) ? text(qs.status, 20) : "all";
    const q = text(qs.q, 120).toLowerCase().replace(/[%_,()]/g, "");

    if (text(qs.export, 10) === "csv") {
      const { data, error } = await applyStatus(sb.from("subscribers").select(COLS), status).order("created_at", { ascending: false }).limit(EXPORT_MAX);
      if (error) throw error;
      res.status(200);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="subscribers.csv"');
      return res.end(toCsv((data || []).map((r) => ({ ...r, status: statusOf(r) })), CSV_COLS));
    }

    let list = applyStatus(sb.from("subscribers").select(COLS), status).order("created_at", { ascending: false }).limit(LIST_MAX);
    if (q) list = list.ilike("email", `%${q}%`);
    const [rows, all] = await Promise.all([list, sb.from("subscribers").select("confirmed_at, unsubscribed_at, synced_at, sync_error")]);
    if (rows.error) throw rows.error;
    if (all.error) throw all.error;
    const items = (rows.data || []).map((r) => ({ ...r, status: statusOf(r) }));
    return send(res, 200, { ok: true, items, counts: countsOf(all.data || []), status, q, sync: { enabled: syncEnabled(env), provider: syncEnabled(env) ? "resend" : null } });
  } catch (e) { return handleError(res, e); }
  };
}

export default makeHandler();
