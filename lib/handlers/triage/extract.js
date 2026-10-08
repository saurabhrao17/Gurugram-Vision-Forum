// POST /api/triage/reports/:ref/extract { inbox_id? , text? } -> { ok, fields, provider, model }
// Reads a reporter's reply and proposes values for the filing fields that
// are still missing, through the same free-first AI chain as drafting. The
// desk shows the proposal and the volunteer applies it (PATCH extra); nothing
// is written here. 503 extract_unavailable without a key.
import { supabase } from "../../supabase.js";
import { requireStaff, handleError, scopeFor, REPORT_ROLES, HttpError } from "../../auth.js";
import { send, methodNotAllowed, readJson, text } from "../../http.js";
import { checklist } from "../../filing.js";
import { aiComplete, pickProvider, extractJson } from "../../ai.js";

const REF = /^GVF-\d{4}-[A-Z2-9]{5}$/;
const TEXT_MAX = 6000;

export const SYSTEM_PROMPT = [
  "You read a resident's reply to the Gurugram Vision Forum, a non-partisan citizens' forum in Gurugram (Gurgaon), Haryana, and pick out the details the official grievance portal needs.",
  "You are given the list of fields still missing, each with a key and a label, and the reply text (it may be in English, Hindi or Hinglish, and may quote an earlier mail).",
  "Fill a field only when the reply states it plainly; never guess, never invent, never copy the earlier quoted mail. Keep the resident's words, trimmed. Dates as YYYY-MM-DD when the reply gives a date, otherwise as written.",
  "Output strict JSON only: one object whose keys are a subset of the given field keys and whose values are strings. Use {} when nothing is stated. No markdown fences, nothing before or after the JSON."
].join(" ");

export function buildPrompt(fields, reply) {
  const list = fields.map((f) => `- ${f.key}: ${f.label}`).join("\n");
  return { system: SYSTEM_PROMPT, user: `Missing fields:\n${list}\n\nReply:\n"""\n${reply}\n"""\n\nJSON:` };
}

// Keeps only proposed keys that are missing fields, as trimmed strings.
export function cleanProposal(obj, fields) {
  const keys = new Set(fields.map((f) => f.key));
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (!keys.has(k) || v == null) continue;
    const s = String(v).trim().slice(0, 1000);
    if (s) out[k] = s;
  }
  return out;
}

export function makeHandler({ auth, sb: sbIn, env: envIn, fetchImpl } = {}) {
  const requireAuth = auth || requireStaff;
  return async function handler(req, res) {
    if (req.method !== "POST") return methodNotAllowed(res, "POST");
    try {
      const s = await requireAuth(req, REPORT_ROLES);
      const env = envIn || process.env;
      const sb = sbIn || supabase();
      const ref = text(req.query?.ref, 20).toUpperCase();
      if (!REF.test(ref)) return send(res, 400, { ok: false, error: "invalid" });
      const b = readJson(req) || {};
      const { data: report, error } = await sb.from("triage_reports").select("id, ref, ward, filing, extra, attachments").eq("ref", ref).maybeSingle();
      if (error) throw error;
      if (!report) throw new HttpError(404, "not_found");
      const scope = await scopeFor(s);
      if (scope && !scope.includes(report.ward)) return send(res, 403, { ok: false, error: "outside_your_wards" });
      let reply = text(b.text, TEXT_MAX);
      const inboxId = text(b.inbox_id, 60);
      if (!reply && /^[0-9a-f-]{36}$/i.test(inboxId)) {
        const { data: m, error: me } = await sb.from("inbox").select("body_text, report_id").eq("id", inboxId).maybeSingle();
        if (me) throw me;
        if (!m || m.report_id !== report.id) throw new HttpError(404, "not_found");
        reply = text(m.body_text, TEXT_MAX);
      }
      if (!reply) return send(res, 400, { ok: false, error: "invalid", fields: ["text"] });
      const fc = checklist(report.filing, report.extra, report.attachments);
      const missing = fc.fields.filter((f) => f.missing || !f.value);
      if (!missing.length) return send(res, 200, { ok: true, fields: {}, note: "nothing_missing" });
      if (!pickProvider(env)) return send(res, 503, { ok: false, error: "extract_unavailable" });
      const r = await aiComplete(env, buildPrompt(missing, reply), fetchImpl || globalThis.fetch);
      if (!r.ok) return send(res, 502, { ok: false, error: "extract_failed", provider: r.provider || null, detail: r.error });
      const obj = extractJson(r.text);
      if (!obj) return send(res, 502, { ok: false, error: "extract_unparseable", provider: r.provider });
      return send(res, 200, { ok: true, fields: cleanProposal(obj, missing), provider: r.provider, model: r.model });
    } catch (e) { return handleError(res, e); }
  };
}

export default makeHandler();
