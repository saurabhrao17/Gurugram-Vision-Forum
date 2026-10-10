// Shared client for the free-first text-generation providers used by the desk
// (drafts, translation, insights). Every provider with a key is tried in this
// order until one answers (DRAFT_PROVIDER forces one alone; DRAFT_MODEL
// overrides the first provider's model):
//   gemini    GEMINI_API_KEY     Google AI Studio free tier, no card needed
//   groq      GROQ_API_KEY       Groq free tier, no card needed
//   anthropic ANTHROPIC_API_KEY  Claude (paid, only after the free ones fail)
// So a Gemini quota (429), outage or slow answer falls through to Groq.
// Providers retire model names a year or so after release: Gemini's default
// is the alias it keeps pointing at the current Flash model, and a retired
// name (Gemini 404; Groq 404 or "decommissioned") looks the current model up
// in the key's own model list and tries once more.
import { textOf } from "./ai-text.js";

export const MAX_TOKENS = 1500;
export const AI_TIMEOUT_MS = 20000;
export const CLAUDE_MODEL = "claude-sonnet-5-5";
export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
export const GEMINI_LATEST = "gemini-flash-latest";
export const GEMINI_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DISCOVER_TTL_MS = 6 * 3600000;
export const PROVIDERS = {
  gemini: { key: "GEMINI_API_KEY", model: GEMINI_LATEST, url: (m, k) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(k)}` },
  groq: { key: "GROQ_API_KEY", model: "openai/gpt-oss-120b", url: () => "https://api.groq.com/openai/v1/chat/completions" },
  anthropic: { key: "ANTHROPIC_API_KEY", model: CLAUDE_MODEL, url: () => ANTHROPIC_URL }
};
export const PROVIDER_ORDER = ["gemini", "groq", "anthropic"];
export const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";
// Groq models in order of preference when the default is retired.
export const GROQ_PREFERRED = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];

// The providers to try, in order: a forced DRAFT_PROVIDER alone, else every
// provider with a key.
export function providerChain(env) {
  const forced = (env.DRAFT_PROVIDER || "").toLowerCase();
  if (forced && PROVIDERS[forced] && env[PROVIDERS[forced].key]) return [forced];
  return PROVIDER_ORDER.filter((p) => env[PROVIDERS[p].key]);
}

export function pickProvider(env) {
  return providerChain(env)[0] || null;
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
          // gpt-oss models think before answering; "low" keeps the thinking from eating the token budget.
          ...(/gpt-oss/.test(model) ? { reasoning_effort: "low" } : {}),
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

// One completion. Tries each provider in providerChain(env) until one answers,
// all within prompt.timeoutMs (AI_TIMEOUT_MS by default); a provider that has
// another behind it gets 60% of the time left, so a stuck free tier still
// leaves the next one room. Never throws on upstream errors: returns
// { ok, provider, model, text, truncated, refused, status, error, tried? }.
// A refusal is final (another model is not asked to write what one refused).
export async function aiComplete(env, prompt, fetchImpl = globalThis.fetch) {
  const chain = providerChain(env);
  if (!chain.length) return { ok: false, error: "unavailable", provider: null };
  const total = Number(prompt.timeoutMs) > 0 ? Number(prompt.timeoutMs) : AI_TIMEOUT_MS;
  const end = Date.now() + total;
  const failures = [];
  for (let i = 0; i < chain.length; i++) {
    const left = end - Date.now();
    if (i > 0 && left < 1000) break;
    const ms = i < chain.length - 1 ? Math.max(1000, Math.round(left * 0.6)) : Math.max(1, left);
    // DRAFT_MODEL names a model of the first provider; a fallback uses its own default.
    const e = i === 0 ? env : { ...env, DRAFT_MODEL: "" };
    const r = await completeWith(chain[i], e, prompt, fetchImpl, ms);
    if (r.ok || r.error === "refused") return failures.length ? { ...r, fallback_from: failures.map((f) => f.provider) } : r;
    failures.push(r);
  }
  const last = failures[failures.length - 1];
  return failures.length > 1 ? { ...last, tried: failures.map((f) => `${f.provider}: ${f.error}${f.status ? " " + f.status : ""}`) } : last;
}

// A retired or unknown model name, by provider.
function modelGone(provider, r, body) {
  if (!r) return false;
  if (r.status === 404) return provider === "gemini" || provider === "groq";
  if (provider === "groq" && r.status === 400) return /decommission|model_not_found|does not exist/i.test(JSON.stringify((body && body.error) || ""));
  return false;
}

async function completeWith(provider, env, prompt, fetchImpl, ms) {
  const end = Date.now() + ms;
  let call = providerCall(provider, env, prompt);
  let r, body;
  const send = async () => {
    const ctrl = new AbortController();
    let timer;
    const late = new Promise((_, reject) => { timer = setTimeout(() => { ctrl.abort(); reject(Object.assign(new Error("timeout"), { name: "TimeoutError" })); }, Math.max(1, end - Date.now())); });
    try {
      const work = (async () => { const res = await fetchImpl(call.url, { ...call.init, signal: ctrl.signal }); const b = await res.json().catch(() => null); r = res; body = b; })();
      work.catch(() => {}); // an abort after the timeout settles here, not as an unhandled rejection
      await Promise.race([work, late]);
    } finally { clearTimeout(timer); }
  };
  try {
    await send();
    if (modelGone(provider, r, body)) {
      const model = provider === "gemini" ? await discoverGeminiModel(env[PROVIDERS.gemini.key], fetchImpl) : await discoverGroqModel(env[PROVIDERS.groq.key], fetchImpl);
      if (model && model !== call.model) { call = providerCall(provider, { ...env, DRAFT_MODEL: model }, prompt); await send(); }
    }
  } catch (e) {
    if (e && (e.name === "TimeoutError" || e.name === "AbortError")) return { ok: false, error: "timeout", provider, model: call.model, detail: `no answer in ${Math.round(ms / 1000)} s` };
    return { ok: false, error: "network", provider, model: call.model, detail: String(e && e.message || e).slice(0, 160) };
  }
  if (!r.ok) return { ok: false, error: "failed", status: r.status, provider, model: call.model, detail: body && body.error ? JSON.stringify(body.error).slice(0, 200) : "" };
  const out = call.read(body);
  if (out.refused) return { ok: false, error: "refused", provider, model: call.model };
  return { ok: true, provider, model: (body && body.model) || call.model, text: out.text, truncated: !!out.truncated };
}

// The best Flash model in a ListModels reply: the -latest alias when
// listed, else the newest numbered Flash (stable before preview); never the
// lite, image, audio or embedding variants.
export function bestGeminiModel(json) {
  const names = ((json && json.models) || [])
    .filter((m) => m && (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => String(m.name || "").replace(/^models\//, ""));
  if (names.includes(GEMINI_LATEST)) return GEMINI_LATEST;
  const rank = (n) => {
    const m = /^gemini-(\d+(?:\.\d+)?)-flash(-preview(?:-[\d-]+)?)?$/.exec(n);
    return m ? Number(m[1]) * 10 + (m[2] ? 0 : 1) : -1;
  };
  return names.filter((n) => rank(n) >= 0).sort((a, b) => rank(b) - rank(a))[0] || null;
}

let discovered = null;
let groqDiscovered = null;
export function resetGeminiDiscovery() { discovered = null; groqDiscovered = null; }

// The best Groq chat model in a /models reply: the preferred ones first, else
// the first active model that is not speech, a guard or a tool system.
export function bestGroqModel(json) {
  const ids = ((json && json.data) || []).filter((m) => m && m.id && m.active !== false).map((m) => String(m.id));
  return GROQ_PREFERRED.find((p) => ids.includes(p)) || ids.find((id) => !/whisper|tts|orpheus|playai|guard|compound|distil/i.test(id)) || null;
}

// Asks Groq for its current models (cached six hours).
export async function discoverGroqModel(key, fetchImpl = globalThis.fetch, now = Date.now()) {
  if (!key || !fetchImpl) return null;
  if (groqDiscovered && groqDiscovered.key === key && now - groqDiscovered.at < DISCOVER_TTL_MS) return groqDiscovered.model;
  try {
    const r = await fetchImpl(GROQ_MODELS_URL, { headers: { accept: "application/json", authorization: "Bearer " + key } });
    if (!r.ok) return null;
    const model = bestGroqModel(await r.json().catch(() => null));
    if (model) groqDiscovered = { key, model, at: now };
    return model;
  } catch { return null; }
}

// Asks the key's model list for the current Flash model (cached six hours).
export async function discoverGeminiModel(key, fetchImpl = globalThis.fetch, now = Date.now()) {
  if (!key || !fetchImpl) return null;
  if (discovered && discovered.key === key && now - discovered.at < DISCOVER_TTL_MS) return discovered.model;
  try {
    const r = await fetchImpl(`${GEMINI_MODELS_URL}?pageSize=200&key=${encodeURIComponent(key)}`, { headers: { accept: "application/json" } });
    if (!r.ok) return null;
    const model = bestGeminiModel(await r.json().catch(() => null));
    if (model) discovered = { key, model, at: now };
    return model;
  } catch { return null; }
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
