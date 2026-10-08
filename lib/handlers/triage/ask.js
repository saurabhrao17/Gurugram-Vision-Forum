// POST /api/triage/reports/:ref/ask -> { ok, sent, to, asked_at, missing }
// Emails the reporter from the Forum's own address for the items the
// portal still needs, with the reference in the subject and Reply-To set to
// the desk address, so the reply lands on the ticket by itself. Logged on
// the timeline. Owner, coordinators and ward volunteers within their wards.
// 409 nothing_missing when the checklist is complete; 409 no_email (with the
// text to send by hand) when the reporter gave no email address.
import { supabase } from "../../supabase.js";
import { requireStaff, handleError, actorOf, scopeFor, REPORT_ROLES, HttpError } from "../../auth.js";
import { send, methodNotAllowed, text } from "../../http.js";
import { checklist } from "../../filing.js";
import { siteUrl } from "../../indexnow.js";
import { queueMail } from "../../outbox.js";

const REF = /^GVF-\d{4}-[A-Z2-9]{5}$/;

export function deskAddress(env = process.env) {
  if (env.DESK_EMAIL) return env.DESK_EMAIL;
  const host = siteUrl(env).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return `desk@${host}`;
}

// The ask, bilingual, plain text with an HTML twin. Never carries the phone.
export function askMail(report, fc, env = process.env) {
  const site = siteUrl(env);
  const issue = report.issue_label || report.issue_type;
  const items = fc.missing;
  const subject = `[${report.ref}] A few details needed for your report`;
  const en = [
    `Namaste ${report.reporter_name || ""}`.trim() + ",",
    "",
    `Thank you for reporting "${issue}" at ${report.area} to the Gurugram Vision Forum (reference ${report.ref}).`,
    `To file it with ${fc.portal || "the official portal"} we still need:`,
    ...items.map((x) => `  - ${x}`),
    "",
    `Just reply to this email with the details, and attach the photo if one is listed. Please keep ${report.ref} in the subject so it reaches your report directly.`,
    `Track your report any time at ${site}/track`,
    "",
    "Gurugram Vision Forum"
  ].join("\n");
  const hi = [
    `नमस्ते ${report.reporter_name || ""}`.trim() + ",",
    "",
    `${report.area} में "${issue}" की शिकायत गुरुग्राम विज़न फ़ोरम को भेजने के लिए धन्यवाद (संदर्भ ${report.ref})।`,
    `इसे ${fc.portal || "आधिकारिक पोर्टल"} पर दर्ज करने के लिए हमें अभी भी चाहिए:`,
    ...items.map((x) => `  - ${x}`),
    "",
    `इसी ईमेल के जवाब में विवरण भेज दें, और अगर फ़ोटो माँगी गई है तो साथ लगा दें। विषय में ${report.ref} रहने दें ताकि यह सीधे आपकी शिकायत से जुड़ जाए।`,
    `अपनी शिकायत की स्थिति कभी भी देखें: ${site}/track`,
    "",
    "गुरुग्राम विज़न फ़ोरम"
  ].join("\n");
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const list = items.map((x) => `<li>${esc(x)}</li>`).join("");
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,'Noto Sans',sans-serif;color:#0b1f3a;line-height:1.5;font-size:16px"><div style="max-width:600px;margin:0 auto;padding:24px 16px">` +
    `<p>Namaste ${esc(report.reporter_name || "")},</p><p>Thank you for reporting <b>${esc(issue)}</b> at ${esc(report.area)} to the Gurugram Vision Forum (reference <b>${esc(report.ref)}</b>).</p>` +
    `<p>To file it with ${esc(fc.portal || "the official portal")} we still need:</p><ul>${list}</ul>` +
    `<p>Just reply to this email with the details, and attach the photo if one is listed. Please keep <b>${esc(report.ref)}</b> in the subject so it reaches your report directly.</p>` +
    `<p>Track your report any time at <a href="${site}/track">${esc(site.replace(/^https?:\/\//, ""))}/track</a>.</p>` +
    `<hr style="border:0;border-top:1px solid #ddd;margin:24px 0"><div lang="hi"><p>नमस्ते ${esc(report.reporter_name || "")},</p><p>${esc(report.area)} में <b>${esc(issue)}</b> की शिकायत गुरुग्राम विज़न फ़ोरम को भेजने के लिए धन्यवाद (संदर्भ <b>${esc(report.ref)}</b>)।</p>` +
    `<p>इसे ${esc(fc.portal || "आधिकारिक पोर्टल")} पर दर्ज करने के लिए हमें अभी भी चाहिए:</p><ul>${list}</ul>` +
    `<p>इसी ईमेल के जवाब में विवरण भेज दें, और अगर फ़ोटो माँगी गई है तो साथ लगा दें। विषय में <b>${esc(report.ref)}</b> रहने दें ताकि यह सीधे आपकी शिकायत से जुड़ जाए।</p></div>` +
    `<p style="margin-top:24px">Gurugram Vision Forum · गुरुग्राम विज़न फ़ोरम</p></div></body></html>`;
  return { to_email: report.reporter_email, subject, body_text: `${en}\n\n—\n\n${hi}`, body_html: html, kind: "ask", report_id: report.id, reply_to: deskAddress(env) };
}

// The same words for WhatsApp or SMS when the reporter gave no email.
export function askText(report, fc) {
  return `Gurugram Vision Forum, report ${report.ref} (${report.issue_label || report.issue_type}, ${report.area}).\nTo file it with ${fc.portal || "the official portal"} we still need: ${fc.missing.join(", ")}.\nReply to this message quoting ${report.ref}. Thank you.`;
}

export function makeHandler({ auth, sb: sbIn, env: envIn, mailImpl } = {}) {
  const requireAuth = auth || requireStaff;
  return async function handler(req, res) {
    if (req.method !== "POST") return methodNotAllowed(res, "POST");
    try {
      const s = await requireAuth(req, REPORT_ROLES);
      const env = envIn || process.env;
      const sb = sbIn || supabase();
      const ref = text(req.query?.ref, 20).toUpperCase();
      if (!REF.test(ref)) return send(res, 400, { ok: false, error: "invalid" });
      const { data: report, error } = await sb.from("triage_reports").select("id, ref, issue_type, issue_label, area, ward, stage, reporter_name, reporter_email, filing, extra, attachments").eq("ref", ref).maybeSingle();
      if (error) throw error;
      if (!report) throw new HttpError(404, "not_found");
      const scope = await scopeFor(s);
      if (scope && !scope.includes(report.ward)) return send(res, 403, { ok: false, error: "outside_your_wards" });
      const fc = checklist(report.filing, report.extra, report.attachments);
      if (fc.complete) return send(res, 409, { ok: false, error: "nothing_missing" });
      if (!report.reporter_email) return send(res, 409, { ok: false, error: "no_email", text: askText(report, fc), missing: fc.missing });
      if (!env.RESEND_API_KEY) return send(res, 503, { ok: false, error: "mail_unavailable", text: askText(report, fc), missing: fc.missing });
      const q = await queueMail(sb, env, askMail(report, fc, env), mailImpl ? { send: mailImpl } : {});
      const now = new Date().toISOString();
      const actor = actorOf(s);
      const note = `Asked the reporter by email for: ${fc.missing.join(", ")}${q.sent ? "" : " (queued; the mail provider did not answer, the next run retries)"}`;
      const { error: ee } = await sb.from("report_events").insert({ report_id: report.id, stage: report.stage, note, actor });
      if (ee) console.error("ask event failed", ee);
      const { error: ue } = await sb.from("reports").update({ asked_at: now }).eq("id", report.id);
      if (ue) console.error("asked_at update failed", ue);
      return send(res, 200, { ok: true, sent: q.sent, to: report.reporter_email, asked_at: now, missing: fc.missing });
    } catch (e) { return handleError(res, e); }
  };
}

export default makeHandler();
