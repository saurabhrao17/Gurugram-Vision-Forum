import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHandler, validateSubscribe, confirmMail, tokenOf, newToken, TOKEN, LANGS } from "../../lib/handlers/subscribe.js";

// ---------------------------------------------------------------------------
// Fakes: a Vercel-style response and a Supabase client recording every
// terminal query. Tables can be arrays or functions of the query.
// ---------------------------------------------------------------------------
function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: "" };
  res.status = (s) => { res.statusCode = s; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; return res; };
  res.end = (b) => { res.body = b || ""; };
  res.json = () => JSON.parse(res.body);
  return res;
}

function fakeSb({ tables = {}, errors = {} } = {}) {
  const calls = { queries: [] };
  const from = (table) => {
    const q = { table, op: "select", row: null, filters: [], opts: null, cols: null };
    const chain = {
      select(cols, opts) { if (q.op === "select") { q.cols = cols; q.opts = opts || null; } else q.returning = cols; return chain; },
      insert(row) { q.op = "insert"; q.row = row; return chain; },
      upsert(row, opts) { q.op = "upsert"; q.row = row; q.opts = opts; return chain; },
      update(row) { q.op = "update"; q.row = row; return chain; },
      eq(k, v) { q.filters.push(["eq", k, v]); return chain; },
      maybeSingle() { q.single = true; return chain; },
      then(resolve, reject) {
        calls.queries.push(q);
        if (errors[table]) return Promise.resolve({ data: null, error: { message: errors[table] } }).then(resolve, reject);
        let data = null;
        if (q.op === "select") {
          const rows = typeof tables[table] === "function" ? tables[table](q) : (tables[table] || []);
          data = q.single ? (rows[0] || null) : rows;
        }
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      }
    };
    return chain;
  };
  return { calls, from };
}

const ENV = { SITE_URL: "https://gvf.test" };
const TOK = "0123456789abcdef0123456789abcdef";

// ---------------------------------------------------------------------------
// Validation and mail
// ---------------------------------------------------------------------------
test("validateSubscribe lower-cases the email, defaults the language and rejects bad input", () => {
  assert.deepEqual(validateSubscribe({ email: " Asha@Example.ORG ", lang: "HI", source: "footer" }), { errors: [], out: { email: "asha@example.org", lang: "hi", source: "footer" } });
  assert.deepEqual(validateSubscribe({ email: "a@b.co" }).out, { email: "a@b.co", lang: "en", source: "site" });
  assert.deepEqual(validateSubscribe({ email: "nope" }).errors, ["email"]);
  assert.deepEqual(validateSubscribe({ email: "a b@c.d" }).errors, ["email"]);
  assert.deepEqual(validateSubscribe({ email: "x".repeat(170) + "@c.d" }).errors, ["email"]);
  assert.deepEqual(validateSubscribe({ email: "a@b.co", lang: "fr" }).errors, ["lang"]);
  assert.deepEqual(validateSubscribe(null).errors, ["email"]);
  assert.deepEqual(LANGS, ["en", "hi"]);
  assert.match(newToken(), TOKEN);
  assert.notEqual(newToken(), newToken());
  assert.equal(tokenOf(TOK.toUpperCase()), TOK);
  assert.equal(tokenOf("short"), null);
  assert.equal(tokenOf(TOK + "0"), null);
  assert.equal(tokenOf(undefined), null);
});

test("confirmMail carries the confirm and stop links, the one-email promise and the consent wording, in both languages", () => {
  const en = confirmMail("a@example.org", "en", TOK, ENV);
  assert.equal(en.kind, "subscribe_confirm");
  assert.equal(en.to_email, "a@example.org");
  assert.equal(en.subject, "Gurugram civic week: confirm your email");
  assert.ok(en.body_text.includes(`https://gvf.test/api/subscribe?confirm=${TOK}`));
  assert.ok(en.body_text.includes(`https://gvf.test/api/subscribe?unsubscribe=${TOK}`));
  assert.ok(en.body_text.includes("one email a week"));
  assert.ok(en.body_text.includes("ignore this email and nothing will be sent"));
  assert.ok(en.body_text.includes("Digital Personal Data Protection Act, 2023"));
  assert.ok(en.body_html.includes(`href="https://gvf.test/api/subscribe?confirm=${TOK}"`));
  const hi = confirmMail("a@example.org", "hi", TOK, ENV);
  assert.equal(hi.subject, "गुरुग्राम नागरिक सप्ताह: अपना ईमेल पक्का करें");
  assert.ok(hi.body_text.includes("हफ़्ते में एक ईमेल"));
  assert.ok(hi.body_text.includes(`confirm=${TOK}`) && hi.body_text.includes(`unsubscribe=${TOK}`));
  assert.ok(confirmMail("a@example.org", "en", TOK, {}).body_text.includes("https://gurugramvisionforum.org/api/subscribe?confirm="));
});

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------
test("POST creates the row with a fresh token and queues the confirmation mail", async () => {
  const sb = fakeSb();
  const res = fakeRes();
  await makeHandler({ sb, env: ENV })({ method: "POST", body: { email: "New@Example.org", lang: "hi", source: "footer" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, status: "check_email" });
  const look = sb.calls.queries.find((q) => q.table === "subscribers" && q.op === "select");
  assert.deepEqual(look.filters, [["eq", "email", "new@example.org"]]);
  const up = sb.calls.queries.find((q) => q.table === "subscribers" && q.op === "upsert");
  assert.deepEqual(up.opts, { onConflict: "email" });
  assert.equal(up.row.email, "new@example.org");
  assert.equal(up.row.lang, "hi");
  assert.equal(up.row.source, "footer");
  assert.match(up.row.token, TOKEN);
  assert.equal(up.row.confirmed_at, null);
  assert.equal(up.row.unsubscribed_at, null);
  const mail = sb.calls.queries.find((q) => q.table === "outbox" && q.op === "insert");
  assert.equal(mail.row.kind, "subscribe_confirm");
  assert.equal(mail.row.to_email, "new@example.org");
  assert.equal(mail.row.subject, "गुरुग्राम नागरिक सप्ताह: अपना ईमेल पक्का करें");
  assert.ok(mail.row.body_text.includes(`https://gvf.test/api/subscribe?confirm=${up.row.token}`));
});

test("POST answers the same for a confirmed address (no new mail), re-invites an unconfirmed or unsubscribed one, and rejects bad input", async () => {
  const confirmed = [{ id: 1, token: TOK, lang: "en", confirmed_at: "2026-09-01T00:00:00Z", unsubscribed_at: null }];
  let sb = fakeSb({ tables: { subscribers: confirmed } });
  let res = fakeRes();
  await makeHandler({ sb, env: ENV })({ method: "POST", body: { email: "a@example.org" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, status: "check_email" });
  assert.ok(!sb.calls.queries.some((q) => q.op === "upsert" || q.op === "insert"), "nothing written, nothing sent");

  for (const row of [{ id: 1, token: TOK, lang: "en", confirmed_at: null, unsubscribed_at: null }, { id: 1, token: TOK, lang: "en", confirmed_at: "2026-09-01T00:00:00Z", unsubscribed_at: "2026-09-09T00:00:00Z" }]) {
    sb = fakeSb({ tables: { subscribers: [row] } });
    res = fakeRes();
    await makeHandler({ sb, env: ENV })({ method: "POST", body: { email: "a@example.org", lang: "hi" } }, res);
    assert.equal(res.statusCode, 200);
    const up = sb.calls.queries.find((q) => q.table === "subscribers" && q.op === "upsert");
    assert.ok(up, "re-invited");
    assert.notEqual(up.row.token, TOK, "a fresh token");
    assert.equal(up.row.lang, "hi");
    assert.equal(up.row.unsubscribed_at, null);
    assert.ok(sb.calls.queries.some((q) => q.table === "outbox" && q.op === "insert"));
  }

  sb = fakeSb();
  res = fakeRes();
  await makeHandler({ sb, env: ENV })({ method: "POST", body: { email: "not-an-email" } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.json(), { ok: false, error: "invalid", fields: ["email"] });
  assert.equal(sb.calls.queries.length, 0);

  res = fakeRes();
  await makeHandler({ sb, env: ENV })({ method: "POST", body: "{broken" }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "bad_json");

  res = fakeRes();
  await makeHandler({ sb, env: ENV })({ method: "PUT", body: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, "GET, POST");

  res = fakeRes();
  await makeHandler({ sb: fakeSb({ errors: { subscribers: "down" } }), env: ENV })({ method: "POST", body: { email: "a@example.org" } }, res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.json(), { ok: false, error: "server_error" });
});

// ---------------------------------------------------------------------------
// GET confirm / unsubscribe
// ---------------------------------------------------------------------------
test("GET ?confirm= sets confirmed_at once and shows the subscribed page; an unknown token is a 404 page", async () => {
  let sb = fakeSb({ tables: { subscribers: (q) => (q.filters[0][2] === TOK ? [{ id: 5, confirmed_at: null, unsubscribed_at: "2026-09-09T00:00:00Z" }] : []) } });
  let res = fakeRes();
  await makeHandler({ sb, env: ENV })({ method: "GET", query: { confirm: TOK } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(res.headers["cache-control"], "no-store");
  assert.ok(res.body.includes("Subscribed. You'll get one email a week."));
  assert.ok(res.body.includes('<p lang="hi">'));
  assert.ok(res.body.includes('href="https://gvf.test/"'));
  assert.ok(res.body.includes('name="robots" content="noindex"'));
  const up = sb.calls.queries.find((q) => q.op === "update");
  assert.deepEqual(up.filters, [["eq", "id", 5]]);
  assert.equal(up.row.unsubscribed_at, null, "confirming again after an unsubscribe re-subscribes");
  assert.ok(up.row.confirmed_at);

  sb = fakeSb({ tables: { subscribers: [{ id: 5, confirmed_at: "2026-09-01T00:00:00Z", unsubscribed_at: null }] } });
  res = fakeRes();
  await makeHandler({ sb, env: ENV })({ method: "GET", query: { confirm: TOK } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(sb.calls.queries.find((q) => q.op === "update").row, { unsubscribed_at: null }, "the first confirmation date is kept");

  sb = fakeSb();
  res = fakeRes();
  await makeHandler({ sb, env: ENV })({ method: "GET", query: { confirm: "f".repeat(32) } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
  assert.ok(res.body.includes("This link is not valid any more"));
  assert.ok(!sb.calls.queries.some((q) => q.op === "update"));

  res = fakeRes();
  await makeHandler({ sb, env: ENV })({ method: "GET", query: { confirm: "not-a-token" } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.json(), { ok: false, error: "invalid" });
  res = fakeRes();
  await makeHandler({ sb, env: ENV })({ method: "GET", query: {} }, res);
  assert.equal(res.statusCode, 400);
});

test("GET ?unsubscribe= sets unsubscribed_at and shows the unsubscribed page; unknown token 404", async () => {
  let sb = fakeSb({ tables: { subscribers: [{ id: 9, confirmed_at: "2026-09-01T00:00:00Z", unsubscribed_at: null }] } });
  let res = fakeRes();
  await makeHandler({ sb, env: ENV })({ method: "GET", query: { unsubscribe: TOK } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes("Unsubscribed."));
  assert.ok(res.body.includes("सदस्यता बंद"));
  const up = sb.calls.queries.find((q) => q.op === "update");
  assert.deepEqual(up.filters, [["eq", "id", 9]]);
  assert.ok(up.row.unsubscribed_at);

  sb = fakeSb({ tables: { subscribers: [{ id: 9, confirmed_at: "2026-09-01T00:00:00Z", unsubscribed_at: "2026-09-02T00:00:00Z" }] } });
  res = fakeRes();
  await makeHandler({ sb, env: ENV })({ method: "GET", query: { unsubscribe: TOK } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(sb.calls.queries.find((q) => q.op === "update").row.unsubscribed_at, "2026-09-02T00:00:00Z", "the first date is kept");

  res = fakeRes();
  await makeHandler({ sb: fakeSb(), env: ENV })({ method: "GET", query: { unsubscribe: "e".repeat(32) } }, res);
  assert.equal(res.statusCode, 404);
  assert.ok(res.body.includes("<!doctype html>"));
});
