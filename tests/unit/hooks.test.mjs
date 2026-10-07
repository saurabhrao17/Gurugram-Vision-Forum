import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { handle as whatsapp, signatureOk, messageText } from "../../lib/handlers/hooks/whatsapp.js";
import { handle as exotel, params, describeCall } from "../../lib/handlers/hooks/exotel.js";
import { sectorFrom, refFrom, isStatusQuery, registeredReply, statusReply } from "../../lib/inbound.js";

function mockRes() {
  const r = { statusCode: 0, headers: {}, body: "" };
  r.status = (c) => { r.statusCode = c; return r; };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; return r; };
  r.end = (b) => { r.body = b || ""; return r; };
  r.json = () => JSON.parse(r.body);
  return r;
}

// In-memory store with the same methods as makeStore(); reports get a ref like the DB trigger.
function fakeStore(seed = []) {
  const reports = [...seed];
  const inbound = [];
  let n = 0;
  return {
    reports, inbound,
    async seen(provider, id) { return inbound.find((m) => m.provider === provider && m.external_id === id) || null; },
    async createReport(row) {
      n++;
      const r = { ...row, id: "id-" + n, ref: "GVF-2026-ABCD" + n, stage: 0, created_at: new Date().toISOString() };
      reports.push(r);
      return { id: r.id, ref: r.ref, stage: r.stage, created_at: r.created_at };
    },
    async recordInbound(row) { inbound.push(row); },
    async findByRef(ref, phone) { return reports.find((r) => r.ref === ref && r.reporter_phone === phone) || null; },
    async recentForPhone(phone) { return [...reports].reverse().find((r) => r.reporter_phone === phone) || null; },
    async reportById(id) { return reports.find((r) => r.id === id) || null; },
    async appendDescription(id, extra) { const r = reports.find((r) => r.id === id); if (r && !r.description.includes(extra)) r.description += extra; }
  };
}

const SECRET = "app-secret-123";
const VERIFY = "verify-me";

function metaPayload(message, name = "Ravi") {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "1", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp", metadata: { display_phone_number: "911234", phone_number_id: "PHONE" },
      contacts: [{ profile: { name }, wa_id: message.from }],
      messages: [message]
    } }] }]
  };
}

function signedPost(payload, secret = SECRET) {
  const raw = JSON.stringify(payload);
  const sig = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  return { method: "POST", headers: { "x-hub-signature-256": sig, "content-type": "application/json" }, body: payload, rawBody: raw, query: {} };
}

test("whatsapp GET handshake returns the challenge for the right token", async () => {
  const res = mockRes();
  await whatsapp({ method: "GET", headers: {}, query: { "hub.mode": "subscribe", "hub.verify_token": VERIFY, "hub.challenge": "12345" } }, res, { env: { WHATSAPP_VERIFY_TOKEN: VERIFY } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, "12345");
  assert.match(res.headers["content-type"], /text\/plain/);
});

test("whatsapp GET handshake is 403 on a wrong token, wrong mode or unset env", async () => {
  for (const [q, env] of [
    [{ "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "1" }, { WHATSAPP_VERIFY_TOKEN: VERIFY }],
    [{ "hub.mode": "unsubscribe", "hub.verify_token": VERIFY, "hub.challenge": "1" }, { WHATSAPP_VERIFY_TOKEN: VERIFY }],
    [{ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1" }, {}]
  ]) {
    const res = mockRes();
    await whatsapp({ method: "GET", headers: {}, query: q }, res, { env });
    assert.equal(res.statusCode, 403);
  }
});

test("signatureOk accepts the right HMAC and rejects a tampered body", () => {
  const raw = Buffer.from('{"a":1}');
  const sig = "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex");
  assert.ok(signatureOk(SECRET, raw, sig));
  assert.ok(!signatureOk(SECRET, Buffer.from('{"a":2}'), sig));
  assert.ok(!signatureOk(SECRET, raw, "sha256=abc"));
  assert.ok(!signatureOk(SECRET, raw, undefined));
});

test("whatsapp POST with a bad signature is 401 and writes nothing", async () => {
  const store = fakeStore();
  const payload = metaPayload({ id: "wamid.1", from: "919899375445", type: "text", text: { body: "hello" }, timestamp: "1" });
  const req = signedPost(payload, "wrong-secret");
  const res = mockRes();
  await whatsapp(req, res, { env: { WHATSAPP_APP_SECRET: SECRET }, store, sendWhatsApp: async () => true });
  assert.equal(res.statusCode, 401);
  assert.equal(store.reports.length, 0);
});

test("whatsapp text message creates a report with source whatsapp and replies with the ref", async () => {
  const store = fakeStore();
  const sent = [];
  const payload = metaPayload({ id: "wamid.2", from: "919899375445", type: "text", text: { body: "Garbage not lifted in sec 45 for a week" }, timestamp: "1" });
  const res = mockRes();
  await whatsapp(signedPost(payload), res, { env: { WHATSAPP_APP_SECRET: SECRET }, store, sendWhatsApp: async (to, t) => { sent.push([to, t]); return true; } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, handled: 1 });
  assert.equal(store.reports.length, 1);
  const r = store.reports[0];
  assert.equal(r.source, "whatsapp");
  assert.equal(r.reporter_phone, "+919899375445");
  assert.equal(r.reporter_name, "Ravi");
  assert.equal(r.issue_type, "other");
  assert.equal(r.area, "Sector 45");
  assert.equal(r.description, "Garbage not lifted in sec 45 for a week");
  assert.ok(r.consent_at);
  assert.equal(store.inbound.length, 1);
  assert.equal(store.inbound[0].external_id, "wamid.2");
  assert.equal(store.inbound[0].report_id, r.id);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], "919899375445");
  assert.ok(sent[0][1].includes(r.ref));
  assert.ok(sent[0][1].includes("#/track/" + r.ref));
  assert.ok(!sent[0][1].includes("Ravi"));
  assert.ok(!sent[0][1].includes("9899375445"));
});

test("whatsapp duplicate message id is skipped", async () => {
  const store = fakeStore();
  const payload = metaPayload({ id: "wamid.3", from: "919899375445", type: "text", text: { body: "Street light out" }, timestamp: "1" });
  const deps = { env: {}, store, sendWhatsApp: async () => true };
  let res = mockRes();
  await whatsapp({ method: "POST", headers: {}, query: {}, body: payload }, res, deps);
  assert.deepEqual(res.json(), { ok: true, handled: 1 });
  res = mockRes();
  await whatsapp({ method: "POST", headers: {}, query: {}, body: payload }, res, deps);
  assert.deepEqual(res.json(), { ok: true, handled: 0 });
  assert.equal(store.reports.length, 1);
  assert.equal(store.inbound.length, 1);
});

test("whatsapp status query replies with the stage", async () => {
  const store = fakeStore([{ id: "x1", ref: "GVF-2026-K7P2Q", stage: 1, reporter_phone: "+919899375445", description: "d", created_at: "2026-10-01T00:00:00Z" }]);
  const sent = [];
  const deps = { env: {}, store, sendWhatsApp: async (to, t) => { sent.push(t); return true; } };
  let res = mockRes();
  await whatsapp({ method: "POST", headers: {}, query: {}, body: metaPayload({ id: "wamid.4", from: "919899375445", type: "text", text: { body: "status of gvf-2026-k7p2q?" }, timestamp: "1" }) }, res, deps);
  assert.deepEqual(res.json(), { ok: true, handled: 1 });
  assert.equal(store.reports.length, 1, "no new report for a status query");
  assert.ok(sent[0].includes("GVF-2026-K7P2Q"));
  assert.ok(sent[0].includes("Mapped"));
  assert.ok(sent[0].includes("मैप किया गया"));
  // Bare "status" uses the newest report from this phone
  res = mockRes();
  await whatsapp({ method: "POST", headers: {}, query: {}, body: metaPayload({ id: "wamid.5", from: "919899375445", type: "text", text: { body: "स्थिति" }, timestamp: "2" }) }, res, deps);
  assert.ok(sent[1].includes("GVF-2026-K7P2Q"));
  // A reference from another phone is not disclosed
  res = mockRes();
  await whatsapp({ method: "POST", headers: {}, query: {}, body: metaPayload({ id: "wamid.6", from: "919811111111", type: "text", text: { body: "GVF-2026-K7P2Q" }, timestamp: "3" }) }, res, deps);
  assert.ok(!sent[2].includes("Mapped"));
  assert.ok(sent[2].includes("no report"));
  assert.equal(store.inbound.length, 3);
});

test("whatsapp image without caption becomes a report; statuses and unknown payloads are ignored", async () => {
  const store = fakeStore();
  const deps = { env: {}, store, sendWhatsApp: async () => true };
  let res = mockRes();
  await whatsapp({ method: "POST", headers: {}, query: {}, body: metaPayload({ id: "wamid.7", from: "919899375445", type: "image", image: { id: "m1" }, timestamp: "1" }) }, res, deps);
  assert.equal(store.reports[0].description, "Photo sent on WhatsApp");
  assert.equal(store.reports[0].area, "WhatsApp");
  res = mockRes();
  await whatsapp({ method: "POST", headers: {}, query: {}, body: { object: "whatsapp_business_account", entry: [{ changes: [{ value: { statuses: [{ id: "x", status: "delivered" }] } }] }] } }, res, deps);
  assert.deepEqual(res.json(), { ok: true, handled: 0 });
  res = mockRes();
  await whatsapp({ method: "POST", headers: {}, query: {}, body: { object: "page" } }, res, deps);
  assert.equal(res.statusCode, 200);
  assert.equal(messageText({ type: "reaction" }), null);
});

test("inbound helpers", () => {
  assert.equal(sectorFrom("water leak Sector-45 near park"), "Sector 45");
  assert.equal(sectorFrom("sec. 57 a road"), "Sector 57A");
  assert.equal(sectorFrom("no sector here"), null);
  assert.equal(refFrom("my ref is gvf-2026-abc23"), "GVF-2026-ABC23");
  assert.ok(isStatusQuery("Status please"));
  assert.ok(isStatusQuery("मेरी शिकायत की स्थिति"));
  assert.ok(!isStatusQuery("Road broken in sector 10"));
  assert.ok(registeredReply("GVF-2026-ABCDE").includes("GVF-2026-ABCDE"));
  assert.ok(statusReply({ ref: "GVF-2026-ABCDE", stage: 4 }).includes("Resolved"));
});

test("exotel form body creates a report with source phone", async () => {
  const store = fakeStore();
  const body = new URLSearchParams({ CallSid: "abc123", From: "09899375445", To: "01244567890", CallStatus: "completed", Direction: "inbound", RecordingUrl: "https://rec.exotel.com/x.mp3", digits: '"2"' }).toString();
  const req = { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-webhook-token": "tok" }, query: {}, body };
  const res = mockRes();
  await exotel(req, res, { env: { EXOTEL_WEBHOOK_TOKEN: "tok" }, store });
  assert.equal(res.statusCode, 200);
  const j = res.json();
  assert.equal(j.ok, true);
  assert.match(j.ref, /^GVF-2026-/);
  const r = store.reports[0];
  assert.equal(r.source, "phone");
  assert.equal(r.reporter_phone, "+919899375445");
  assert.equal(r.reporter_name, "Helpline caller");
  assert.equal(r.area, "Helpline call");
  assert.equal(r.description, "Helpline call, recording: https://rec.exotel.com/x.mp3, keyed: 2");
  assert.equal(store.inbound[0].provider, "exotel");
  assert.equal(store.inbound[0].external_id, "abc123");
});

test("exotel GET with query parameters and ?token works; duplicate CallSid adds the recording only", async () => {
  const store = fakeStore();
  let res = mockRes();
  await exotel({ method: "GET", headers: {}, query: { token: "tok", CallSid: "c9", From: "+919899375445", CallStatus: "in-progress" } }, res, { env: { EXOTEL_WEBHOOK_TOKEN: "tok" }, store });
  assert.equal(res.statusCode, 200);
  const ref = res.json().ref;
  assert.equal(store.reports[0].description, "Helpline call");
  res = mockRes();
  await exotel({ method: "POST", headers: {}, query: { token: "tok" }, body: { CallSid: "c9", From: "+919899375445", CallStatus: "completed", RecordingUrl: "https://rec/x.mp3" } }, res, { env: { EXOTEL_WEBHOOK_TOKEN: "tok" }, store });
  assert.deepEqual(res.json(), { ok: true, ref, duplicate: true });
  assert.equal(store.reports.length, 1);
  assert.equal(store.reports[0].description, "Helpline call, recording: https://rec/x.mp3");
});

test("exotel missing or wrong token is 401; bad phone is 400", async () => {
  const store = fakeStore();
  let res = mockRes();
  await exotel({ method: "POST", headers: {}, query: {}, body: "CallSid=1&From=9899375445" }, res, { env: { EXOTEL_WEBHOOK_TOKEN: "tok" }, store });
  assert.equal(res.statusCode, 401);
  res = mockRes();
  await exotel({ method: "POST", headers: {}, query: { token: "wrong" }, body: "CallSid=1&From=9899375445" }, res, { env: { EXOTEL_WEBHOOK_TOKEN: "tok" }, store });
  assert.equal(res.statusCode, 401);
  res = mockRes();
  await exotel({ method: "POST", headers: {}, query: { token: "tok" }, body: "CallSid=1&From=01244567890" }, res, { env: { EXOTEL_WEBHOOK_TOKEN: "tok" }, store });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "bad_phone");
  assert.equal(store.reports.length, 0);
  assert.deepEqual(params({ query: { A: "1" }, body: "b=2&C=3" }), { a: "1", b: "2", c: "3" });
  assert.equal(describeCall({}), "Helpline call");
});
