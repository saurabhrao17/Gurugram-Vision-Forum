import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { makeHandler, svixOk, normaliseInbound } from "../../lib/handlers/hooks/email.js";

function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: null };
  res.status = (s) => { res.statusCode = s; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; return res; };
  res.end = (b) => { try { res.body = JSON.parse(b); } catch { res.body = b; } };
  return res;
}
function fakeSb() {
  const rows = [];
  return { rows, from: () => ({ upsert: (row, opts) => { rows.push({ row, opts }); return { select: async () => ({ data: [{ id: "x" }], error: null }) }; } }) };
}

test("normaliseInbound reads name <email>, text or html, and caps the body", () => {
  const m = normaliseInbound({ id: "em_1", from: '"Asha Verma" <asha@example.org>', subject: "Pothole on Sohna Road", text: "Please help", created_at: "2026-10-08T01:00:00Z" });
  assert.deepEqual(m, { source: "email", external_id: "em_1", from_email: "asha@example.org", from_name: "Asha Verma", subject: "Pothole on Sohna Road", body_text: "Please help", received_at: "2026-10-08T01:00:00.000Z" });
  const h = normaliseInbound({ from: "r@example.org", subject: "", html: "<p>Hello <b>there</b></p>" });
  assert.equal(h.subject, "(no subject)");
  assert.equal(h.body_text, "Hello there");
  assert.equal(normaliseInbound({ from: "a@b.c", text: "x".repeat(30000) }).body_text.length, 20000);
});

test("forwarder path: token required, stores the mail, dedupes by a derived id", async () => {
  const sb = fakeSb();
  const h = makeHandler({ env: { EMAIL_HOOK_TOKEN: "tok" }, sb });
  const denied = fakeRes();
  await h({ method: "POST", headers: {}, query: {}, body: { from: "a@b.c", subject: "s", text: "t" } }, denied);
  assert.equal(denied.statusCode, 401);
  const res = fakeRes();
  await h({ method: "POST", headers: { "x-webhook-token": "tok" }, query: {}, body: { from: "Resident <a@b.c>", subject: "Garbage", text: "Not lifted" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(sb.rows.length, 1);
  assert.equal(sb.rows[0].row.from_email, "a@b.c");
  assert.ok(sb.rows[0].row.external_id.startsWith("fwd:"));
  assert.deepEqual(sb.rows[0].opts, { onConflict: "external_id", ignoreDuplicates: true });
  const empty = fakeRes();
  await h({ method: "POST", headers: {}, query: { token: "tok" }, body: {} }, empty);
  assert.equal(empty.statusCode, 400);
});

test("Resend path: Svix signature checked, body fetched from the receiving API", async () => {
  const secret = "whsec_" + Buffer.from("supersecretkey").toString("base64");
  const payload = { type: "email.received", data: { email_id: "em_42", from: "r@example.org", subject: "Streetlight", created_at: "2026-10-08T01:00:00Z" } };
  const raw = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = "v1," + createHmac("sha256", Buffer.from("supersecretkey")).update(`msg_1.${ts}.${raw}`).digest("base64");
  assert.ok(svixOk(secret, { "svix-id": "msg_1", "svix-timestamp": ts, "svix-signature": sig }, raw));
  assert.ok(!svixOk(secret, { "svix-id": "msg_1", "svix-timestamp": ts, "svix-signature": "v1,bad" }, raw));
  assert.ok(!svixOk(secret, { "svix-id": "msg_1", "svix-timestamp": "1", "svix-signature": sig }, raw), "stale timestamp");
  const sb = fakeSb();
  const fetched = [];
  const fetchImpl = async (url, init) => { fetched.push([url, init.headers.Authorization]); return { ok: true, json: async () => ({ text: "Pole 12 is dark", from: '"Ravi" <r@example.org>' }) }; };
  const h = makeHandler({ env: { RESEND_WEBHOOK_SECRET: secret, RESEND_API_KEY: "re_key" }, fetchImpl, sb });
  const res = fakeRes();
  await h({ method: "POST", headers: { "svix-id": "msg_1", "svix-timestamp": ts, "svix-signature": sig }, query: {}, body: raw }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(fetched, [["https://api.resend.com/emails/receiving/em_42", "Bearer re_key"]]);
  assert.equal(sb.rows[0].row.external_id, "em_42");
  assert.equal(sb.rows[0].row.body_text, "Pole 12 is dark");
  assert.equal(sb.rows[0].row.from_name, "Ravi");
  const bad = fakeRes();
  await h({ method: "POST", headers: { "svix-id": "msg_2", "svix-timestamp": ts, "svix-signature": "v1,nope" }, query: {}, body: raw }, bad);
  assert.equal(bad.statusCode, 401);
});
