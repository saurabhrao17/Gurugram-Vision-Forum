import test from "node:test";
import assert from "node:assert/strict";
import { aiComplete, providerChain, bestGroqModel, resetGroqDiscovery, PROVIDERS } from "../../lib/ai.js";

const claudeOk = (text) => ({ ok: true, status: 200, json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text }] }) });
const groqOk = (text, model = "openai/gpt-oss-120b") => ({ ok: true, status: 200, json: async () => ({ model, choices: [{ finish_reason: "stop", message: { content: text } }] }) });

test("providerChain tries Groq, then the paid key; Gemini is gone; DRAFT_PROVIDER forces one", () => {
  assert.deepEqual(providerChain({ GROQ_API_KEY: "q", ANTHROPIC_API_KEY: "a" }), ["groq", "anthropic"]);
  assert.deepEqual(providerChain({ GEMINI_API_KEY: "g" }), [], "a Gemini key alone is ignored");
  assert.equal(PROVIDERS.gemini, undefined);
  assert.deepEqual(providerChain({ GROQ_API_KEY: "q" }), ["groq"]);
  assert.deepEqual(providerChain({ ANTHROPIC_API_KEY: "a", GROQ_API_KEY: "q", DRAFT_PROVIDER: "groq" }), ["groq"]);
  assert.deepEqual(providerChain({}), []);
  assert.equal(PROVIDERS.groq.model, "openai/gpt-oss-120b", "llama-3.3-70b-versatile left Groq's free plan on 16 Aug 2026");
});

test("Groq answers first and thinks briefly; a Groq quota error falls through to the paid key", async () => {
  resetGroqDiscovery();
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(url);
    if (/groq/.test(url)) {
      const body = JSON.parse(init.body);
      assert.equal(body.model, "openai/gpt-oss-120b");
      assert.equal(body.reasoning_effort, "low");
      return seen.length === 1 ? groqOk('{"a":1}') : { ok: false, status: 429, json: async () => ({ error: { code: "rate_limit_exceeded" } }) };
    }
    return claudeOk('{"b":2}');
  };
  const env = { ANTHROPIC_API_KEY: "a", GROQ_API_KEY: "q" };
  const first = await aiComplete(env, { system: "s", user: "u" }, fetchImpl);
  assert.equal(first.provider, "groq"); assert.equal(seen.length, 1, "the paid key is not called while Groq answers");
  const r = await aiComplete(env, { system: "s", user: "u" }, fetchImpl);
  assert.equal(r.ok, true); assert.equal(r.provider, "anthropic"); assert.deepEqual(r.fallback_from, ["groq"]);
  assert.match(seen[2], /anthropic/, "the backup uses its own endpoint");
});

test("a stuck Groq leaves the paid key time inside the same limit", async () => {
  const fetchImpl = (url, init) => /groq/.test(url)
    ? new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))))
    : Promise.resolve(claudeOk("{}"));
  const t0 = Date.now();
  const r = await aiComplete({ ANTHROPIC_API_KEY: "a", GROQ_API_KEY: "q" }, { system: "s", user: "u", timeoutMs: 3000 }, fetchImpl);
  assert.equal(r.ok, true); assert.equal(r.provider, "anthropic");
  assert.ok(Date.now() - t0 < 2900, "Groq got 60% of the time, not all of it");
});

test("a retired Groq model is swapped for the current one from Groq's list", async () => {
  resetGroqDiscovery();
  const models = [];
  const fetchImpl = async (url, init) => {
    if (/\/models$/.test(url)) return { ok: true, status: 200, json: async () => ({ data: [{ id: "whisper-large-v3" }, { id: "openai/gpt-oss-20b" }, { id: "qwen/qwen3.8-27b" }] }) };
    const m = JSON.parse(init.body).model; models.push(m);
    if (m === "openai/gpt-oss-120b") return { ok: false, status: 400, json: async () => ({ error: { code: "model_decommissioned", message: "The model has been decommissioned" } }) };
    return groqOk("{}", m);
  };
  const r = await aiComplete({ GROQ_API_KEY: "q" }, { system: "s", user: "u" }, fetchImpl);
  assert.equal(r.ok, true); assert.equal(r.model, "openai/gpt-oss-20b");
  assert.deepEqual(models, ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
  assert.equal(bestGroqModel({ data: [{ id: "whisper-large-v3" }, { id: "llama-prompt-guard" }, { id: "qwen/qwen3.8-27b" }] }), "qwen/qwen3.8-27b");
  assert.equal(bestGroqModel(null), null);
  resetGroqDiscovery();
});

test("when every provider fails the last error is returned with what was tried; a refusal is final", async () => {
  const fail = async () => ({ ok: false, status: 503, json: async () => ({ error: { message: "busy" } }) });
  const r = await aiComplete({ ANTHROPIC_API_KEY: "a", GROQ_API_KEY: "q" }, { system: "s", user: "u" }, fail);
  assert.equal(r.ok, false); assert.equal(r.provider, "anthropic"); assert.deepEqual(r.tried, ["groq: failed 503", "anthropic: failed 503"]);
  let groqAsked = false;
  const refuse = async (url) => { if (/groq/.test(url)) groqAsked = true; return { ok: true, status: 200, json: async () => ({ stop_reason: "refusal", content: [] }) }; };
  const r2 = await aiComplete({ ANTHROPIC_API_KEY: "a" }, { system: "s", user: "u" }, refuse);
  assert.equal(r2.error, "refused"); assert.equal(groqAsked, false);
  const one = await aiComplete({ ANTHROPIC_API_KEY: "a" }, { system: "s", user: "u" }, async () => claudeOk("hi"));
  assert.equal(one.ok, true); assert.equal(one.fallback_from, undefined);
});
