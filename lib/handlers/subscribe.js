// The weekly email list (double opt-in, DPDP-minded: email and language
// only, one purpose, stop any time).
// POST /api/subscribe { email, lang }        -> { ok: true, status: "check_email" } always (never says whether the address is known)
// GET  /api/subscribe?confirm=<token>        -> small HTML page; 404 HTML for an unknown token
// GET  /api/subscribe?unsubscribe=<token>    -> small HTML page; 404 HTML for an unknown token
// Confirmation mail goes through the outbox (kind "subscribe_confirm"), sent
// by the daily cron; the digest itself is queued by the cron's digest step.
// Confirmed addresses are mirrored to Resend contacts (lib/audience.js) so
// the team can use Broadcasts; an unsubscribe on either side stops both.
import { randomBytes } from "node:crypto";
import { supabase } from "../supabase.js";
import { send, methodNotAllowed, readJson, text, isEmail } from "../http.js";
import { siteUrl } from "../indexnow.js";
import { syncSubscriber } from "../audience.js";

export const TOKEN = /^[0-9a-f]{32}$/;
export const LANGS = ["en", "hi"];
const EMAIL_MAX = 160;

export const newToken = () => randomBytes(16).toString("hex");

export function validateSubscribe(b) {
  const errors = [];
  const out = {};
  out.email = text(b?.email, EMAIL_MAX + 1).toLowerCase();
  if (!out.email || out.email.length > EMAIL_MAX || !isEmail(out.email) || /\s/.test(out.email)) errors.push("email");
  const lang = text(b?.lang, 5).toLowerCase() || "en";
  if (LANGS.includes(lang)) out.lang = lang; else errors.push("lang");
  out.source = text(b?.source, 40) || "site";
  return { errors, out };
}

export const tokenOf = (v) => { const t = text(v, 40).toLowerCase(); return TOKEN.test(t) ? t : null; };

// The confirmation mail: what we send, how often, how to stop, what we keep.
export function confirmMail(to, lang, token, env = process.env) {
  const site = siteUrl(env);
  const confirm = `${site}/api/subscribe?confirm=${token}`;
  const unsub = `${site}/api/subscribe?unsubscribe=${token}`;
  if (lang === "hi") {
    return {
      to_email: to,
      subject: "गुरुग्राम नागरिक सप्ताह: अपना ईमेल पक्का करें",
      body_text: [
        "आपने गुरुग्राम विज़न फ़ोरम का साप्ताहिक सार माँगा है: हफ़्ते में एक ईमेल, जिसमें निवासियों की चर्चा, आधिकारिक सूचनाएँ और फ़ोरम के सुझाए अगले कदम होते हैं।",
        "",
        "पक्का करने के लिए यह लिंक खोलें:",
        confirm,
        "",
        "अगर आपने यह नहीं माँगा था, तो इस ईमेल को अनदेखा करें; कुछ नहीं भेजा जाएगा।",
        "हम सिर्फ़ आपका ईमेल पता और भाषा रखते हैं, सिर्फ़ इसी काम के लिए (डिजिटल व्यक्तिगत डेटा संरक्षण अधिनियम, 2023)। हर ईमेल में एक लिंक से आप कभी भी बंद कर सकते हैं:",
        unsub,
        "",
        "गुरुग्राम विज़न फ़ोरम"
      ].join("\n"),
      body_html: `<p>आपने गुरुग्राम विज़न फ़ोरम का साप्ताहिक सार माँगा है: हफ़्ते में एक ईमेल, जिसमें निवासियों की चर्चा, आधिकारिक सूचनाएँ और फ़ोरम के सुझाए अगले कदम होते हैं।</p><p><a href="${confirm}">ईमेल पक्का करें</a></p><p>अगर आपने यह नहीं माँगा था, तो इस ईमेल को अनदेखा करें; कुछ नहीं भेजा जाएगा। हम सिर्फ़ आपका ईमेल पता और भाषा रखते हैं, सिर्फ़ इसी काम के लिए (डिजिटल व्यक्तिगत डेटा संरक्षण अधिनियम, 2023)। <a href="${unsub}">कभी भी बंद करें</a>।</p><p>गुरुग्राम विज़न फ़ोरम</p>`,
      kind: "subscribe_confirm"
    };
  }
  return {
    to_email: to,
    subject: "Gurugram civic week: confirm your email",
    body_text: [
      "You asked for the Gurugram Vision Forum's weekly round-up: one email a week with what residents talked about, the official notices and the Forum's suggested next steps.",
      "",
      "Open this link to confirm:",
      confirm,
      "",
      "If you did not ask for this, ignore this email and nothing will be sent.",
      "We keep your email address and language only, for this purpose only (Digital Personal Data Protection Act, 2023). Every email carries a link to stop at any time:",
      unsub,
      "",
      "Gurugram Vision Forum"
    ].join("\n"),
    body_html: `<p>You asked for the Gurugram Vision Forum's weekly round-up: one email a week with what residents talked about, the official notices and the Forum's suggested next steps.</p><p><a href="${confirm}">Confirm your email</a></p><p>If you did not ask for this, ignore this email and nothing will be sent. We keep your email address and language only, for this purpose only (Digital Personal Data Protection Act, 2023). <a href="${unsub}">Stop at any time</a>.</p><p>Gurugram Vision Forum</p>`,
    kind: "subscribe_confirm"
  };
}

const page = (title, en, hi, site) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#fff;color:#0B1F3A;margin:0;padding:48px 16px;line-height:1.5}main{max-width:36rem;margin:0 auto}a{color:#0B1F3A}</style>
</head><body><main>
<p>${en}</p>
<p lang="hi">${hi}</p>
<p><a href="${site}/">Gurugram Vision Forum</a></p>
</main></body></html>
`;

export const pages = {
  confirmed: (site) => page("Subscribed", "Subscribed. You'll get one email a week.", "सदस्यता पक्की हुई। आपको हफ़्ते में एक ईमेल मिलेगा।", site),
  unsubscribed: (site) => page("Unsubscribed", "Unsubscribed. You will get no more weekly emails.", "सदस्यता बंद। अब आपको साप्ताहिक ईमेल नहीं मिलेंगे।", site),
  unknown: (site) => page("Link not found", "This link is not valid any more. You can subscribe again from the site.", "यह लिंक अब मान्य नहीं है। आप साइट से फिर सदस्यता ले सकते हैं।", site)
};

function html(res, status, body) {
  res.status(status).setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

export async function handle(req, res, sb, env = process.env, fetchImpl = fetch) {
  const site = siteUrl(env);
  if (req.method === "GET") {
    const confirm = tokenOf(req.query?.confirm);
    const unsubscribe = tokenOf(req.query?.unsubscribe);
    if (!confirm && !unsubscribe) return send(res, 400, { ok: false, error: "invalid" });
    const token = confirm || unsubscribe;
    const { data: row, error } = await sb.from("subscribers").select("id, email, lang, confirmed_at, unsubscribed_at").eq("token", token).maybeSingle();
    if (error) throw error;
    if (!row) return html(res, 404, pages.unknown(site));
    const now = new Date().toISOString();
    if (confirm) {
      const patch = { unsubscribed_at: null, synced_at: null, updated_at: now };
      if (!row.confirmed_at) patch.confirmed_at = now;
      const { error: ue } = await sb.from("subscribers").update(patch).eq("id", row.id);
      if (ue) throw ue;
      // Mirror to the newsletter tool; the page never waits on a failure (the nightly step retries).
      await syncSubscriber(sb, env, { ...row, ...patch }, fetchImpl);
      return html(res, 200, pages.confirmed(site));
    }
    if (row.unsubscribed_at) return html(res, 200, pages.unsubscribed(site));
    const { error: ue } = await sb.from("subscribers").update({ unsubscribed_at: now, synced_at: null, updated_at: now }).eq("id", row.id);
    if (ue) throw ue;
    await syncSubscriber(sb, env, { ...row, unsubscribed_at: now }, fetchImpl);
    return html(res, 200, pages.unsubscribed(site));
  }
  if (req.method !== "POST") return methodNotAllowed(res, "GET, POST");

  const body = readJson(req);
  if (!body) return send(res, 400, { ok: false, error: "bad_json" });
  const { errors, out } = validateSubscribe(body);
  if (errors.length) return send(res, 400, { ok: false, error: "invalid", fields: errors });

  const { data: existing, error } = await sb.from("subscribers").select("id, token, lang, confirmed_at, unsubscribed_at").eq("email", out.email).maybeSingle();
  if (error) throw error;
  // Already confirmed and still subscribed: nothing to send, same answer.
  if (existing && existing.confirmed_at && !existing.unsubscribed_at) return send(res, 200, { ok: true, status: "check_email" });

  const token = newToken();
  const row = { email: out.email, lang: out.lang, token, source: out.source, confirmed_at: null, unsubscribed_at: null, synced_at: null, sync_error: null };
  const { error: ue } = await sb.from("subscribers").upsert(row, { onConflict: "email" });
  if (ue) throw ue;
  const { error: oe } = await sb.from("outbox").insert(confirmMail(out.email, out.lang, token, env));
  if (oe) throw oe;
  return send(res, 200, { ok: true, status: "check_email" });
}

// `sb` and `env` are injectable for tests; the router calls handler(req, res).
export function makeHandler({ sb, env, fetchImpl } = {}) {
  return async function handler(req, res) {
    try {
      return await handle(req, res, sb || supabase(), env || process.env, fetchImpl || fetch);
    } catch (e) {
      console.error("subscribe failed", e);
      return send(res, 500, { ok: false, error: "server_error" });
    }
  };
}

export default makeHandler();
