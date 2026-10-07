import { test } from "node:test";
import assert from "node:assert/strict";
import { REF_RE, publicFields, handle as handleReport } from "../../lib/handlers/public-report.js";
import { publicPin, parseLimit, handle as handleReports } from "../../lib/handlers/public-reports.js";

// Minimal res double in the shape Vercel gives us.
function fakeRes() {
  const r = { statusCode: null, headers: {}, body: null };
  r.status = (s) => { r.statusCode = s; return r; };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; return r; };
  r.end = (b) => { r.body = b ? JSON.parse(b) : null; return r; };
  return r;
}

const fakeSb = (result) => ({ rpc: async () => result });

const PRIVATE = {
  reporter_name: "A Person", reporter_phone: "+919999999999", reporter_email: "a@b.co",
  description: "free text", spot: "house 12, lane 3", official_ticket: "MCG/123",
  extra: { plot: "x" }, attachments: [{ path: "p" }], ip_hash: "h", user_agent: "ua", id: "uuid"
};

test("ref validation", () => {
  assert.ok(REF_RE.test("GVF-2026-ABCDE"));
  assert.ok(REF_RE.test("GVF-2026-23456"));
  assert.ok(!REF_RE.test("GVF-2026-ABCD"));
  assert.ok(!REF_RE.test("GVF-2026-ABCD1"));   // 0 and 1 are not in the alphabet
  assert.ok(!REF_RE.test("GVF-26-ABCDE"));
  assert.ok(!REF_RE.test("gvf-2026-abcde"));   // handler uppercases before testing
  assert.ok(!REF_RE.test(""));
});

test("publicFields drops every reporter and filing field", () => {
  const row = {
    ref: "GVF-2026-ABCDE", issue_type: "waste", issue_label: "Waste", area: "Sector 29", ward: 30,
    stage: 2, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z",
    official_filed_at: null, resolved_at: null, desk: "MCG sanitation", official_channel: "SBM",
    lat: 28.46, lng: 77.07, source: "web",
    events: [{ stage: 0, created_at: "2026-10-01T00:00:00Z", note: "secret note", actor: "volunteer x" }],
    followers: 3,
    ...PRIVATE
  };
  const out = publicFields(row);
  for (const k of Object.keys(PRIVATE)) assert.ok(!(k in out), k + " must not be public");
  assert.equal(out.ref, "GVF-2026-ABCDE");
  assert.equal(out.followers, 3);
  assert.deepEqual(out.events, [{ stage: 0, created_at: "2026-10-01T00:00:00Z" }]);
  assert.equal(publicFields(null), null);
});

test("publicPin keeps only the seven pin fields", () => {
  const out = publicPin({ ref: "GVF-2026-ABCDE", issue_type: "waste", stage: 1, ward: 30, lat: 28.46, lng: 77.07,
    created_at: "2026-10-01T00:00:00Z", issue_label: "Waste", area: "Sector 29", desk: "x", ...PRIVATE });
  assert.deepEqual(Object.keys(out).sort(), ["created_at", "issue_type", "lat", "lng", "ref", "stage", "ward"]);
});

test("parseLimit clamps to 1..1000 and defaults to 500", () => {
  assert.equal(parseLimit(undefined), 500);
  assert.equal(parseLimit("abc"), 500);
  assert.equal(parseLimit("0"), 1);
  assert.equal(parseLimit("50000"), 1000);
  assert.equal(parseLimit("42"), 42);
});

test("public report: bad ref is 400, unknown ref is 404, no cache header on errors", async () => {
  let res = fakeRes();
  await handleReport({ method: "GET", query: { ref: "nope" } }, res, fakeSb({ data: null, error: null }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "bad_ref");

  res = fakeRes();
  await handleReport({ method: "GET", query: { ref: " gvf-2026-abcde " } }, res, fakeSb({ data: null, error: null }));
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "not_found");
  assert.equal(res.headers["cache-control"], undefined);

  res = fakeRes();
  await handleReport({ method: "POST", query: {} }, res, fakeSb({ data: null, error: null }));
  assert.equal(res.statusCode, 405);
});

test("public report: found row is 200 with cache header and allowlisted fields", async () => {
  const res = fakeRes();
  const data = { ref: "GVF-2026-ABCDE", stage: 1, events: [], followers: 0, ...PRIVATE };
  await handleReport({ method: "GET", query: { ref: "GVF-2026-ABCDE" } }, res, fakeSb({ data, error: null }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["cache-control"], "public, max-age=60");
  assert.ok(res.body.ok);
  assert.equal(res.body.report.ref, "GVF-2026-ABCDE");
  assert.ok(!("reporter_phone" in res.body.report));
  assert.ok(!("official_ticket" in res.body.report));
});

test("public report: database error is 500 server_error", async () => {
  const res = fakeRes();
  const quiet = console.error; console.error = () => {};
  try {
    await handleReport({ method: "GET", query: { ref: "GVF-2026-ABCDE" } }, res, fakeSb({ data: null, error: { message: "boom" } }));
  } finally { console.error = quiet; }
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, "server_error");
});

test("public reports: 200 with cache header, allowlisted pins and counts", async () => {
  const res = fakeRes();
  const data = {
    reports: [{ ref: "GVF-2026-ABCDE", issue_type: "waste", stage: 0, ward: 30, lat: 28.46, lng: 77.07,
                created_at: "2026-10-01T00:00:00Z", ...PRIVATE }],
    counts: { total: 7, with_location: 1 },
    computed_at: "2026-10-07T00:00:00Z"
  };
  await handleReports({ method: "GET", query: { limit: "10" } }, res, fakeSb({ data, error: null }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["cache-control"], "public, max-age=300");
  assert.deepEqual(res.body.counts, { total: 7, with_location: 1 });
  assert.equal(res.body.computed_at, "2026-10-07T00:00:00Z");
  assert.deepEqual(Object.keys(res.body.reports[0]).sort(), ["created_at", "issue_type", "lat", "lng", "ref", "stage", "ward"]);

  const nope = fakeRes();
  await handleReports({ method: "DELETE", query: {} }, nope, fakeSb({ data: null, error: null }));
  assert.equal(nope.statusCode, 405);
});
