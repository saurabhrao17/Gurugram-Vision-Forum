// Reporter replies: linking an inbound mail to the report it answers and
// storing its files on that report (owner's ask, 8 Oct 2026).
//  * refIn(text): the first report reference in a subject or body.
//  * ingestReply(): given the normalised inbound message and the full Resend
//    record, finds the report, stores image/PDF attachments in the private
//    report-photos bucket under <ref>/reply-…, records them on the report
//    (the missing required photo slot is filled first), adds a timeline
//    event "Reply from the reporter", and returns what to store on the inbox
//    row ({ report_id, report_ref, attachments }). Never throws: a mail that
//    cannot be linked still lands in the inbox.
// Resend's receiving API describes attachments with a filename, a content
// type and either inline base64 content, a download URL or an id to fetch;
// all three are handled and anything else is listed by name only.
import { checklist, safeName, ALLOWED_TYPES, MAX_FILE_BYTES, MAX_FILES } from "./filing.js";

export const REF_RE = /\bGVF-\d{4}-[A-Z2-9]{5}\b/i;
const RESEND_API = "https://api.resend.com";
const BUCKET = "report-photos";

export function refIn(s) {
  const m = REF_RE.exec(String(s || ""));
  return m ? m[0].toUpperCase() : null;
}

async function bytesOf(a, env, emailId, fetchImpl) {
  if (typeof a.content === "string" && a.content) return Buffer.from(a.content, "base64");
  const url = a.download_url || a.downloadUrl || a.url;
  if (typeof url === "string" && /^https:\/\//.test(url)) {
    const r = await fetchImpl(url);
    if (!r.ok) throw new Error(`attachment ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }
  if (a.id && emailId && env.RESEND_API_KEY) {
    const r = await fetchImpl(`${RESEND_API}/emails/receiving/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(a.id)}`, { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
    if (!r.ok) throw new Error(`attachment ${r.status}`);
    const j = await r.json().catch(() => null);
    if (j && typeof j.content === "string") return Buffer.from(j.content, "base64");
    const u = j && (j.download_url || j.downloadUrl || j.url);
    if (typeof u === "string") { const r2 = await fetchImpl(u); if (!r2.ok) throw new Error(`attachment ${r2.status}`); return Buffer.from(await r2.arrayBuffer()); }
  }
  throw new Error("no attachment content");
}

export async function ingestReply(sb, env, message, full = {}, fetchImpl = fetch) {
  const out = { report_id: null, report_ref: null, attachments: [] };
  try {
    const ref = refIn(message.subject) || refIn(message.body_text);
    if (!ref) return out;
    const { data: report, error } = await sb.from("triage_reports").select("id, ref, stage, filing, extra, attachments").eq("ref", ref).maybeSingle();
    if (error || !report) return out;
    out.report_id = report.id; out.report_ref = report.ref;

    const raw = Array.isArray(full.attachments) ? full.attachments.slice(0, MAX_FILES) : [];
    const have = Array.isArray(report.attachments) ? report.attachments : [];
    const chk = checklist(report.filing, report.extra, have);
    const openSlots = chk.docs.filter((d) => d.missing).map((d) => d.key);
    const stored = [];
    const stamp = Date.now().toString(36);
    for (let i = 0; i < raw.length; i++) {
      const a = raw[i] || {};
      const name = safeName(a.filename || a.name || `file-${i + 1}`);
      const type = String(a.content_type || a.contentType || a.type || "").toLowerCase().split(";")[0].trim();
      const entry = { name, type: type || null, stored: false };
      out.attachments.push(entry);
      if (!ALLOWED_TYPES.includes(type)) continue;
      try {
        const bytes = await bytesOf(a, env, full.id || message.external_id, fetchImpl);
        if (!bytes.length || bytes.length > MAX_FILE_BYTES) continue;
        const path = `${ref}/reply-${stamp}-${i + 1}-${name}`;
        const { error: ue } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: type, upsert: false });
        if (ue) { console.error("reply attachment upload failed", ue); continue; }
        const kind = type.startsWith("image/") && openSlots.length ? openSlots.shift() : "reply";
        stored.push({ path, name, size: bytes.length, type, kind, uploaded_at: new Date().toISOString(), via: "email" });
        entry.stored = true; entry.path = path; entry.kind = kind;
      } catch (e) { console.error("reply attachment failed", name, e?.message || e); }
    }
    if (stored.length) {
      const { error: ae } = await sb.rpc("report_attach", { p_ref: ref, p_files: stored });
      if (ae) console.error("report_attach failed", ae);
    }
    const note = `Reply from the reporter by email${message.subject ? ` ("${String(message.subject).slice(0, 80)}")` : ""}: ${String(message.body_text || "").replace(/\s+/g, " ").trim().slice(0, 240) || "(no text)"}${stored.length ? ` · ${stored.length} file(s) attached` : ""}`;
    const { error: ee } = await sb.from("report_events").insert({ report_id: report.id, stage: report.stage, note, actor: "reporter" });
    if (ee) console.error("reply event failed", ee);
  } catch (e) { console.error("ingestReply failed", e); }
  return out;
}
