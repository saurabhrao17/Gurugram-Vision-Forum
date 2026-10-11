import test from "node:test";
import assert from "node:assert/strict";
import { aiComplete, providerChain, bestGroqModel, resetGroqDiscovery, PROVIDERS } from "../../lib/ai.js";

const groqOk = (text, model = "openai/gpt-oss-120b") => ({ ok: true, status: 200, json: async () => ({ model, choices: [{ finish_reason: "stop", message: { content: text } }] }) });

test("providerChain is Groq only; Gemini and Anthropic keys alone give an empty chain", () => {
  assert.deepEqual(providerChain({ GROQ_API_KEY: "q" }), ["groq"]);
  assert.deepEqual(providerChain({ GROQ_API_KEY: "q", ANTHROPIC_API_KEY: "a", GEMINI_API_KEY: "g" }), ["groq"], "other keys are ignored");
  assert.deepEqual(providerChain({ ANTHROPIC_API_KEY: "a" }), [], "an Anthropic key alone is ignored (no paid fallback)");
  assert.deepEqual(providerChain({ ANTHROPIC_API_KEY: "a", DRAFT_PROVIDER: "anthropic" }), [], "a forced Anthropic provider is ignored");
  assert.deepEqual(providerChain({ GEMINI_API_KEY: "g" }), [], "a Gemini key alone is ignored");
  assert.deepEqual(providerChain({}), []);
  assert.deepEqual(Object.keys(PROVIDERS), ["groq"]);
  assert.equal(PROVIDERS.gemini, undefined); assert.equal(PROVIDERS.anthropic, undefined);
  assert.equal(PROVIDERS.groq.model, "openai/gpt-oss-120b", "llama-3.3-70b-versatile left Groq's free plan on 16 Aug 2026");
});

test("an Anthropic key alone makes no call and answers unavailable", async () => {
  let called = false;
  const r = await aiComplete({ ANTHROPIC_API_KEY: "a" }, { system: "s", user: "u" }, async () => { called = true; return groqOk("x"); });
  assert.deepEqual(r, { ok: false, error: "unavailable", provider: null });
  assert.equal(called, false);
});

test("Groq answers and thinks briefly; a Groq quota error is a failure, never a paid fallback", async () => {
  resetGroqDiscovery();
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(url);
    assert.match(url, /api\.groq\.com/, "only Groq is ever called");
    const body = JSON.parse(init.body);
    assert.equal(body.model, "openai/gpt-oss-120b");
    assert.equal(body.reasoning_effort, "low");
    return seen.length === 1 ? groqOk('{"a":1}') : { ok: false, status: 429, json: async () => ({ error: { code: "rate_limit_exceeded" } }) };
  };
  const env = { ANTHROPIC_API_KEY: "a", GROQ_API_KEY: "q" };
  const first = await aiComplete(env, { system: "s", user: "u" }, fetchImpl);
  assert.equal(first.ok, true); assert.equal(first.provider, "groq");
  const r = await aiComplete(env, { system: "s", user: "u" }, fetchImpl);
  assert.equal(r.ok, false); assert.equal(r.provider, "groq"); assert.equal(r.status, 429);
  assert.equal(r.fallback_from, undefined); assert.equal(r.tried, undefined);
  assert.equal(seen.length, 2);
});

test("a stuck Groq times out inside the limit and reports it", async () => {
  const fetchImpl = (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  const t0 = Date.now();
  const r = await aiComplete({ ANTHROPIC_API_KEY: "a", GROQ_API_KEY: "q" }, { system: "s", user: "u", timeoutMs: 1500 }, fetchImpl);
  assert.equal(r.ok, false); assert.equal(r.error, "timeout"); assert.equal(r.provider, "groq");
  assert.ok(Date.now() - t0 < 2500, "stops at the time limit");
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

test("a Groq failure is returned as is; a Groq refusal is final", async () => {
  const fail = async () => ({ ok: false, status: 503, json: async () => ({ error: { message: "busy" } }) });
  const r = await aiComplete({ GROQ_API_KEY: "q" }, { system: "s", user: "u" }, fail);
  assert.equal(r.ok, false); assert.equal(r.provider, "groq"); assert.equal(r.status, 503); assert.equal(r.error, "failed");
  const calls = [];
  const net = async (url) => { calls.push(url); throw new Error("down"); };
  const rn = await aiComplete({ GROQ_API_KEY: "q", ANTHROPIC_API_KEY: "a" }, { system: "s", user: "u" }, net);
  assert.equal(rn.error, "network"); assert.equal(calls.length, 1, "no second provider is tried");
  const refuse = async () => groqOk("");
  const empty = await aiComplete({ GROQ_API_KEY: "q" }, { system: "s", user: "u" }, refuse);
  assert.equal(empty.ok, true); assert.equal(empty.text, "");
});
