// Newsletter campaigns (owner's ask, 8 Oct 2026: run the newsletter from the
// desk, never from the mail provider's dashboard). The desk writes a campaign
// in English and Hindi as plain text (blank line = paragraph, "## " = heading,
// "- " = list item, URLs become links; no HTML is accepted, so nothing can be
// injected into a mail). Two ways out, both chosen here, never by hand:
//  * broadcast: one Resend Broadcast to the mirrored contacts (free up to
//    1,000 contacts, no daily cap; Resend fills {{{RESEND_UNSUBSCRIBE_URL}}}
//    and its contact webhook brings every stop back to the Forum's list).
//    Needs RESEND_SEGMENT_ID (new accounts) or RESEND_AUDIENCE_ID (older).
//  * outbox: one mail per confirmed subscriber with the Forum's own
//    unsubscribe link, sent through the outbox; up to FLUSH_NOW go out at
//    once and the rest with the next cron run (Resend's free plan sends 100
//    transactional mails a day, which the desk says plainly).
// Subscribers chose a language: on the outbox path each gets their own; a
// broadcast is one mail, so it carries English then Hindi.
import { siteUrl } from "./indexnow.js";
import { sendMail } from "./handlers/cron.js";

export const RESEND_API = "https://api.resend.com";
export const LIMITS = { subject: 200, body: 20000 };
export const FLUSH_NOW = 100;
export const FREE_DAILY_CAP = 100;
const TIMEOUT_MS = 10000;
const DEFAULT_FROM = "Gurugram Vision Forum <noreply@gurugramvisionforum.org>";

export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function validateCampaign(b) {
  const errors = [], out = {};
  const t = (v, max) => (typeof v === "string" ? v.trim().slice(0, max + 1) : "");
  out.subject = t(b?.subject, LIMITS.subject);
  if (out.subject.length < 3 || out.subject.length > LIMITS.subject) errors.push("subject");
  out.body = t(b?.body, LIMITS.body);
  if (out.body.length < 20 || out.body.length > LIMITS.body) errors.push("body");
  out.subject_hi = t(b?.subject_hi, LIMITS.subject) || null;
  if (out.subject_hi && out.subject_hi.length > LIMITS.subject) errors.push("subject_hi");
  out.body_hi = t(b?.body_hi, LIMITS.body) || null;
  if (out.body_hi && out.body_hi.length > LIMITS.body) errors.push("body_hi");
  if (/<[a-z!/]/i.test(out.body + (out.body_hi || ""))) errors.push("html_not_allowed");
  const pid = typeof b?.post_id === "string" ? b.post_id.trim() : "";
  out.post_id = /^[0-9a-f-]{36}$/i.test(pid) ? pid : null;
  return { errors, out };
}

// Plain text with a little structure → safe HTML. Everything is escaped first.
export function textToHtml(src) {
  const blocks = String(src || "").replace(/\r\n?/g, "\n").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const link = (s) => s.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (u) => `<a href="${u}">${u}</a>`);
  return blocks.map((b) => {
    const lines = b.split("\n");
    if (lines.every((l) => /^[-*] /.test(l))) return `<ul>${lines.map((l) => `<li>${link(esc(l.slice(2)))}</li>`).join("")}</ul>`;
    if (lines.length === 1 && /^## /.test(b)) return `<h2>${link(esc(b.slice(3)))}</h2>`;
    return `<p>${lines.map((l) => link(esc(l))).join("<br>")}</p>`;
  }).join("\n");
}

const FOOT = {
  en: (unsub, site) => ({ text: `\n\n—\nYou get this because you subscribed to the Gurugram Vision Forum's weekly digest at ${site}. Stop these emails: ${unsub}`, html: `<hr style="border:0;border-top:1px solid #ddd;margin:24px 0"><p style="font-size:12px;color:#555">You get this because you subscribed to the Gurugram Vision Forum's weekly digest at <a href="${site}">${site.replace(/^https?:\/\//, "")}</a>. <a href="${unsub}">Stop these emails</a>.</p>` }),
  hi: (unsub, site) => ({ text: `\n\n—\nयह ईमेल आपको इसलिए मिला क्योंकि आपने ${site} पर गुरुग्राम विज़न फ़ोरम का साप्ताहिक सार माँगा था। ये ईमेल बंद करें: ${unsub}`, html: `<hr style="border:0;border-top:1px solid #ddd;margin:24px 0"><p style="font-size:12px;color:#555">यह ईमेल आपको इसलिए मिला क्योंकि आपने <a href="${site}">${site.replace(/^https?:\/\//, "")}</a> पर गुरुग्राम विज़न फ़ोरम का साप्ताहिक सार माँगा था। <a href="${unsub}">ये ईमेल बंद करें</a>।</p>` })
};

const wrap = (inner) => `<!doctype html><html><body style="margin:0;background:#f4f6fa;font-family:-apple-system,Segoe UI,Roboto,'Noto Sans',sans-serif;color:#0b1f3a"><div style="max-width:600px;margin:0 auto;padding:24px 16px;background:#fff;line-height:1.55;font-size:16px"><p style="margin:0 0 16px;font-weight:700;color:#0b1f3a">Gurugram Vision Forum</p>${inner}</div></body></html>`;

// One subscriber's mail in their language (outbox path): subject, text, html.
export function renderMail(c, { lang = "en", unsub, site }) {
  const hi = lang === "hi" && c.subject_hi && c.body_hi;
  const subject = hi ? c.subject_hi : c.subject;
  const body = hi ? c.body_hi : c.body;
  const foot = FOOT[hi ? "hi" : "en"](unsub, site);
  return { subject, text: body + foot.text, html: wrap(`<h1 style="font-size:22px;margin:0 0 16px">${esc(subject)}</h1>${textToHtml(body)}${foot.html}`) };
}

// The broadcast is one mail for everyone: English, then Hindi when written.
export function renderBroadcast(c, { site }) {
  const unsub = "{{{RESEND_UNSUBSCRIBE_URL}}}";
  const en = FOOT.en(unsub, site);
  let html = `<h1 style="font-size:22px;margin:0 0 16px">${esc(c.subject)}</h1>${textToHtml(c.body)}`;
  let text = c.body;
  if (c.subject_hi && c.body_hi) {
    html += `<hr style="border:0;border-top:1px solid #ddd;margin:24px 0"><h2 style="font-size:20px;margin:0 0 16px" lang="hi">${esc(c.subject_hi)}</h2><div lang="hi">${textToHtml(c.body_hi)}</div>`;
    text += `\n\n—\n${c.subject_hi}\n\n${c.body_hi}`;
    text += FOOT.hi(unsub, site).text;
  }
  return { subject: c.subject_hi ? `${c.subject} / ${c.subject_hi}` : c.subject, text: text + en.text, html: wrap(html + en.html) };
}

export function broadcastTarget(env = process.env) {
  if (env.RESEND_SEGMENT_ID) return { segment_id: env.RESEND_SEGMENT_ID };
  if (env.RESEND_AUDIENCE_ID) return { audience_id: env.RESEND_AUDIENCE_ID };
  return null;
}

// Which way a send goes, and what the desk should say about it.
export function channelFor(env = process.env) {
  if (!env.RESEND_API_KEY) return { mode: "none" };
  if (broadcastTarget(env) && String(env.AUDIENCE_SYNC || "resend").toLowerCase() !== "off") return { mode: "broadcast" };
  return { mode: "outbox", flush_now: FLUSH_NOW, daily_cap: FREE_DAILY_CAP };
}

async function resend(env, fetchImpl, method, path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetchImpl(`${RESEND_API}${path}`, { method, signal: ctrl.signal, headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { json = null; }
    return { status: Number(r.status) || 0, json };
  } catch (e) { return { status: 0, json: null, error: e?.name === "AbortError" ? "timeout" : String(e?.message || e).slice(0, 200) }; }
  finally { clearTimeout(timer); }
}
const errorOf = (r) => r.error || (r.json && (r.json.message || r.json.name)) || `http_${r.status}`;

// Create and send one Broadcast. Newer accounts take `send: true` on create;
// if the API refuses that flag the draft is sent with the separate call.
export async function sendBroadcast(env, c, fetchImpl = fetch) {
  const target = broadcastTarget(env);
  if (!env.RESEND_API_KEY || !target) return { ok: false, error: "no_broadcast_target" };
  const m = renderBroadcast(c, { site: siteUrl(env) });
  const base = { ...target, from: env.MAIL_FROM || DEFAULT_FROM, subject: m.subject, html: m.html, text: m.text, name: `Desk campaign ${c.id}: ${c.subject}`.slice(0, 120) };
  let r = await resend(env, fetchImpl, "POST", "/broadcasts", { ...base, send: true });
  let id = r.json?.id || null;
  if (r.status === 422 && !id) {
    r = await resend(env, fetchImpl, "POST", "/broadcasts", base);
    id = r.json?.id || null;
    if (id) r = await resend(env, fetchImpl, "POST", `/broadcasts/${encodeURIComponent(id)}/send`, {});
  }
  if (r.status >= 200 && r.status < 300) return { ok: true, id };
  return { ok: false, id, error: errorOf(r), status: r.status };
}

// Outbox rows for every confirmed subscriber (their own language, their own stop link).
export function outboxRows(c, subs, env = process.env) {
  const site = siteUrl(env);
  return subs.map((s) => {
    const m = renderMail(c, { lang: s.lang, unsub: `${site}/api/subscribe?unsubscribe=${s.token}`, site });
    return { to_email: s.email, subject: m.subject, body_text: m.text, body_html: m.html, kind: "newsletter", campaign_id: c.id };
  });
}

// Send up to `limit` pending outbox rows of one campaign now; the cron takes the rest.
export async function flushCampaign(sb, env, campaignId, { limit = FLUSH_NOW, send = sendMail } = {}) {
  const out = { sent: 0, failed: 0, remaining: 0 };
  if (!env.RESEND_API_KEY) return out;
  const { data, error } = await sb.from("outbox").select("id, to_email, subject, body_text, body_html, reply_to, attempts").eq("campaign_id", campaignId).eq("status", "pending").order("id", { ascending: true }).limit(limit + 1);
  if (error) throw error;
  const rows = data || [];
  out.remaining = Math.max(0, rows.length - limit);
  for (const row of rows.slice(0, limit)) {
    let patch;
    try { await send(row, env); patch = { status: "sent", sent_at: new Date().toISOString(), attempts: (row.attempts || 0) + 1, last_error: null }; out.sent++; }
    catch (e) { patch = { attempts: (row.attempts || 0) + 1, last_error: String(e?.message || e).slice(0, 500), status: (row.attempts || 0) + 1 >= 5 ? "failed" : "pending" }; out.failed++; }
    const { error: ue } = await sb.from("outbox").update(patch).eq("id", row.id);
    if (ue) console.error("outbox update failed", row.id, ue);
  }
  return out;
}
