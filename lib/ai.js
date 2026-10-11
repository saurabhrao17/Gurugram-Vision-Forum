// Shared client for the text generation used by the desk (drafts,
// translation, insights, round-ups). AI answers use Groq ONLY (owner's
// decisions, 10 and 11 Oct 2026): GROQ_API_KEY, free tier, no card. There is
// no other provider and no paid fallback; any other key in the environment
// (ANTHROPIC_API_KEY, GEMINI_API_KEY) is ignored. DRAFT_MODEL overrides the
// model. Without a key, or when Groq is down, slow or out of quota, aiComplete
// answers { ok: false } and every caller falls back to rule-based text or a
// plain "AI is unavailable" message. Groq retires model names a year or so
// after release: a retired name (404 or "decommissioned") looks the current
// model up in the key's own model list and tries once more.

export const MAX_TOKENS = 1500;
export const AI_TIMEOUT_MS = 20000;
const DISCOVER_TTL_MS = 6 * 3600000;
export const PROVIDERS = {
  groq: { key: "GROQ_API_KEY", model: "openai/gpt-oss-120b", url: () => "https://api.groq.com/openai/v1/chat/completions" }
};
export const PROVIDER_ORDER = ["groq"];
export const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";
// Groq models in order of preference when the default is retired.
export const GROQ_PREFERRED = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];

// The providers to try: Groq when GROQ_API_KEY is set, else none.
export function providerChain(env) {
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
  if (r.status === 404) return provider === "groq";
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
      const model = await discoverGroqModel(env[PROVIDERS.groq.key], fetchImpl);
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

let groqDiscovered = null;
export function resetGroqDiscovery() { groqDiscovered = null; }

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
