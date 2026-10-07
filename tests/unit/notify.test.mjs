import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import cron, { runDaily, sendMail, slaDigestMail } from "../../lib/handlers/cron.js";

// ---------------------------------------------------------------------------
// Fakes: a Vercel-style response and a Supabase client that records every
// terminal query (select / insert / update / delete / upsert) and rpc call.
// ---------------------------------------------------------------------------
function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: "" };
  res.status = (s) => { res.statusCode = s; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; return res; };
  res.end = (b) => { res.body = b || ""; };
  res.json = () => JSON.parse(res.body);
  return res;
}

function fakeSb({ rpc = {}, tables = {}, objects = {}, counts = {} } = {}) {
  const calls = { rpc: [], queries: [], removed: [], listed: [] };
  const from = (table) => {
    const q = { table, op: "select", row: null, filters: [], opts: null };
    const chain = {
      select(cols, opts) { if (q.op === "select") q.opts = opts || null; return chain; },
      insert(row) { q.op = "insert"; q.row = row; return chain; },
      upsert(row, opts) { q.op = "upsert"; q.row = row; q.opts = opts; return chain; },
      update(row) { q.op = "update"; q.row = row; return chain; },
      delete() { q.op = "delete"; return chain; },
      eq(k, v) { q.filters.push(["eq", k, v]); return chain; },
      lt(k, v) { q.filters.push(["lt", k, v]); return chain; },
      order() { return chain; },
      limit(n) { q.limit = n; return chain; },
      maybeSingle() { q.single = true; return chain; },
      then(resolve, reject) {
        calls.queries.push(q);
        let data = null;
        if (q.op === "select") {
          const rows = typeof tables[table] === "function" ? tables[table](q) : (tables[table] || []);
          data = q.single ? (rows[0] || null) : rows;
        }
        const out = { data, error: null };
        if (q.opts?.head) out.count = counts[table] ?? 0;
        return Promise.resolve(out).then(resolve, reject);
      }
    };
    return chain;
  };
  return {
    calls,
    from,
    rpc: async (name, args) => { calls.rpc.push([name, args]); const v = rpc[name]; return typeof v === "function" ? v(args) : { data: v ?? null, error: null }; },
    storage: {
      from: () => ({
        list: async (prefix) => { calls.listed.push(prefix); return { data: objects[prefix] || [], error: null }; },
        remove: async (paths) => { calls.removed.push(paths); return { data: paths, error: null }; }
      })
    }
  };
}

const realFetch = globalThis.fetch;
const savedEnv = {};
beforeEach(() => { for (const k of ["CRON_SECRET", "COORDINATOR_EMAIL", "RESEND_API_KEY", "MAIL_FROM"]) { savedEnv[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of Object.keys(savedEnv)) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});

const emptyDigest = { unmapped: [], filed_overdue: [] };
const emptySweep = { deleted: 0, refs: [] };

// ---------------------------------------------------------------------------
// Cron: authentication
// ---------------------------------------------------------------------------
test("cron rejects when CRON_SECRET is not configured", async () => {
  const res = fakeRes();
  await cron({ method: "GET", headers: { authorization: "Bearer anything" } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error, "unauthenticated");
});

test("cron rejects a wrong or missing bearer", async () => {
  process.env.CRON_SECRET = "s3cret-value";
  let res = fakeRes();
  await cron({ method: "GET", headers: { authorization: "Bearer wrong" } }, res);
  assert.equal(res.statusCode, 401);
  res = fakeRes();
  await cron({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 401);
  res = fakeRes();
  await cron({ method: "GET", headers: { authorization: "Bearer s3cret-valu" } }, res);
  assert.equal(res.statusCode, 401);
});

test("cron only answers GET", async () => {
  process.env.CRON_SECRET = "x";
  const res = fakeRes();
  await cron({ method: "POST", headers: { authorization: "Bearer x" } }, res);
  assert.equal(res.statusCode, 405);
});

// ---------------------------------------------------------------------------
// Cron: SLA digest
// ---------------------------------------------------------------------------
const digest = {
  unmapped: [
    { ref: "GVF-2026-ABCDE", issue_type: "waste", area: "Sector 29", ward: 30, created_at: "2026-09-28T04:00:00Z", days: 7, reporter_phone: "+919899375445", reporter_name: "Leaky Name" }
  ],
  filed_overdue: [
    { ref: "GVF-2026-FGHJK", issue_type: "roads", area: "DLF Phase 3", ward: 24, official_ticket: "MCG-12345", official_filed_at: "2026-08-01T04:00:00Z", days: 67 },
    { ref: "GVF-2026-LMNPQ", issue_type: "water", area: "Sector 56", ward: null, official_ticket: null, official_filed_at: "2026-09-01T04:00:00Z", days: 36 }
  ]
};

test("slaDigestMail lists every overdue reference with a desk link and no reporter details", () => {
  const m = slaDigestMail(digest, "coord@example.org");
  assert.equal(m.to_email, "coord@example.org");
  assert.equal(m.kind, "sla");
  assert.match(m.subject, /1 report unmapped, 2 filed past 21 days/);
  for (const ref of ["GVF-2026-ABCDE", "GVF-2026-FGHJK", "GVF-2026-LMNPQ"]) {
    assert.ok(m.body_text.includes(ref), ref);
    assert.ok(m.body_text.includes(`https://gurugramvisionforum.org/#/desk/${ref}`), "desk link " + ref);
  }
  assert.ok(m.body_text.includes("MCG-12345"));
  assert.ok(m.body_text.includes("7 working days"));
  assert.ok(m.body_text.includes("ward 30"));
  assert.doesNotMatch(m.body_text, /\+91\d{10}|\b[6-9]\d{9}\b/, "no phone numbers");
  assert.ok(!m.body_text.includes("Leaky Name"));
});

test("runDaily enqueues the digest only when something is overdue and a coordinator is set", async () => {
  let sb = fakeSb({ rpc: { sla_digest: digest, retention_sweep: emptySweep } });
  let r = await runDaily(sb, { COORDINATOR_EMAIL: "coord@example.org" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.sla, { unmapped: 1, filed_overdue: 2, digest_sent: true });
  const ins = sb.calls.queries.find((q) => q.table === "outbox" && q.op === "insert");
  assert.ok(ins, "outbox insert");
  assert.equal(ins.row.kind, "sla");
  assert.equal(ins.row.to_email, "coord@example.org");
  assert.ok(ins.row.body_text.includes("#/desk/GVF-2026-FGHJK"));

  sb = fakeSb({ rpc: { sla_digest: digest, retention_sweep: emptySweep } });
  r = await runDaily(sb, {});
  assert.equal(r.sla.digest_sent, false);
  assert.ok(!sb.calls.queries.some((q) => q.table === "outbox" && q.op === "insert"));

  sb = fakeSb({ rpc: { sla_digest: emptyDigest, retention_sweep: emptySweep } });
  r = await runDaily(sb, { COORDINATOR_EMAIL: "coord@example.org" });
  assert.deepEqual(r.sla, { unmapped: 0, filed_overdue: 0, digest_sent: false });
  assert.ok(!sb.calls.queries.some((q) => q.table === "outbox" && q.op === "insert"));
});

// ---------------------------------------------------------------------------
// Cron: outbox sender
// ---------------------------------------------------------------------------
const pending = [
  { id: 1, to_email: "a@example.org", subject: "Report GVF-2026-ABCDE: Filed officially", body_text: "hello", body_html: null, attempts: 0 },
  { id: 2, to_email: "b@example.org", subject: "Report GVF-2026-ABCDE: Filed officially", body_text: "hello", body_html: "<p>hello</p>", attempts: 4 }
];

test("runDaily leaves the outbox pending without RESEND_API_KEY", async () => {
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; return { ok: true, json: async () => ({}) }; };
  const sb = fakeSb({ rpc: { sla_digest: emptyDigest, retention_sweep: emptySweep }, tables: { outbox: pending } });
  const r = await runDaily(sb, {});
  assert.deepEqual(r.outbox, { sent: 0, failed: 0, skipped: 2 });
  assert.equal(fetched, 0);
  assert.ok(!sb.calls.queries.some((q) => q.table === "outbox" && q.op === "update"));
  const sel = sb.calls.queries.find((q) => q.table === "outbox" && q.op === "select");
  assert.deepEqual(sel.filters, [["eq", "status", "pending"], ["lt", "attempts", 5]]);
  assert.equal(sel.limit, 50);
});

test("sendMail posts to Resend with the key, the sender and the html when present", async () => {
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url, init }); return { ok: true, json: async () => ({ id: "em_1" }) }; };
  const out = await sendMail(pending[1], { RESEND_API_KEY: "re_test", MAIL_FROM: "Forum <hello@gurugramvisionforum.org>" });
  assert.deepEqual(out, { id: "em_1" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://api.resend.com/emails");
  assert.equal(seen[0].init.method, "POST");
  assert.equal(seen[0].init.headers.Authorization, "Bearer re_test");
  const body = JSON.parse(seen[0].init.body);
  assert.deepEqual(body, { from: "Forum <hello@gurugramvisionforum.org>", to: ["b@example.org"], subject: pending[1].subject, text: "hello", html: "<p>hello</p>" });

  seen.length = 0;
  await sendMail(pending[0], { RESEND_API_KEY: "re_test" });
  const b2 = JSON.parse(seen[0].init.body);
  assert.equal(b2.from, "Gurugram Vision Forum <noreply@gurugramvisionforum.org>");
  assert.ok(!("html" in b2));
});

test("runDaily marks rows sent, retries failures and gives up at five attempts", async () => {
  globalThis.fetch = async (url, init) => {
    const to = JSON.parse(init.body).to[0];
    if (to === "a@example.org") return { ok: true, json: async () => ({ id: "em_a" }) };
    return { ok: false, status: 422, text: async () => "invalid recipient" };
  };
  const sb = fakeSb({ rpc: { sla_digest: emptyDigest, retention_sweep: emptySweep }, tables: { outbox: pending } });
  const r = await runDaily(sb, { RESEND_API_KEY: "re_test" });
  assert.deepEqual(r.outbox, { sent: 1, failed: 1, skipped: 0 });
  const updates = sb.calls.queries.filter((q) => q.table === "outbox" && q.op === "update");
  assert.equal(updates.length, 2);
  const u1 = updates.find((q) => q.filters[0][2] === 1).row;
  assert.equal(u1.status, "sent");
  assert.ok(u1.sent_at);
  assert.equal(u1.last_error, null);
  const u2 = updates.find((q) => q.filters[0][2] === 2).row;
  assert.equal(u2.status, "failed");
  assert.equal(u2.attempts, 5);
  assert.match(u2.last_error, /resend 422: invalid recipient/);
});

test("runDaily keeps a failed row pending while attempts remain", async () => {
  globalThis.fetch = async () => { throw new Error("network down"); };
  const sb = fakeSb({ rpc: { sla_digest: emptyDigest, retention_sweep: emptySweep }, tables: { outbox: [pending[0]] } });
  const r = await runDaily(sb, { RESEND_API_KEY: "re_test" });
  assert.deepEqual(r.outbox, { sent: 0, failed: 1, skipped: 0 });
  const u = sb.calls.queries.find((q) => q.table === "outbox" && q.op === "update").row;
  assert.equal(u.status, "pending");
  assert.equal(u.attempts, 1);
  assert.equal(u.last_error, "network down");
});

// ---------------------------------------------------------------------------
// Cron: retention
// ---------------------------------------------------------------------------
test("runDaily removes storage objects for every swept reference and tolerates storage errors", async () => {
  const sb = fakeSb({
    rpc: { sla_digest: emptyDigest, retention_sweep: { deleted: 2, refs: ["GVF-2024-AAAAA", "GVF-2024-BBBBB"] } },
    objects: { "GVF-2024-AAAAA": [{ name: "photo-1.jpg" }, { name: "bill.pdf" }] }
  });
  sb.storage.from = (() => {
    const real = sb.storage.from();
    return () => ({ list: async (p) => (p === "GVF-2024-BBBBB" ? { data: null, error: { message: "boom" } } : real.list(p)), remove: real.remove });
  })();
  const r = await runDaily(sb, {});
  assert.equal(r.ok, true);
  assert.deepEqual(r.retention, { deleted: 2 });
  assert.deepEqual(sb.calls.removed, [["GVF-2024-AAAAA/photo-1.jpg", "GVF-2024-AAAAA/bill.pdf"]]);
});

test("runDaily isolates a failing step and reports it", async () => {
  const sb = fakeSb({ rpc: { sla_digest: () => ({ data: null, error: { message: "function missing" } }), retention_sweep: emptySweep } });
  const r = await runDaily(sb, {});
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, ["sla: sla_digest: function missing"]);
  assert.deepEqual(r.retention, { deleted: 0 });
  assert.deepEqual(r.outbox, { sent: 0, failed: 0, skipped: 0 });
});

// ---------------------------------------------------------------------------
// Follow
// ---------------------------------------------------------------------------
