// /api/hooks/whatsapp: Meta WhatsApp Cloud API webhook.
// GET  -> verification handshake (hub.mode, hub.verify_token, hub.challenge).
// POST -> inbound messages. Each text, image or document message either asks
//         for a status (reference or the word status/स्थिति) or becomes a
//         report with source 'whatsapp'. Replies go back through the Graph API
//         when WHATSAPP_TOKEN and WHATSAPP_PHONE_ID are set.
// Env: WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET (signature), WHATSAPP_TOKEN, WHATSAPP_PHONE_ID.
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabase } from "../../supabase.js";
import { send, methodNotAllowed, text, normalisePhone } from "../../http.js";
import { makeStore, sectorFrom, refFrom, isStatusQuery, registeredReply, statusReply, notFoundReply, badPhoneReply } from "../../inbound.js";

const GRAPH = "https://graph.facebook.com/v20.0";

// Raw request body for the signature check. Vercel parses JSON bodies before
// the handler runs and does not keep the bytes, so: stream when nothing has
// consumed it, else req.rawBody if the platform exposes it, else re-serialise
// req.body. The last case is a best effort: key order survives JSON.parse in
// V8, but whitespace does not, so a pretty-printed payload would fail the
// check. Meta sends compact JSON, which round-trips byte for byte.
export async function rawBody(req) {
  if (req.body === undefined && typeof req.on === "function") {
    const chunks = [];
    for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    const buf = Buffer.concat(chunks);
    const s = buf.toString("utf8");
    try { req.body = s ? JSON.parse(s) : {}; } catch { req.body = null; }
    return buf;
  }
  if (req.rawBody !== undefined) return Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(String(req.rawBody), "utf8");
  if (typeof req.body === "string") return Buffer.from(req.body, "utf8");
  return Buffer.from(JSON.stringify(req.body ?? {}), "utf8");
}

export function signatureOk(secret, raw, header) {
  const given = String(header || "").replace(/^sha256=/, "");
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given, "utf8"), Buffer.from(expected, "utf8"));
}

export function makeSender(env, fetchFn) {
  return async function sendWhatsApp(to, body) {
    if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) return false;
    try {
      const r = await fetchFn(`${GRAPH}/${env.WHATSAPP_PHONE_ID}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { preview_url: false, body } })
      });
      if (!r.ok) console.error("whatsapp send failed", r.status);
      return r.ok;
    } catch (e) {
      console.error("whatsapp send failed", e);
      return false;
    }
  };
}

// Text of a message, or null for types we do not turn into reports.
export function messageText(m) {
  switch (m?.type) {
    case "text": return text(m.text?.body, 2000);
    case "image": return text(m.image?.caption, 2000) || "Photo sent on WhatsApp";
    case "video": return text(m.video?.caption, 2000) || "Video sent on WhatsApp";
    case "document": return text(m.document?.caption, 2000) || "Document sent on WhatsApp";
    default: return null;
  }
}

// Flattens entry[].changes[].value into [{ message, contacts }] pairs.
export function messagesIn(body) {
  const out = [];
  for (const entry of body?.entry || []) {
    for (const change of entry?.changes || []) {
      const v = change?.value;
      if (!v || !Array.isArray(v.messages)) continue;
      for (const message of v.messages) out.push({ message, contacts: v.contacts || [] });
    }
  }
  return out;
}

async function handleMessage({ message, contacts }, store, reply) {
  const id = text(message.id, 200);
  const body = messageText(message);
  if (!id || body === null) return false;
  if (await store.seen("whatsapp", id)) return false;

  const from = text(message.from, 32);
  const phone = normalisePhone("+" + from);
  // Keep the row small: no media ids, no contact object (the name goes on the report).
  const payload = { type: message.type, timestamp: message.timestamp };

  if (!phone) {
    await store.recordInbound({ provider: "whatsapp", external_id: id, from_number: null, payload, report_id: null });
    if (from) await reply(from, badPhoneReply());
    return true;
  }

  if (isStatusQuery(body)) {
    const ref = refFrom(body);
    const found = ref ? await store.findByRef(ref, phone) : await store.recentForPhone(phone);
    await store.recordInbound({ provider: "whatsapp", external_id: id, from_number: phone, payload: { ...payload, query: "status" }, report_id: found?.id || null });
    await reply(from, found ? statusReply(found) : notFoundReply());
    return true;
  }

  const name = text(contacts[0]?.profile?.name, 120) || "WhatsApp user";
  const report = await store.createReport({
    issue_type: "other",
    affects: "Me or my family",
    area: sectorFrom(body) || "WhatsApp",
    spot: null, lat: null, lng: null,
    description: body,
    reporter_name: name,
    reporter_phone: phone,
    reporter_email: null,
    consent_at: new Date().toISOString(),
    source: "whatsapp",
    ip_hash: null,
    user_agent: "whatsapp-cloud-api"
  });
  await store.recordInbound({ provider: "whatsapp", external_id: id, from_number: phone, payload, report_id: report.id });
  await reply(from, registeredReply(report.ref));
  return true;
}

export async function handle(req, res, deps = {}) {
  const env = deps.env || process.env;
  if (req.method === "GET") {
    const q = req.query || {};
    const mode = q["hub.mode"], token = q["hub.verify_token"], challenge = q["hub.challenge"];
    if (env.WHATSAPP_VERIFY_TOKEN && mode === "subscribe" && token === env.WHATSAPP_VERIFY_TOKEN && typeof challenge === "string") {
      res.status(200).setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.end(challenge);
    }
    return send(res, 403, { ok: false, error: "verification_failed" });
  }
  if (req.method !== "POST") return methodNotAllowed(res, "GET, POST");

  const raw = await rawBody(req);
  if (env.WHATSAPP_APP_SECRET && !signatureOk(env.WHATSAPP_APP_SECRET, raw, req.headers?.["x-hub-signature-256"])) {
    return send(res, 401, { ok: false, error: "bad_signature" });
  }
  const body = req.body && typeof req.body === "object" ? req.body : null;
  if (!body || body.object !== "whatsapp_business_account") return send(res, 200, { ok: true, handled: 0 });

  const store = deps.store || makeStore(supabase());
  const reply = deps.sendWhatsApp || makeSender(env, deps.fetch || fetch);
  let handled = 0;
  for (const item of messagesIn(body)) {
    try {
      if (await handleMessage(item, store, reply)) handled++;
    } catch (e) {
      // Log and carry on: a 200 stops Meta re-sending the whole batch; the
      // inbound_messages row is only written after the report, so a failed
      // message is retried on the next delivery of a different batch, not lost.
      console.error("whatsapp message failed", e);
    }
  }
  return send(res, 200, { ok: true, handled });
}

export default function handler(req, res) {
  return handle(req, res);
}
