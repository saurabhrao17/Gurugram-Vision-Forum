// POST /api/hooks/email: inbound mail lands in the desk's inbox (owner's ask:
// nothing stays in a mailbox nobody reads).
// Two senders are understood:
//  * Resend "email.received" webhooks (Svix-signed with RESEND_WEBHOOK_SECRET):
//    the event carries only ids, so the message is fetched from Resend's
//    receiving API with RESEND_API_KEY;
//  * any forwarder (Cloudflare Email Routing worker, Zapier, a script) that
//    POSTs {id?, from, name?, subject, text} with ?token= or X-Webhook-Token
//    equal to EMAIL_HOOK_TOKEN.
// Dedupe is on external_id. Never replies; the desk is the record.
// The same URL takes Resend's contact.updated / contact.deleted events: an
// unsubscribe made through a Broadcast's link stops the Forum's own digest
// too (subscribers.unsubscribed_at), and a contact deleted there is treated
// the same; a contact re-subscribed there is put back only if it had once
// confirmed here (double opt-in is never bypassed).
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabase } from "../../supabase.js";
import { send, methodNotAllowed, text } from "../../http.js";
import { rawBody } from "./whatsapp.js";

const RESEND_API = "https://api.resend.com";
const BODY_MAX = 20000;

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""), "utf8"), y = Buffer.from(String(b || ""), "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

// Svix signature: base64(HMAC-SHA256(secret, `${id}.${timestamp}.${body}`)); the
// header may list several "v1,<sig>" values; the secret is base64 after "whsec_".
export function svixOk(secret, headers, raw) {
  if (!secret) return false;
  const id = headers["svix-id"], ts = headers["svix-timestamp"], sig = headers["svix-signature"];
  if (!id || !ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = Buffer.from(String(secret).replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${raw}`).digest("base64");
  return String(sig).split(/\s+/).some((part) => { const v = part.split(",")[1]; return v && safeEqual(v, expected); });
}

const addr = (v) => {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) return { email: null, name: null };
  if (typeof s === "object") return { email: text(s.email || s.address, 160) || null, name: text(s.name, 120) || null };
  const m = String(s).match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { email: text(m[2], 160), name: text(m[1], 120) || null } : { email: text(s, 160) || null, name: null };
};

export function normaliseInbound(p) {
  const from = addr(p.from);
  let body = typeof p.text === "string" ? p.text : (typeof p.html === "string" ? p.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") : "");
  return {
    source: "email",
    external_id: text(p.id || p.email_id, 160) || null,
    from_email: from.email, from_name: from.name,
    subject: text(p.subject, 300) || "(no subject)",
    body_text: body.trim().slice(0, BODY_MAX) || null,
    received_at: p.created_at && !Number.isNaN(Date.parse(p.created_at)) ? new Date(p.created_at).toISOString() : new Date().toISOString()
  };
}

// What a contact event means for the subscriber row: { unsubscribe: true } /
// { resubscribe: true } / null (nothing to do).
export function contactChange(body) {
  const d = body?.data || {};
  const email = text(d.email, 160).toLowerCase();
  if (!email) return null;
  if (body.type === "contact.deleted") return { email, unsubscribe: true };
  if (body.type === "contact.updated" || body.type === "contact.created") {
    if (d.unsubscribed === true) return { email, unsubscribe: true };
    if (d.unsubscribed === false) return { email, resubscribe: true };
  }
  return null;
}

async function applyContactChange(sb, change) {
  const now = new Date().toISOString();
  const { data: row, error } = await sb.from("subscribers").select("id, confirmed_at, unsubscribed_at").eq("email", change.email).maybeSingle();
  if (error) throw error;
  if (!row) return "unknown";
  if (change.unsubscribe && !row.unsubscribed_at) {
    const { error: ue } = await sb.from("subscribers").update({ unsubscribed_at: now, synced_at: now, sync_error: null, updated_at: now }).eq("id", row.id);
    if (ue) throw ue;
    return "unsubscribed";
  }
  if (change.resubscribe && row.unsubscribed_at && row.confirmed_at) {
    const { error: ue } = await sb.from("subscribers").update({ unsubscribed_at: null, synced_at: now, sync_error: null, updated_at: now }).eq("id", row.id);
    if (ue) throw ue;
    return "resubscribed";
  }
  return "unchanged";
}

export function makeHandler({ env = process.env, fetchImpl = fetch, sb: sbIn } = {}) {
  return async function handler(req, res) {
    if (req.method !== "POST") return methodNotAllowed(res, "POST");
    const raw = await rawBody(req);
    let body = req.body && typeof req.body === "object" ? req.body : null;
    if (!body && typeof req.body === "string") { try { body = JSON.parse(req.body); } catch { body = null; } }
    if (!body) return send(res, 400, { ok: false, error: "bad_json" });
    const headers = Object.fromEntries(Object.entries(req.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    let message;
    if (typeof body.type === "string" && body.type.startsWith("contact.")) {
      if (!svixOk(env.RESEND_WEBHOOK_SECRET, headers, raw.toString("utf8"))) return send(res, 401, { ok: false, error: "bad_signature" });
      const change = contactChange(body);
      if (!change) return send(res, 200, { ok: true, subscriber: "ignored" });
      try {
        const outcome = await applyContactChange(sbIn || supabase(), change);
        return send(res, 200, { ok: true, subscriber: outcome });
      } catch (e) { console.error("contact event failed", e); return send(res, 500, { ok: false, error: "server_error" }); }
    }
    if (body.type === "email.received" && body.data) {
      if (!svixOk(env.RESEND_WEBHOOK_SECRET, headers, raw.toString("utf8"))) return send(res, 401, { ok: false, error: "bad_signature" });
      const id = text(body.data.email_id || body.data.id, 160);
      let full = { ...body.data, id };
      if (env.RESEND_API_KEY && id) {
        try {
          const r = await fetchImpl(`${RESEND_API}/emails/receiving/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
          if (r.ok) full = { ...full, ...(await r.json()) };
        } catch (e) { console.error("resend receiving fetch failed", e); }
      }
      message = normaliseInbound(full);
    } else {
      const given = (req.query && req.query.token) || headers["x-webhook-token"];
      if (!env.EMAIL_HOOK_TOKEN || !safeEqual(env.EMAIL_HOOK_TOKEN, given)) return send(res, 401, { ok: false, error: "unauthorised" });
      message = normaliseInbound(body);
      if (!message.external_id) message.external_id = `fwd:${createHmac("sha256", env.EMAIL_HOOK_TOKEN).update(`${message.from_email}|${message.subject}|${message.received_at}`).digest("hex").slice(0, 32)}`;
    }
    if (!message.from_email && !message.body_text) return send(res, 400, { ok: false, error: "empty" });
    const sb = sbIn || supabase();
    const { data, error } = await sb.from("inbox").upsert(message, { onConflict: "external_id", ignoreDuplicates: true }).select("id");
    if (error) { console.error("inbox insert failed", error); return send(res, 500, { ok: false, error: "server_error" }); }
    return send(res, 200, { ok: true, stored: Array.isArray(data) ? data.length : 0 });
  };
}

export default makeHandler();
