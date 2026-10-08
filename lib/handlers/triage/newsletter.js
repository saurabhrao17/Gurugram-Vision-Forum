// The newsletter, run from the desk (owner's ask, 8 Oct 2026).
// GET    /api/triage/newsletter                      -> { ok, campaigns, confirmed, channel }
// POST   /api/triage/newsletter { id?, subject, subject_hi, body, body_hi, post_id? } -> { ok, campaign }   (save a draft)
// POST   /api/triage/newsletter/preview { ...same }  -> { ok, html, html_hi }
// POST   /api/triage/newsletter/<id> { action: "test" }   -> mails the signed-in person now     (owner, coordinator, content)
// POST   /api/triage/newsletter/<id> { action: "send" }   -> to every confirmed subscriber      (owner, coordinator)
// DELETE /api/triage/newsletter/<id>                       -> removes a draft
// Mail goes through Resend as one Broadcast (mirrored contacts) or, without a
// segment, one outbox mail per subscriber (lib/newsletter.js). Nothing here is
// public; subscriber addresses never leave the server.
import { supabase } from "../../supabase.js";
import { requireStaff, handleError, actorOf, HttpError, CONTENT_ROLES, MANAGER_ROLES } from "../../auth.js";
import { send, methodNotAllowed, readJson, text } from "../../http.js";
import { siteUrl } from "../../indexnow.js";
import { validateCampaign, renderMail, channelFor, sendBroadcast, outboxRows, flushCampaign, FLUSH_NOW } from "../../newsletter.js";
import { sendMail } from "../cron.js";

const COLS = "id, subject, subject_hi, body, body_hi, post_id, status, channel, broadcast_id, recipients, sent, failed, last_error, test_sent_at, created_by, sent_by, created_at, updated_at, sent_at";
const LIST_MAX = 50;
const SUB_PAGE = 500;

async function confirmedSubscribers(sb) {
  const out = [];
  for (let from = 0; ; from += SUB_PAGE) {
    const { data, error } = await sb.from("subscribers").select("id, email, lang, token").not("confirmed_at", "is", null).is("unsubscribed_at", null).order("id", { ascending: true }).range(from, from + SUB_PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if ((data || []).length < SUB_PAGE) break;
  }
  return out;
}

// Outbox-channel campaigns show live counts from their outbox rows.
async function withOutboxCounts(sb, rows) {
  const ids = rows.filter((c) => c.channel === "outbox").map((c) => c.id);
  if (!ids.length) return rows;
  const { data, error } = await sb.from("outbox").select("campaign_id, status").in("campaign_id", ids);
  if (error) throw error;
  const agg = {};
  for (const r of data || []) { const a = agg[r.campaign_id] || (agg[r.campaign_id] = { sent: 0, failed: 0, pending: 0 }); a[r.status] = (a[r.status] || 0) + 1; }
  return rows.map((c) => {
    const a = agg[c.id];
    if (!a) return c;
    const status = a.pending ? "sending" : c.status === "draft" ? c.status : "sent";
    return { ...c, sent: a.sent, failed: a.failed, pending: a.pending, status };
  });
}

export function makeHandler({ auth, sb: sbIn, env: envIn, fetchImpl, mailImpl } = {}) {
  const requireAuth = auth || requireStaff;
  return async function handler(req, res, sb) {
  try {
    const env = envIn || process.env;
    const f = fetchImpl || fetch;
    const mail = mailImpl || sendMail;
    sb = sb || sbIn || supabase();
    const qs = req.query || {};
    const idRaw = text(qs.id, 20);
    res.setHeader("Cache-Control", "no-store");

    if (req.method === "GET") {
      await requireAuth(req, CONTENT_ROLES);
      const [list, subs] = await Promise.all([
        sb.from("campaigns").select(COLS).order("created_at", { ascending: false }).limit(LIST_MAX),
        sb.from("subscribers").select("id", { count: "exact", head: true }).not("confirmed_at", "is", null).is("unsubscribed_at", null)
      ]);
      if (list.error) throw list.error;
      if (subs.error) throw subs.error;
      return send(res, 200, { ok: true, campaigns: await withOutboxCounts(sb, list.data || []), confirmed: subs.count ?? 0, channel: channelFor(env) });
    }

    if (req.method === "DELETE") {
      await requireAuth(req, CONTENT_ROLES);
      const id = parseInt(idRaw, 10);
      if (!Number.isFinite(id) || id <= 0) throw new HttpError(404, "not_found");
      const { data, error } = await sb.from("campaigns").delete().eq("id", id).eq("status", "draft").select("id");
      if (error) throw error;
      if (!data || !data.length) throw new HttpError(404, "not_found");
      return send(res, 200, { ok: true, deleted: true, id });
    }

    if (req.method !== "POST") return methodNotAllowed(res, "GET, POST, DELETE");
    const b = readJson(req);
    if (!b) return send(res, 400, { ok: false, error: "bad_json" });

    if (idRaw === "preview") {
      await requireAuth(req, CONTENT_ROLES);
      const { errors, out } = validateCampaign(b);
      if (errors.length) return send(res, 400, { ok: false, error: "invalid", fields: errors });
      const site = siteUrl(env), unsub = `${site}/api/subscribe?unsubscribe=example`;
      const en = renderMail(out, { lang: "en", unsub, site });
      const hi = out.subject_hi && out.body_hi ? renderMail(out, { lang: "hi", unsub, site }) : null;
      return send(res, 200, { ok: true, subject: en.subject, html: en.html, subject_hi: hi ? hi.subject : null, html_hi: hi ? hi.html : null });
    }

    if (!idRaw) {
      // Save a draft (new or existing).
      const s = await requireAuth(req, CONTENT_ROLES);
      const { errors, out } = validateCampaign(b);
      if (errors.length) return send(res, 400, { ok: false, error: "invalid", fields: errors });
      const now = new Date().toISOString();
      const id = Number.isInteger(b.id) && b.id > 0 ? b.id : null;
      let q;
      if (id) q = sb.from("campaigns").update({ ...out, updated_at: now }).eq("id", id).eq("status", "draft").select(COLS).maybeSingle();
      else q = sb.from("campaigns").insert({ ...out, status: "draft", created_by: actorOf(s), updated_at: now }).select(COLS).maybeSingle();
      const { data, error } = await q;
      if (error) throw error;
      if (!data) throw new HttpError(404, "not_found");
      return send(res, 200, { ok: true, campaign: data });
    }

    const id = parseInt(idRaw, 10);
    if (!Number.isFinite(id) || id <= 0) throw new HttpError(404, "not_found");
    const action = text(b.action, 10);
    if (action !== "test" && action !== "send") return send(res, 400, { ok: false, error: "invalid", fields: ["action"] });
    const s = await requireAuth(req, action === "send" ? MANAGER_ROLES : CONTENT_ROLES);
    const { data: c, error } = await sb.from("campaigns").select(COLS).eq("id", id).maybeSingle();
    if (error) throw error;
    if (!c) throw new HttpError(404, "not_found");
    if (!env.RESEND_API_KEY) return send(res, 503, { ok: false, error: "mail_unavailable" });
    const now = new Date().toISOString();

    if (action === "test") {
      const site = siteUrl(env);
      const to = s.staff.email;
      const m = renderMail(c, { lang: "en", unsub: `${site}/api/subscribe?unsubscribe=test`, site });
      const row = { to_email: to, subject: `[Test] ${m.subject}`, body_text: m.text, body_html: m.html, kind: "newsletter_test", campaign_id: c.id };
      const { data: ins, error: ie } = await sb.from("outbox").insert(row).select("id").maybeSingle();
      if (ie) throw ie;
      try {
        await mail(row, env);
        await sb.from("outbox").update({ status: "sent", sent_at: now, attempts: 1 }).eq("id", ins?.id);
      } catch (e) {
        await sb.from("outbox").update({ attempts: 1, last_error: String(e?.message || e).slice(0, 500) }).eq("id", ins?.id);
        return send(res, 502, { ok: false, error: "send_failed", detail: String(e?.message || e).slice(0, 200) });
      }
      await sb.from("campaigns").update({ test_sent_at: now, updated_at: now }).eq("id", c.id);
      return send(res, 200, { ok: true, to, test_sent_at: now });
    }

    // send
    if (c.status !== "draft") return send(res, 409, { ok: false, error: "already_sent" });
    const channel = channelFor(env);
    const subs = await confirmedSubscribers(sb);
    if (!subs.length) return send(res, 409, { ok: false, error: "no_subscribers" });
    const by = actorOf(s);
    if (channel.mode === "broadcast") {
      const { error: le } = await sb.from("campaigns").update({ status: "sending", channel: "broadcast", recipients: subs.length, sent_by: by, updated_at: now }).eq("id", c.id).eq("status", "draft");
      if (le) throw le;
      const r = await sendBroadcast(env, c, f);
      const patch = r.ok ? { status: "sent", broadcast_id: r.id, sent: subs.length, sent_at: now, last_error: null, updated_at: now } : { status: "failed", broadcast_id: r.id || null, last_error: String(r.error || "failed").slice(0, 500), updated_at: now };
      const { data: upd, error: ue } = await sb.from("campaigns").update(patch).eq("id", c.id).select(COLS).maybeSingle();
      if (ue) throw ue;
      return send(res, r.ok ? 200 : 502, { ok: r.ok, campaign: upd || { ...c, ...patch }, channel: "broadcast", recipients: subs.length, error: r.ok ? undefined : r.error });
    }
    // outbox: queue everyone, send the first batch now, the cron takes the rest.
    const { error: le } = await sb.from("campaigns").update({ status: "sending", channel: "outbox", recipients: subs.length, sent_by: by, sent_at: now, updated_at: now }).eq("id", c.id).eq("status", "draft");
    if (le) throw le;
    const rows = outboxRows(c, subs, env);
    for (let i = 0; i < rows.length; i += 200) {
      const { error: oe } = await sb.from("outbox").insert(rows.slice(i, i + 200));
      if (oe) throw oe;
    }
    const flushed = await flushCampaign(sb, env, c.id, { limit: FLUSH_NOW, send: mail });
    const done = flushed.remaining === 0 && flushed.failed === 0;
    const patch = { status: done ? "sent" : "sending", sent: flushed.sent, failed: flushed.failed, updated_at: new Date().toISOString() };
    const { data: upd, error: ue } = await sb.from("campaigns").update(patch).eq("id", c.id).select(COLS).maybeSingle();
    if (ue) throw ue;
    return send(res, 200, { ok: true, campaign: upd || { ...c, ...patch }, channel: "outbox", recipients: subs.length, ...flushed });
  } catch (e) { return handleError(res, e); }
  };
}

export default makeHandler();
