// POST /api/triage/translate { fields:{ title?, summary?, body? }, from?: "en"|"hi"|"auto" }
// -> { ok:true, from, to, fields:{ ...translated }, provider, model }
// Translates post copy between English and Hindi for the content desk with
// the same free-first providers as /api/triage/draft (lib/ai.js). The source
// language is detected from the text when `from` is "auto" or missing:
// Devanagari characters mean Hindi, anything else English. Errors:
//   400 bad_json | invalid              no field has text, or one exceeds LIMITS
//   503 translate_unavailable           no provider key is set
//   502 translate_failed | translate_refused | translate_unparseable
// Owner, coordinators and the content team.
import { requireStaff, handleError, CONTENT_ROLES } from "../../auth.js";
import { send, methodNotAllowed, readJson, text } from "../../http.js";
import { sanitizeHtml, LIMITS } from "../../content.js";
import { aiComplete, pickProvider, extractJson } from "../../ai.js";

export const FIELDS = ["title", "summary", "body"];
export const LANGS = ["en", "hi"];
export const MAX_TOKENS = 4000;
const DEVANAGARI = /[ऀ-ॿ]/;

export const SYSTEM_PROMPT = [
  "You translate for the Gurugram Vision Forum, a non-partisan citizens' forum in Gurugram (Gurgaon), Haryana.",
  "Translate between English and Hindi. Hindi is plain, natural Hindi in Devanagari script as residents speak it, not formal Sanskritised Hindi; English is plain English. Short sentences, no jargon.",
  "Keep agency names and acronyms in Latin script exactly as written: GMDA, MCG, DHBVN, HRERA, HSVP, HSPCB, CM Window, RWA, FIR, RTI.",
  "Keep numbers, dates, times, amounts, reference numbers, URLs, email addresses and HTML tags and attributes exactly as they are. Translate only the human-readable text between the tags; never add, remove or reorder tags.",
  "Do not add, drop or soften information. No commentary, no notes, no party framing.",
  "Output strict JSON only: one object with exactly the same keys as the input object, each value the translation of the input value. No markdown fences, nothing before or after the JSON."
].join(" ");

// "hi" when the text carries any Devanagari character, otherwise "en".
export function detectLang(input) {
  const t = typeof input === "string" ? input : input && typeof input === "object" ? Object.values(input).filter((v) => typeof v === "string").join("\n") : "";
  return DEVANAGARI.test(t) ? "hi" : "en";
}

export function buildTranslatePrompt(fields, from, to) {
  const name = (l) => (l === "hi" ? "Hindi (Devanagari)" : "English");
  const user = [
    `Translate from ${name(from)} to ${name(to)}.`,
    "The input is a JSON object; reply with a JSON object with the same keys. The \"body\" value, when present, is HTML: keep every tag, translate only the text.",
    "Input:",
    JSON.stringify(fields)
  ].join("\n\n");
  return { system: SYSTEM_PROMPT, user, json: true, maxTokens: MAX_TOKENS };
}

// Picks the translatable fields from the request. Returns { fields, errors }:
// errors lists fields over their limit; fields is empty when nothing has text.
export function readFields(input) {
  const src = input && typeof input === "object" ? input : {};
  const fields = {};
  const errors = [];
  for (const k of FIELDS) {
    if (!(k in src) || src[k] == null) continue;
    if (typeof src[k] !== "string") { errors.push(k); continue; }
    const v = src[k].trim();
    if (!v) continue;
    if (v.length > LIMITS[k]) { errors.push(k); continue; }
    fields[k] = v;
  }
  return { fields, errors };
}

// Cleans the model's answer: same keys as asked, lengths capped, body sanitised.
export function cleanTranslation(obj, asked) {
  if (!obj || typeof obj !== "object") return null;
  const out = {};
  for (const k of Object.keys(asked)) {
    const v = text(typeof obj[k] === "string" ? obj[k] : "", LIMITS[k]);
    if (!v) continue;
    out[k] = k === "body" ? sanitizeHtml(v) : v;
  }
  return Object.keys(out).length ? out : null;
}

// fetchImpl, env and auth are injectable for tests.
export function makeHandler({ fetchImpl, env, auth } = {}) {
  return async function handler(req, res) {
    if (req.method !== "POST") return methodNotAllowed(res, "POST");
    const doFetch = fetchImpl || globalThis.fetch;
    const e = env || process.env;
    const requireAuth = auth || requireStaff;
    try {
      await requireAuth(req, CONTENT_ROLES);
      const b = readJson(req);
      if (!b) return send(res, 400, { ok: false, error: "bad_json" });
      const { fields, errors } = readFields(b.fields);
      if (errors.length) return send(res, 400, { ok: false, error: "invalid", fields: errors });
      if (!Object.keys(fields).length) return send(res, 400, { ok: false, error: "invalid", fields: FIELDS });
      const wanted = text(b.from, 5).toLowerCase();
      const from = LANGS.includes(wanted) ? wanted : detectLang(fields);
      const to = from === "hi" ? "en" : "hi";
      if (!pickProvider(e)) return send(res, 503, { ok: false, error: "translate_unavailable" });

      const r = await aiComplete(e, buildTranslatePrompt(fields, from, to), doFetch);
      if (!r.ok) {
        if (r.error === "unavailable") return send(res, 503, { ok: false, error: "translate_unavailable" });
        console.error("translate request failed", r.provider, r.error, r.status || "", r.detail || "");
        return send(res, 502, { ok: false, error: r.error === "refused" ? "translate_refused" : "translate_failed", provider: r.provider, ...(r.status ? { status: r.status } : {}) });
      }
      const out = cleanTranslation(extractJson(r.text), fields);
      if (!out) return send(res, 502, { ok: false, error: "translate_unparseable", provider: r.provider });
      return send(res, 200, { ok: true, from, to, fields: out, provider: r.provider, model: r.model, truncated: !!r.truncated });
    } catch (err) { return handleError(res, err); }
  };
}

export default makeHandler();
