// The newsletter list: the Resend mirror (lib/audience.js), the desk's
// Subscribers endpoint (owner only) and the contact webhooks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { pushContact, pushUnsubscribe, pushDelete, syncSubscriber, audienceStep, syncEnabled } from "../../lib/audience.js";
import { makeHandler as makeSubs, countsOf, statusOf, validateAction } from "../../lib/handlers/triage/subscribers.js";
import { makeHandler as makeHook, contactChange } from "../../lib/handlers/hooks/email.js";
import { makeHandler as makeSubscribe } from "../../lib/handlers/subscribe.js";
import { runDaily } from "../../lib/handlers/cron.js";
import { HttpError } from "../../lib/auth.js";

const ENV = { RESEND_API_KEY: "re_full", SITE_URL: "https://gvf.test" };

function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: null };
  res.status = (s) => { res.statusCode = s; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; return res; };
  res.end = (b) => { try { res.body = JSON.parse(b); } catch { res.body = b; } };
  return res;
}
const authAs = (role) => async (req, roles) => { if (roles && !roles.includes(role)) throw new HttpError(403, "forbidden"); return { user: { id: "u" }, staff: { role, email: role + "@gvf.test", name: "T" } }; };

// A Resend fake: records calls, answers by method/path.
function fakeResend(script = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = url.replace("https://api.resend.com", "");
    calls.push({ method: init.method, path, body: init.body ? JSON.parse(init.body) : null, auth: init.headers.Authorization });
    const key = `${init.method} ${path}`;
    const r = script[key] || script[init.method] || { status: 200, json: { id: "c_1" } };
    return { status: r.status, json: async () => { if (r.json === undefined) throw new Error("no body"); return r.json; } };
  };
  return { calls, fetchImpl };
}

// Minimal Supabase fake: a subscribers table with filters applied in JS.
function fakeSb(rows = []) {
  const calls = [];
  const from = (table) => {
    const q = { table, op: "select", filters: [], row: null, single: false };
    const chain = {
      select() { return chain; },
      update(row) { q.op = "update"; q.row = row; return chain; },
      delete() { q.op = "delete"; return chain; },
      upsert(row, opts) { q.op = "upsert"; q.row = row; q.opts = opts; return chain; },
      insert(row) { q.op = "insert"; q.row = row; return chain; },
      eq(k, v) { q.filters.push(["eq", k, v]); return chain; },
      is(k, v) { q.filters.push(["is", k, v]); return chain; },
      not(k, op, v) { q.filters.push(["not", k, v]); return chain; },
      ilike(k, v) { q.filters.push(["ilike", k, v]); return chain; },
      order() { return chain; }, limit() { return chain; },
      maybeSingle() { q.single = true; return chain; },
      then(resolve, reject) {
        calls.push(q);
        let data = null;
        if (table === "subscribers") {
          const match = (r) => q.filters.every(([op, k, v]) => op === "eq" ? String(r[k]) === String(v) : op === "is" ? r[k] == null : op === "not" ? r[k] != null : String(r[k]).includes(v.replace(/%/g, "")));
          const hit = rows.filter(match);
          if (q.op === "update") { for (const r of hit) Object.assign(r, q.row); data = q.single ? (hit[0] || null) : hit; }
          else if (q.op === "delete") { for (const r of hit) rows.splice(rows.indexOf(r), 1); data = null; }
          else if (q.op === "select") data = q.single ? (hit[0] || null) : hit;
          else data = null;
        }
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      }
    };
    return chain;
  };
  return { from, calls, rows };
}

test("syncEnabled needs a key and respects AUDIENCE_SYNC=off", () => {
  assert.equal(syncEnabled({}), false);
  assert.equal(syncEnabled({ RESEND_API_KEY: "k" }), true);
  assert.equal(syncEnabled({ RESEND_API_KEY: "k", AUDIENCE_SYNC: "off" }), false);
});

test("pushContact creates the contact on /contacts, re-subscribes one that exists, and uses the audience path when configured", async () => {
  const r1 = fakeResend({ "POST /contacts": { status: 201, json: { id: "c_9" } } });
  assert.deepEqual(await pushContact(ENV, { email: "a@example.org", lang: "hi" }, r1.fetchImpl), { ok: true, id: "c_9" });
  assert.deepEqual(r1.calls, [{ method: "POST", path: "/contacts", body: { email: "a@example.org", unsubscribed: false, properties: { lang: "hi" } }, auth: "Bearer re_full" }]);
  const r2 = fakeResend({ "POST /contacts": { status: 409, json: { message: "Contact already exists" } }, "PATCH /contacts/a%40example.org": { status: 200, json: { id: "c_9" } } });
  assert.deepEqual(await pushContact(ENV, { email: "a@example.org" }, r2.fetchImpl), { ok: true, id: "c_9" });
  assert.deepEqual(r2.calls.map((c) => c.method + " " + c.path), ["POST /contacts", "PATCH /contacts/a%40example.org"]);
  assert.deepEqual(r2.calls[1].body, { unsubscribed: false });
  const r3 = fakeResend({ "POST /audiences/aud_1/contacts": { status: 201, json: { id: "c_1" } } });
  await pushContact({ ...ENV, RESEND_AUDIENCE_ID: "aud_1" }, { email: "b@example.org" }, r3.fetchImpl);
  assert.equal(r3.calls[0].path, "/audiences/aud_1/contacts");
  // Unknown property on an older account: retried with the address alone.
  const r4 = fakeResend({ "POST /contacts": { status: 422, json: { message: "properties is not allowed" } } });
  const out = await pushContact(ENV, { email: "c@example.org", lang: "en" }, r4.fetchImpl);
  assert.equal(out.ok, false);
  assert.equal(r4.calls.length, 2);
  assert.deepEqual(r4.calls[1].body, { email: "c@example.org", unsubscribed: false });
  assert.deepEqual(await pushContact({}, { email: "x@example.org" }, r1.fetchImpl), { ok: false, skipped: "no_key" });
});

test("pushUnsubscribe and pushDelete treat an unknown contact as done and report other failures", async () => {
  const r = fakeResend({ "PATCH /contacts/a%40example.org": { status: 404, json: { message: "not found" } }, "DELETE /contacts/a%40example.org": { status: 500, json: { message: "boom" } } });
  assert.deepEqual(await pushUnsubscribe(ENV, "a@example.org", r.fetchImpl), { ok: true, id: null });
  assert.deepEqual(await pushDelete(ENV, "a@example.org", r.fetchImpl), { ok: false, error: "boom", status: 500 });
  const down = fakeResend();
  down.fetchImpl = async () => { throw new Error("ENOTFOUND"); };
  assert.deepEqual(await pushUnsubscribe(ENV, "a@example.org", down.fetchImpl), { ok: false, error: "ENOTFOUND", status: 0 });
});

test("syncSubscriber records synced_at and the contact id, or the error; never for an unconfirmed row", async () => {
  const sb = fakeSb([{ id: 1, email: "a@example.org", lang: "en", confirmed_at: "2026-10-08T00:00:00Z", unsubscribed_at: null }]);
  const r = fakeResend({ "POST /contacts": { status: 201, json: { id: "c_5" } } });
  assert.equal((await syncSubscriber(sb, ENV, sb.rows[0], r.fetchImpl)).ok, true);
  assert.equal(sb.rows[0].external_id, "c_5");
  assert.ok(sb.rows[0].synced_at);
  assert.equal(sb.rows[0].sync_error, null);
  const bad = fakeResend({ "POST /contacts": { status: 401, json: { message: "restricted_api_key" } } });
  sb.rows[0].synced_at = null;
  assert.equal((await syncSubscriber(sb, ENV, sb.rows[0], bad.fetchImpl)).ok, false);
  assert.equal(sb.rows[0].sync_error, "restricted_api_key");
  assert.equal(sb.rows[0].synced_at, null);
  assert.deepEqual(await syncSubscriber(sb, ENV, { id: 2, email: "p@example.org", confirmed_at: null }, r.fetchImpl), { ok: false, skipped: "unconfirmed" });
  assert.equal(r.calls.length, 1);
});

test("audienceStep pushes confirmed rows that are not mirrored yet, unsubscribes stopped ones, and skips without a key or fetch", async () => {
  const sb = fakeSb([
    { id: 1, email: "a@example.org", lang: "en", confirmed_at: "2026-10-01T00:00:00Z", unsubscribed_at: null, synced_at: null },
    { id: 2, email: "b@example.org", lang: "hi", confirmed_at: "2026-10-01T00:00:00Z", unsubscribed_at: "2026-10-07T00:00:00Z", synced_at: null },
    { id: 3, email: "c@example.org", lang: "en", confirmed_at: "2026-10-01T00:00:00Z", unsubscribed_at: null, synced_at: "2026-10-02T00:00:00Z" },
    { id: 4, email: "p@example.org", lang: "en", confirmed_at: null, unsubscribed_at: null, synced_at: null }
  ]);
  const r = fakeResend({ "POST /contacts": { status: 201, json: { id: "c_a" } }, "PATCH /contacts/b%40example.org": { status: 200, json: { id: "c_b" } } });
  assert.deepEqual(await audienceStep(sb, ENV, { fetch: r.fetchImpl }), { pushed: 1, unsubscribed: 1, failed: 0, skipped: null });
  assert.deepEqual(r.calls.map((c) => c.method + " " + c.path), ["POST /contacts", "PATCH /contacts/b%40example.org"]);
  assert.ok(sb.rows[0].synced_at && sb.rows[1].synced_at);
  assert.deepEqual(await audienceStep(sb, {}, { fetch: r.fetchImpl }), { pushed: 0, unsubscribed: 0, failed: 0, skipped: "no_key" });
  assert.deepEqual(await audienceStep(sb, ENV, {}), { pushed: 0, unsubscribed: 0, failed: 0, skipped: "no_fetch" });
  const daily = await runDaily({ from: () => ({ select() { return this; }, not() { return this; }, is() { return this; }, order() { return this; }, limit() { return this; }, insert() { return this; }, update() { return this; }, eq() { return this; }, then(ok) { ok({ data: [], error: null }); }, maybeSingle: async () => ({ data: null, error: null }) }), rpc: async () => ({ data: null, error: null }) }, {}, {}, { only: ["audience"] });
  assert.deepEqual(daily.audience, { pushed: 0, unsubscribed: 0, failed: 0, skipped: "no_key" });
});

test("public confirm mirrors the address and unsubscribe pushes the stop, both without failing the page when Resend is down", async () => {
  const token = "a".repeat(32);
  const sb = fakeSb([{ id: 7, email: "a@example.org", lang: "en", token, confirmed_at: null, unsubscribed_at: null }]);
  const r = fakeResend({ "POST /contacts": { status: 201, json: { id: "c_7" } }, "PATCH /contacts/a%40example.org": { status: 200, json: { id: "c_7" } } });
  const res = fakeRes();
  await makeSubscribe({ sb, env: ENV, fetchImpl: r.fetchImpl })({ method: "GET", query: { confirm: token } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(sb.rows[0].confirmed_at && sb.rows[0].synced_at && sb.rows[0].external_id === "c_7");
  assert.equal(r.calls[0].path, "/contacts");
  const un = fakeRes();
  await makeSubscribe({ sb, env: ENV, fetchImpl: r.fetchImpl })({ method: "GET", query: { unsubscribe: token } }, un);
  assert.equal(un.statusCode, 200);
  assert.ok(sb.rows[0].unsubscribed_at);
  assert.deepEqual(r.calls[1], { method: "PATCH", path: "/contacts/a%40example.org", body: { unsubscribed: true }, auth: "Bearer re_full" });
  // Resend down: the page still answers, the row waits for the nightly retry.
  const sb2 = fakeSb([{ id: 8, email: "b@example.org", lang: "hi", token, confirmed_at: null, unsubscribed_at: null }]);
  const down = fakeRes();
  await makeSubscribe({ sb: sb2, env: ENV, fetchImpl: async () => { throw new Error("ECONNRESET"); } })({ method: "GET", query: { confirm: token } }, down);
  assert.equal(down.statusCode, 200);
  assert.ok(sb2.rows[0].confirmed_at);
  assert.equal(sb2.rows[0].synced_at, null);
  assert.equal(sb2.rows[0].sync_error, "ECONNRESET");
});

test("contact webhooks: an unsubscribe or delete on Resend stops the Forum's digest; re-subscribe only for a once-confirmed address; signature required", async () => {
  assert.deepEqual(contactChange({ type: "contact.updated", data: { email: "A@Example.org", unsubscribed: true } }), { email: "a@example.org", unsubscribe: true });
  assert.deepEqual(contactChange({ type: "contact.deleted", data: { email: "a@example.org" } }), { email: "a@example.org", unsubscribe: true });
  assert.deepEqual(contactChange({ type: "contact.updated", data: { email: "a@example.org", unsubscribed: false } }), { email: "a@example.org", resubscribe: true });
  assert.equal(contactChange({ type: "contact.updated", data: { email: "a@example.org" } }), null);
  const secret = "whsec_" + Buffer.from("supersecretkey").toString("base64");
  const sign = (raw, id) => { const ts = String(Math.floor(Date.now() / 1000)); return { "svix-id": id, "svix-timestamp": ts, "svix-signature": "v1," + createHmac("sha256", Buffer.from("supersecretkey")).update(`${id}.${ts}.${raw}`).digest("base64") }; };
  const sb = fakeSb([
    { id: 1, email: "a@example.org", confirmed_at: "2026-10-01T00:00:00Z", unsubscribed_at: null, synced_at: "2026-10-01T00:00:00Z" },
    { id: 2, email: "p@example.org", confirmed_at: null, unsubscribed_at: "2026-10-02T00:00:00Z", synced_at: null }
  ]);
  const h = makeHook({ env: { RESEND_WEBHOOK_SECRET: secret }, sb });
  const raw = JSON.stringify({ type: "contact.updated", data: { id: "c_1", email: "a@example.org", unsubscribed: true } });
  const res = fakeRes();
  await h({ method: "POST", headers: sign(raw, "msg_1"), query: {}, body: raw }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { ok: true, subscriber: "unsubscribed" });
  assert.ok(sb.rows[0].unsubscribed_at && sb.rows[0].synced_at, "stopped here too, already in step with Resend");
  const back = fakeRes();
  const raw2 = JSON.stringify({ type: "contact.updated", data: { email: "a@example.org", unsubscribed: false } });
  await h({ method: "POST", headers: sign(raw2, "msg_2"), query: {}, body: raw2 }, back);
  assert.deepEqual(back.body, { ok: true, subscriber: "resubscribed" });
  assert.equal(sb.rows[0].unsubscribed_at, null);
  const pend = fakeRes();
  const raw3 = JSON.stringify({ type: "contact.updated", data: { email: "p@example.org", unsubscribed: false } });
  await h({ method: "POST", headers: sign(raw3, "msg_3"), query: {}, body: raw3 }, pend);
  assert.deepEqual(pend.body, { ok: true, subscriber: "unchanged" }, "never confirmed here: double opt-in is not bypassed");
  const unknown = fakeRes();
  const raw4 = JSON.stringify({ type: "contact.deleted", data: { email: "z@example.org" } });
  await h({ method: "POST", headers: sign(raw4, "msg_4"), query: {}, body: raw4 }, unknown);
  assert.deepEqual(unknown.body, { ok: true, subscriber: "unknown" });
  const bad = fakeRes();
  await h({ method: "POST", headers: { "svix-id": "x", "svix-timestamp": "1", "svix-signature": "v1,no" }, query: {}, body: raw }, bad);
  assert.equal(bad.statusCode, 401);
});

test("desk subscribers: owner only; list with counts and search; CSV; actions mirror to Resend; add sends a confirmation", async () => {
  const rows = () => [
    { id: 1, email: "a@example.org", lang: "en", source: "site", created_at: "2026-10-01T00:00:00Z", confirmed_at: "2026-10-01T01:00:00Z", unsubscribed_at: null, synced_at: "2026-10-01T01:00:01Z", sync_error: null, external_id: "c_1" },
    { id: 2, email: "b@example.org", lang: "hi", source: "site", created_at: "2026-10-02T00:00:00Z", confirmed_at: null, unsubscribed_at: null, synced_at: null, sync_error: null, external_id: null },
    { id: 3, email: "c@example.org", lang: "en", source: "desk", created_at: "2026-10-03T00:00:00Z", confirmed_at: "2026-10-03T01:00:00Z", unsubscribed_at: "2026-10-05T00:00:00Z", synced_at: null, sync_error: "http_500", external_id: null }
  ];
  for (const role of ["coordinator", "content", "triage"]) {
    const res = fakeRes();
    await makeSubs({ auth: authAs(role), sb: fakeSb(rows()) })({ method: "GET", query: {} }, res);
    assert.equal(res.statusCode, 403, role);
    assert.deepEqual(res.body, { ok: false, error: "forbidden" });
  }
  assert.deepEqual(countsOf(rows()), { total: 3, confirmed: 1, pending: 1, unsubscribed: 1, synced: 1, sync_failed: 1 });
  assert.deepEqual(rows().map(statusOf), ["confirmed", "pending", "unsubscribed"]);
  assert.deepEqual(validateAction({ action: "erase" }), { value: null, errors: ["action"] });

  const sb = fakeSb(rows());
  const list = fakeRes();
  await makeSubs({ auth: authAs("owner"), sb, env: ENV })({ method: "GET", query: { status: "confirmed" } }, list);
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.body.items.map((r) => r.email), ["a@example.org"]);
  assert.deepEqual(list.body.counts, { total: 3, confirmed: 1, pending: 1, unsubscribed: 1, synced: 1, sync_failed: 1 });
  assert.deepEqual(list.body.sync, { enabled: true, provider: "resend" });
  assert.equal(list.headers["Cache-Control"], "no-store");
  const search = fakeRes();
  await makeSubs({ auth: authAs("owner"), sb: fakeSb(rows()), env: {} })({ method: "GET", query: { q: "C@EX" } }, search);
  assert.deepEqual(search.body.items.map((r) => r.id), [3]);
  assert.deepEqual(search.body.sync, { enabled: false, provider: null });
  const csv = fakeRes();
  await makeSubs({ auth: authAs("owner"), sb: fakeSb(rows()), env: ENV })({ method: "GET", query: { export: "csv" } }, csv);
  assert.equal(csv.headers["Content-Type"], "text/csv; charset=utf-8");
  assert.ok(String(csv.body).startsWith('﻿"email","lang","status"'));
  assert.ok(String(csv.body).includes('"c@example.org","en","unsubscribed","desk"'));

  // Stop emails: the row is stopped and Resend told.
  const r = fakeResend({ "PATCH /contacts/a%40example.org": { status: 200, json: { id: "c_1" } }, "POST /contacts": { status: 201, json: { id: "c_3" } }, "DELETE /contacts/b%40example.org": { status: 200, json: {} } });
  const h = makeSubs({ auth: authAs("owner"), sb, env: ENV, fetchImpl: r.fetchImpl });
  const stop = fakeRes();
  await h({ method: "PATCH", query: { id: "1" }, body: { action: "unsubscribe" } }, stop);
  assert.equal(stop.statusCode, 200, JSON.stringify(stop.body));
  assert.equal(stop.body.item.status === undefined ? statusOf(stop.body.item) : stop.body.item.status, "unsubscribed");
  assert.ok(sb.rows[0].unsubscribed_at && sb.rows[0].synced_at);
  assert.deepEqual(r.calls[0], { method: "PATCH", path: "/contacts/a%40example.org", body: { unsubscribed: true }, auth: "Bearer re_full" });
  // Put back a once-confirmed address: re-created as a contact.
  const back = fakeRes();
  await h({ method: "PATCH", query: { id: "3" }, body: { action: "resubscribe" } }, back);
  assert.equal(back.statusCode, 200);
  assert.equal(sb.rows[2].unsubscribed_at, null);
  assert.equal(sb.rows[2].external_id, "c_3");
  assert.equal(r.calls[1].path, "/contacts");
  // A pending address cannot be put back silently.
  sb.rows[1].unsubscribed_at = "2026-10-06T00:00:00Z";
  const pend = fakeRes();
  await h({ method: "PATCH", query: { id: "2" }, body: { action: "resubscribe" } }, pend);
  assert.equal(pend.statusCode, 409);
  // Erase: gone here and on Resend (only when it had been mirrored, so a pending row makes no call).
  const erase = fakeRes();
  await h({ method: "PATCH", query: { id: "2" }, body: { action: "delete" } }, erase);
  assert.deepEqual(erase.body, { ok: true, deleted: true, id: 2 });
  assert.equal(sb.rows.length, 2);
  assert.equal(r.calls.length, 2, "an unconfirmed address was never on Resend");
  const bad = fakeRes();
  await h({ method: "PATCH", query: { id: "1" }, body: { action: "nuke" } }, bad);
  assert.equal(bad.statusCode, 400);
  const missing = fakeRes();
  await h({ method: "PATCH", query: { id: "999" }, body: { action: "sync" } }, missing);
  assert.equal(missing.statusCode, 404);

  // Add from the desk: upsert with a fresh token and the confirmation mail in the outbox; never confirmed silently.
  const add = fakeRes();
  await h({ method: "POST", body: { email: "New@Example.org", lang: "hi" } }, add);
  assert.deepEqual(add.body, { ok: true, status: "check_email" });
  const up = sb.calls.find((q) => q.table === "subscribers" && q.op === "upsert");
  assert.equal(up.row.email, "new@example.org");
  assert.equal(up.row.source, "desk");
  assert.equal(up.row.confirmed_at, null);
  assert.match(up.row.token, /^[0-9a-f]{32}$/);
  const mail = sb.calls.find((q) => q.table === "outbox" && q.op === "insert");
  assert.equal(mail.row.kind, "subscribe_confirm");
  assert.equal(mail.row.to_email, "new@example.org");
  assert.ok(mail.row.body_text.includes("https://gvf.test/api/subscribe?confirm=" + up.row.token));
  const dup = fakeRes();
  await h({ method: "POST", body: { email: "c@example.org" } }, dup);
  assert.deepEqual(dup.body, { ok: true, status: "already_subscribed" });
  const invalid = fakeRes();
  await h({ method: "POST", body: { email: "nope" } }, invalid);
  assert.equal(invalid.statusCode, 400);
});
