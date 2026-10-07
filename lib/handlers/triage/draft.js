// POST /api/triage/draft { brief, kind, lang }
// -> { ok:true, draft:{ title, summary, body, title_hi, summary_hi } }
// A first draft for the team to edit before publishing. Providers, in the
// order they are tried when more than one key is set (DRAFT_PROVIDER forces
// one; DRAFT_MODEL overrides the model):
//   gemini    GEMINI_API_KEY     Google AI Studio free tier, no card needed
//   groq      GROQ_API_KEY       Groq free tier (Llama models), no card needed
//   anthropic ANTHROPIC_API_KEY  Claude (paid)
// Without any key the route answers 503 draft_unavailable so the desk can
// explain what to set. Managers only.
import { requireStaff, handleError } from "../../auth.js";
import { send, methodNotAllowed, readJson, text } from "../../http.js";
import { KINDS, sanitizeHtml, LIMITS } from "../../content.js";

export const MODEL = "claude-sonnet-5-5";
export const API_URL = "https://api.anthropic.com/v1/messages";
export const API_VERSION = "2023-06-01";
export const PROVIDERS = {
  gemini: { key: "GEMINI_API_KEY", model: "gemini-2.0-flash", url: (m, k) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(k)}` },
  groq: { key: "GROQ_API_KEY", model: "llama-3.3-70b-versatile", url: () => "https://api.groq.com/openai/v1/chat/completions" },
  anthropic: { key: "ANTHROPIC_API_KEY", model: MODEL, url: () => API_URL }
};
export const PROVIDER_ORDER = ["gemini", "groq", "anthropic"];

// Which provider to use: DRAFT_PROVIDER when set and its key exists, else the
// first of the free-first order whose key is set. Null when none.
export function pickProvider(env) {
  const forced = (env.DRAFT_PROVIDER || "").toLowerCase();
  if (forced && PROVIDERS[forced] && env[PROVIDERS[forced].key]) return forced;
  return PROVIDER_ORDER.find((p) => env[PROVIDERS[p].key]) || null;
}

// The HTTP request for one provider, and how to read its reply.
export function providerCall(provider, env, prompt) {
  const p = PROVIDERS[provider];
  const key = env[p.key];
  const model = env.DRAFT_MODEL || p.model;
  if (provider === "gemini") {
    return {
      url: p.url(model, key),
      init: { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: prompt.system }] }, contents: [{ role: "user", parts: [{ text: prompt.user }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: MAX_TOKENS, responseMimeType: "application/json" } }) },
      model,
      read: (body) => {
        const c = body && Array.isArray(body.candidates) ? body.candidates[0] : null;
        const parts = c && c.content && Array.isArray(c.content.parts) ? c.content.parts : [];
        return { text: parts.map((x) => x && x.text).filter(Boolean).join("\n"), truncated: !!c && c.finishReason === "MAX_TOKENS", refused: !!c && /SAFETY|RECITATION|PROHIBITED/.test(c.finishReason || "") };
      }
    };
  }
  if (provider === "groq") {
    return {
      url: p.url(),
      init: { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + key },
        body: JSON.stringify({ model, temperature: 0.4, max_tokens: MAX_TOKENS, response_format: { type: "json_object" },
          messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }] }) },
      model,
      read: (body) => {
        const ch = body && Array.isArray(body.choices) ? body.choices[0] : null;
        return { text: ch && ch.message && typeof ch.message.content === "string" ? ch.message.content : "", truncated: !!ch && ch.finish_reason === "length", refused: false };
      }
    };
  }
  return {
    url: p.url(),
    init: { method: "POST", headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": API_VERSION },
      body: JSON.stringify({ model, max_tokens: MAX_TOKENS, system: prompt.system, messages: [{ role: "user", content: prompt.user }] }) },
    model,
    read: (body) => ({ text: textOf(body), truncated: !!body && body.stop_reason === "max_tokens", refused: !!body && body.stop_reason === "refusal" })
  };
}
export const MAX_TOKENS = 1500;
export const MAX_BRIEF = 4000;

export const SYSTEM_PROMPT = [
  "You write for the Gurugram Vision Forum, a non-partisan citizens' forum in Gurugram (Gurgaon), Haryana.",
  "Write in plain English, and in plain Hindi (Devanagari) for the fields ending in _hi. Short sentences, no jargon.",
  "Be factual. Use only what the brief gives you. Never invent statistics, names, dates, quotes or outcomes.",
  "No party framing, no praise or blame of any political party or politician; civic issues and public services only.",
  "Mark anything the team must check before publishing with [verify] right after it.",
  "The body is simple HTML using only these tags: p, br, b, strong, i, em, ul, ol, li, h2, h3, a, blockquote. No inline styles, no scripts.",
  "Output strict JSON only, with exactly these keys: title, summary, body, title_hi, summary_hi. No markdown fences, no commentary before or after."
].join(" ");

const KIND_HINTS = {
  story: "A story (blog post): 300 to 600 words with a clear headline, an opening that says why it matters, and a closing line on what residents can do.",
  news: "A short news item: 80 to 180 words; what happened, where, when, and the source if the brief names one.",
  photo: "A caption for a photo: a one-line title and a one or two sentence summary; the body may be a single short paragraph.",
  video: "A video description: a one-line title, a two sentence summary, and a short body with what the video shows.",
  social: "A social-media post description: a one-line title and a one or two sentence summary; keep the body to one short paragraph.",
  testimonial: "A testimonial: the title is the person's role or area (no invented names), the body is the quote in first person only if the brief gives the words; otherwise summarise in third person.",
  popup: "A pop-up announcement: a title of at most 8 words and a summary of at most 30 words; the body is one short sentence with the key detail."
};

// Pulls the JSON object out of the model's text, tolerating code fences and
// stray words around it. Returns null when nothing parses.
export function parseDraft(raw) {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  const tryParse = (t) => { try { const v = JSON.parse(t); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; } };
  let obj = tryParse(s);
  if (!obj) {
    const a = s.indexOf("{"), z = s.lastIndexOf("}");
    if (a >= 0 && z > a) obj = tryParse(s.slice(a, z + 1));
  }
  if (!obj) return null;
  const str = (k, max) => text(typeof obj[k] === "string" ? obj[k] : "", max);
  return {
    title: str("title", LIMITS.title),
    summary: str("summary", LIMITS.summary),
    body: sanitizeHtml(str("body", LIMITS.body)),
    title_hi: str("title_hi", LIMITS.title),
    summary_hi: str("summary_hi", LIMITS.summary)
  };
}

export function buildPrompt({ brief, kind, lang }) {
  const user = [
    `Kind of post: ${kind}. ${KIND_HINTS[kind] || ""}`,
    lang === "hi" ? "The team will publish the Hindi first; make title_hi and summary_hi the strongest, but fill every key." : "Fill every key; the Hindi fields are translations of the English title and summary in plain Hindi.",
    "Brief from the team:",
    brief
  ].join("\n\n");
  return { system: SYSTEM_PROMPT, user };
}

// Kept for callers and tests that expect the Claude request shape.
export function buildRequest(args) {
  const p = buildPrompt(args);
  return { model: MODEL, max_tokens: MAX_TOKENS, system: p.system, messages: [{ role: "user", content: p.user }] };
}

export function textOf(message) {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  return blocks.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
}

// fetchImpl, env and auth are injectable for tests.
export function makeHandler({ fetchImpl, env, auth } = {}) {
  return async function handler(req, res) {
    if (req.method !== "POST") return methodNotAllowed(res, "POST");
    const doFetch = fetchImpl || globalThis.fetch;
    const e = env || process.env;
    const requireAuth = auth || requireStaff;
    try {
      await requireAuth(req, ["owner", "coordinator"]);
      const provider = pickProvider(e);
      if (!provider) return send(res, 503, { ok: false, error: "draft_unavailable" });
      const b = readJson(req);
      if (!b) return send(res, 400, { ok: false, error: "bad_json" });
      const brief = text(b.brief, MAX_BRIEF);
      const kind = text(b.kind, 20).toLowerCase() || "news";
      const lang = text(b.lang, 5).toLowerCase() === "hi" ? "hi" : "en";
      const errors = [];
      if (brief.length < 10) errors.push("brief");
      if (!KINDS.includes(kind)) errors.push("kind");
      if (errors.length) return send(res, 400, { ok: false, error: "invalid", fields: errors });

      const call = providerCall(provider, e, buildPrompt({ brief, kind, lang }));
      const r = await doFetch(call.url, call.init);
      const body = await r.json().catch(() => null);
      if (!r.ok) {
        console.error("draft request failed", provider, r.status, body && body.error);
        return send(res, 502, { ok: false, error: "draft_failed", status: r.status, provider });
      }
      const out = call.read(body);
      if (out.refused) return send(res, 502, { ok: false, error: "draft_refused", provider });
      const draft = parseDraft(out.text);
      if (!draft || !draft.title) return send(res, 502, { ok: false, error: "draft_unparseable", provider });
      return send(res, 200, { ok: true, draft, provider, model: (body && body.model) || call.model, truncated: !!out.truncated });
    } catch (err) { return handleError(res, err); }
  };
}

export default makeHandler();
