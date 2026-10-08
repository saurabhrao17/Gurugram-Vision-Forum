import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLink, BOT_LIMITED } from "../../lib/link-check.js";

const answer = (status) => ({ status, ok: status >= 200 && status < 300 });

test("a bot-limited answer (401/403/405/429) counts as reachable; a dead page does not", async () => {
  assert.deepEqual([...BOT_LIMITED].sort(), [401, 403, 405, 429]);
  const r403 = await checkLink("https://mohua.gov.in/", async () => answer(403), { timeoutMs: 100 });
  assert.equal(r403.ok, true);
  assert.equal(r403.status, 403);
  assert.equal(r403.error, "bot_limited");
  const r404 = await checkLink("https://dead.example/", async () => answer(404), { timeoutMs: 100 });
  assert.equal(r404.ok, false);
  assert.equal(r404.error, undefined);
  const r200 = await checkLink("https://ok.example/", async () => answer(200), { timeoutMs: 100 });
  assert.deepEqual([r200.ok, r200.status, r200.error], [true, 200, undefined]);
});

test("a host that gives no answer is retried once with a longer timeout", async () => {
  const calls = [];
  let n = 0;
  const slow = async (url, init) => {
    calls.push([init.method, init.signal ? "signal" : "none"]);
    n++;
    if (n < 3) { const e = new Error("aborted"); e.name = "AbortError"; throw e; }
    return answer(200);
  };
  const r = await checkLink("https://slow.gov.in/", slow, { timeoutMs: 50 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(calls.map((c) => c[0]), ["HEAD", "GET", "GET"], "HEAD, GET, then one retried GET");
  let m = 0;
  const never = async () => { m++; const e = new Error("aborted"); e.name = "AbortError"; throw e; };
  const dead = await checkLink("https://never.gov.in/", never, { timeoutMs: 20 });
  assert.equal(dead.ok, false);
  assert.equal(dead.status, 0);
  assert.equal(dead.error, "timeout");
  assert.equal(m, 3, "three attempts at most");
});
