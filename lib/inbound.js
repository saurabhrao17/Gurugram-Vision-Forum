// Shared code for the inbound channels (WhatsApp, Exotel helpline): a small
// store adapter over Supabase so the handlers can be tested with a fake, and
// pure helpers for parsing messages and composing replies.
import { text } from "./http.js";

export const SITE = "https://gurugramvisionforum.org";
export const REF_RE = /GVF-\d{4}-[A-Z2-9]{5}/i;
// Matches the four-step stage names in site/app.js STAGES and GVF.HS.
export const STAGES = [
  ["Received", "प्राप्त"],
  ["Mapped", "मैप किया गया"],
  ["Filed officially", "आधिकारिक रूप से दर्ज"],
  ["Escalated", "आगे बढ़ाया गया"],
  ["Resolved", "हल हो गया"]
];

export const trackUrl = (ref) => `${SITE}/#/track/${ref}`;

// "sec 29", "Sector-45", "sec. 57 A" -> "Sector 29" / "Sector 45" / "Sector 57A".
export function sectorFrom(s) {
  const m = /\bsec(?:tor)?\.?\s*-?\s*(\d{1,3}\s*[a-z]?)\b/i.exec(String(s || ""));
  if (!m) return null;
  return "Sector " + m[1].replace(/\s+/g, "").toUpperCase();
}

export function refFrom(s) {
  const m = REF_RE.exec(String(s || ""));
  return m ? m[0].toUpperCase() : null;
}

export function isStatusQuery(s) {
  return REF_RE.test(String(s || "")) || /\b(status|track)\b|स्थिति/i.test(String(s || ""));
}

// Reply texts: never include the reporter's name or number.
export function registeredReply(ref) {
  return [
    `Gurugram Vision Forum: your report is registered as ${ref}. A volunteer maps it within three working days. Track: ${trackUrl(ref)}`,
    `गुरुग्राम विज़न फ़ोरम: आपकी रिपोर्ट ${ref} के रूप में दर्ज है। एक स्वयंसेवक तीन कार्य दिवसों में इसे सही विभाग तक पहुँचाएगा। स्थिति देखें: ${trackUrl(ref)}`
  ].join("\n");
}

export function statusReply(report) {
  const st = STAGES[report.stage] || STAGES[0];
  return [
    `Gurugram Vision Forum: ${report.ref} is at stage "${st[0]}". Track: ${trackUrl(report.ref)}`,
    `गुरुग्राम विज़न फ़ोरम: ${report.ref} की स्थिति "${st[1]}" है। देखें: ${trackUrl(report.ref)}`
  ].join("\n");
}

export function notFoundReply() {
  return [
    `Gurugram Vision Forum: no report from this number matches that reference. Check at ${SITE}/#/track with your reference and the last 4 digits of the mobile given on the report, or send us a message describing the issue to register a new one.`,
    `गुरुग्राम विज़न फ़ोरम: इस नंबर से उस संदर्भ की कोई रिपोर्ट नहीं मिली। ${SITE}/#/track पर अपना संदर्भ और मोबाइल के आख़िरी 4 अंक डालकर देखें, या नई रिपोर्ट दर्ज करने के लिए समस्या लिखकर भेजें।`
  ].join("\n");
}

export function badPhoneReply() {
  return [
    "Gurugram Vision Forum: this line serves Indian mobile numbers only. Please report at " + SITE + "/#/report.",
    "गुरुग्राम विज़न फ़ोरम: यह लाइन केवल भारतीय मोबाइल नंबरों के लिए है। कृपया " + SITE + "/#/report पर रिपोर्ट करें।"
  ].join("\n");
}

// Store adapter. Everything the hook handlers need from the database, so a
// test can pass a plain object with the same five methods.
export function makeStore(sb) {
  return {
    // Returns the earlier inbound row { id, report_id } or null.
    async seen(provider, externalId) {
      const { data, error } = await sb.from("inbound_messages").select("id, report_id").eq("provider", provider).eq("external_id", externalId).maybeSingle();
      if (error) throw error;
      return data || null;
    },
    // Creates a report; `row` carries every column. Returns { id, ref, stage, created_at }.
    async createReport(row) {
      let ward = null, wardSource = null;
      if (row.area) {
        try {
          const { data: d } = await sb.rpc("detect_ward", { p_lat: row.lat ?? null, p_lng: row.lng ?? null, p_area: row.area });
          if (d && d.ward) { ward = d.ward; wardSource = d.source; }
        } catch (e) { console.error("detect_ward failed", e); }
      }
      const { data, error } = await sb.from("reports").insert({ ...row, ward, ward_detected: ward, ward_source: wardSource }).select("id, ref, stage, created_at").single();
      if (error) throw error;
      return data;
    },
    async recordInbound(row) {
      const { error } = await sb.from("inbound_messages").insert(row);
      // 23505: a concurrent retry got there first; the report exists, nothing to do.
      if (error && error.code !== "23505") throw error;
    },
    // Report by reference, only when the phone matches the reporter's.
    async findByRef(ref, phone) {
      const { data, error } = await sb.from("reports").select("id, ref, stage, created_at").eq("ref", ref).eq("reporter_phone", phone).maybeSingle();
      if (error) throw error;
      return data || null;
    },
    async recentForPhone(phone) {
      const { data, error } = await sb.rpc("report_for_phone_recent", { p_phone: phone });
      if (error) throw error;
      return data || null;
    },
    async reportById(id) {
      const { data, error } = await sb.from("reports").select("id, ref, description").eq("id", id).maybeSingle();
      if (error) throw error;
      return data || null;
    },
    async appendDescription(id, extra) {
      const r = await this.reportById(id);
      if (!r || r.description.includes(extra)) return;
      const { error } = await sb.from("reports").update({ description: text(r.description + extra, 4000) }).eq("id", id);
      if (error) throw error;
    }
  };
}
