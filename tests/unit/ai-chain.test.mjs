import test from "node:test";
import assert from "node:assert/strict";
import { aiComplete, providerChain, bestGroqModel, resetGeminiDiscovery, PROVIDERS } from "../../lib/ai.js";

const geminiOk = (text) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] }) });
const groqOk = (text, model = "openai/gpt-oss-120b") => ({ ok: true, status: 200, json: async () => ({ model, choices: [{ finish_reason: "stop", message: { content: text } }] }) });

test("providerChain tries every provider with a key, free ones first; DRAFT_PROVIDER forces one", () => {
  assert.deepEqual(providerChain({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q", ANTHROPIC_API_KEY: "a" }), ["gemini", "groq", "anthropic"]);
  assert.deepEqual(providerChain({ GROQ_API_KEY: "q" }), ["groq"]);
  assert.deepEqual(providerChain({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q", DRAFT_PROVIDER: "groq" }), ["groq"]);
  assert.deepEqual(providerChain({}), []);
  assert.equal(PROVIDERS.groq.model, "openai/gpt-oss-120b", "llama-3.3-70b-versatile left Groq's free plan on 16 Aug 2026");
});

test("a Gemini quota error falls through to Groq, which thinks briefly", async () => {
  resetGeminiDiscovery();
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(url);
    if (/generativelanguage/.test(url)) return { ok: false, status: 429, json: async () => ({ error: { status: "RESOURCE_EXHAUSTED" } }) };
    const body = JSON.parse(init.body);
    assert.equal(body.model, "openai/gpt-oss-120b");
    assert.equal(body.reasoning_effort, "low");
    return groqOk('{"a":1}');
  };
  const r = await aiComplete({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q", DRAFT_MODEL: "gemini-x" }, { system: "s", user: "u" }, fetchImpl);
  assert.equal(r.ok, true); assert.equal(r.provider, "groq"); assert.deepEqual(r.fallback_from, ["gemini"]);
  assert.equal(seen.length, 2);
  assert.match(seen[0], /gemini-x/, "DRAFT_MODEL applies to the first provider only");
});

test("a stuck Gemini leaves Groq time inside the same limit", async () => {
  const fetchImpl = (url, init) => /generativelanguage/.test(url)
    ? new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))))
    : Promise.resolve(groqOk("{}"));
  const t0 = Date.now();
  const r = await aiComplete({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q" }, { system: "s", user: "u", timeoutMs: 3000 }, fetchImpl);
  assert.equal(r.ok, true); assert.equal(r.provider, "groq");
  assert.ok(Date.now() - t0 < 2900, "Gemini got 60% of the time, not all of it");
});

test("a retired Groq model is swapped for the current one from Groq's list", async () => {
  resetGeminiDiscovery();
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
  resetGeminiDiscovery();
});

test("when every provider fails the last error is returned with what was tried; a refusal is final", async () => {
  const fail = async () => ({ ok: false, status: 503, json: async () => ({ error: { message: "busy" } }) });
  const r = await aiComplete({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q" }, { system: "s", user: "u" }, fail);
  assert.equal(r.ok, false); assert.equal(r.provider, "groq"); assert.deepEqual(r.tried, ["gemini: failed 503", "groq: failed 503"]);
  let groqAsked = false;
  const refuse = async (url) => { if (/groq/.test(url)) groqAsked = true; return { ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] }) }; };
  const r2 = await aiComplete({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q" }, { system: "s", user: "u" }, refuse);
  assert.equal(r2.error, "refused"); assert.equal(groqAsked, false);
  const one = await aiComplete({ GEMINI_API_KEY: "g" }, { system: "s", user: "u" }, async () => geminiOk("hi"));
  assert.equal(one.ok, true); assert.equal(one.fallback_from, undefined);
});
