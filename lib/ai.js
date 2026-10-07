// Shared client for the free-first text-generation providers used by the desk
// (drafts, translation, insights). Providers, in the order tried when more
// than one key is set (DRAFT_PROVIDER forces one; DRAFT_MODEL overrides):
//   gemini    GEMINI_API_KEY     Google AI Studio free tier, no card needed
//   groq      GROQ_API_KEY       Groq free tier (Llama models), no card needed
//   anthropic ANTHROPIC_API_KEY  Claude (paid)
import { textOf } from "./ai-text.js";

export const MAX_TOKENS = 1500;
export const CLAUDE_MODEL = "claude-sonnet-5-5";
export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
export const PROVIDERS = {
  gemini: { key: "GEMINI_API_KEY", model: "gemini-2.0-flash", url: (m, k) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(k)}` },
  groq: { key: "GROQ_API_KEY", model: "llama-3.3-70b-versatile", url: () => "https://api.groq.com/openai/v1/chat/completions" },
  anthropic: { key: "ANTHROPIC_API_KEY", model: CLAUDE_MODEL, url: () => ANTHROPIC_URL }
};
export const PROVIDER_ORDER = ["gemini", "groq", "anthropic"];

export function pickProvider(env) {
  const forced = (env.DRAFT_PROVIDER || "").toLowerCase();
  if (forced && PROVIDERS[forced] && env[PROVIDERS[forced].key]) return forced;
  return PROVIDER_ORDER.find((p) => env[PROVIDERS[p].key]) || null;
}

// The HTTP request for one provider and how to read its reply.
// prompt: { system, user, json?: boolean, maxTokens?: number }
export function providerCall(provider, env, prompt) {
  const p = PROVIDERS[provider];
  const key = env[p.key];
  const model = env.DRAFT_MODEL || p.model;
  const max = prompt.maxTokens || MAX_TOKENS;
  const json = prompt.json !== false;
  if (provider === "gemini") {
    return {
      url: p.url(model, key),
      init: { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: prompt.system }] }, contents: [{ role: "user", parts: [{ text: prompt.user }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: max, ...(json ? { responseMimeType: "application/json" } : {}) } }) },
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
        body: JSON.stringify({ model, temperature: 0.4, max_tokens: max, ...(json ? { response_format: { type: "json_object" } } : {}),
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
    init: { method: "POST", headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION },
      body: JSON.stringify({ model, max_tokens: max, system: prompt.system, messages: [{ role: "user", content: prompt.user }] }) },
    model,
    read: (body) => ({ text: textOf(body), truncated: !!body && body.stop_reason === "max_tokens", refused: !!body && body.stop_reason === "refusal" })
  };
}

// One completion with the chosen provider. Never throws on upstream errors:
// returns { ok, provider, model, text, truncated, refused, status, error }.
export async function aiComplete(env, prompt, fetchImpl = globalThis.fetch) {
  const provider = pickProvider(env);
  if (!provider) return { ok: false, error: "unavailable", provider: null };
  const call = providerCall(provider, env, prompt);
  let r, body;
  try {
    r = await fetchImpl(call.url, call.init);
    body = await r.json().catch(() => null);
  } catch (e) {
    return { ok: false, error: "network", provider, model: call.model, detail: String(e && e.message || e).slice(0, 160) };
  }
  if (!r.ok) return { ok: false, error: "failed", status: r.status, provider, model: call.model, detail: body && body.error ? JSON.stringify(body.error).slice(0, 200) : "" };
  const out = call.read(body);
  if (out.refused) return { ok: false, error: "refused", provider, model: call.model };
  return { ok: true, provider, model: (body && body.model) || call.model, text: out.text, truncated: !!out.truncated };
}

// Pulls a JSON object out of model text, tolerating code fences and stray words.
export function extractJson(raw) {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  const tryParse = (t) => { try { const v = JSON.parse(t); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; } };
  let obj = tryParse(s);
  if (!obj) { const a = s.indexOf("{"), z = s.lastIndexOf("}"); if (a >= 0 && z > a) obj = tryParse(s.slice(a, z + 1)); }
  return obj;
}
