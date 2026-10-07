import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import visitor, { validateVisitor, validateEvent, EVENTS } from "../../lib/handlers/visitor.js";
import news, { clampLimit } from "../../lib/handlers/news.js";
import health, { healthChecks } from "../../lib/handlers/health.js";
import { csvCell, toCsv, clampDays } from "../../lib/handlers/triage/visitors.js";
import { parseRss, parseHtmlLinks, scopeHtml, fetchSources, loadSourcesFile, USER_AGENT } from "../../lib/news-fetch.js";
import { collectFrom, collectLinks, checkLinks, checkLink } from "../../lib/link-check.js";
import { runDaily, slaDigestMail } from "../../lib/handlers/cron.js";

// ---------------------------------------------------------------------------
// Fakes: a Vercel-style response and a Supabase client that records every
// terminal query and rpc call. Tables can be arrays or functions of the query.
// ---------------------------------------------------------------------------
function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: "" };
  res.status = (s) => { res.statusCode = s; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; return res; };
  res.end = (b) => { res.body = b || ""; };
  res.json = () => JSON.parse(res.body);
  return res;
}

function fakeSb({ rpc = {}, tables = {}, counts = {}, errors = {}, storageOk = true } = {}) {
  const calls = { rpc: [], queries: [] };
  const from = (table) => {
    const q = { table, op: "select", row: null, filters: [], opts: null, cols: null };
    const chain = {
      select(cols, opts) { if (q.op === "select") { q.cols = cols; q.opts = opts || null; } else q.returning = cols; return chain; },
      insert(row) { q.op = "insert"; q.row = row; return chain; },
      upsert(row, opts) { q.op = "upsert"; q.row = row; q.opts = opts; return chain; },
      update(row) { q.op = "update"; q.row = row; return chain; },
      delete() { q.op = "delete"; return chain; },
      eq(k, v) { q.filters.push(["eq", k, v]); return chain; },
      lt(k, v) { q.filters.push(["lt", k, v]); return chain; },
      not(k, op, v) { q.filters.push(["not", k, op, v]); return chain; },
      order(k, o) { q.order = [k, o]; return chain; },
      limit(n) { q.limit = n; return chain; },
      range(a, b) { q.range = [a, b]; return chain; },
      maybeSingle() { q.single = true; return chain; },
      then(resolve, reject) {
        calls.queries.push(q);
        if (errors[table]) return Promise.resolve({ data: null, error: { message: errors[table] } }).then(resolve, reject);
        let data = null;
        if (q.op === "select") {
          const rows = typeof tables[table] === "function" ? tables[table](q) : (tables[table] || []);
          data = q.single ? (rows[0] || null) : rows;
        } else if (q.op === "upsert" && q.returning) {
          data = Array.isArray(q.row) ? q.row.map((r, i) => ({ id: i + 1 })) : [{ id: 1 }];
        } else if (q.op === "insert" && q.returning) {
          data = q.single ? { id: 7 } : [{ id: 7 }];
        }
        const out = { data, error: null };
        if (q.opts?.head) { const c = counts[table]; out.count = typeof c === "function" ? c(q) : (c ?? 0); }
        else if (q.opts?.count) out.count = Array.isArray(data) ? data.length : 0;
        return Promise.resolve(out).then(resolve, reject);
      }
    };
    return chain;
  };
  return {
    calls,
    from,
    rpc: async (name, args) => { calls.rpc.push([name, args]); const v = rpc[name]; return typeof v === "function" ? v(args) : { data: v ?? null, error: null }; },
    storage: { from: () => ({ list: async () => (storageOk ? { data: [], error: null } : { data: null, error: { message: "nope" } }) }) }
  };
}

const savedEnv = {};
beforeEach(() => { for (const k of ["TURNSTILE_SECRET", "VERCEL_GIT_COMMIT_SHA", "COORDINATOR_EMAIL"]) { savedEnv[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of Object.keys(savedEnv)) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; } });

const TOKEN = "abcDEF123_-abcDEF123_-xyz";
const goodVisitor = { token: TOKEN, name: "Asha Verma", phone: "98993 75445", email: "Asha@Example.org", area: "Sector 29", pincode: "122001", city: "", consent: true, notice_version: "2026-10", first_page: "/report", referrer: "https://google.com/" };

// ---------------------------------------------------------------------------
// validateVisitor / validateEvent
// ---------------------------------------------------------------------------
test("validateVisitor accepts a good record and normalises it", () => {
  const { errors, out } = validateVisitor(goodVisitor);
  assert.deepEqual(errors, []);
  assert.equal(out.token, TOKEN);
  assert.equal(out.phone, "+919899375445");
  assert.equal(out.email, "asha@example.org");
  assert.equal(out.pincode, "122001");
  assert.equal(out.city, "Gurugram");
  assert.equal(out.area, "Sector 29");
  assert.equal(out.notice_version, "2026-10");
});

test("validateVisitor rejects missing consent, a bad pincode and a bad phone", () => {
  assert.deepEqual(validateVisitor({ ...goodVisitor, consent: "yes" }).errors, ["consent"]);
  assert.deepEqual(validateVisitor({ ...goodVisitor, consent: false }).errors, ["consent"]);
  assert.deepEqual(validateVisitor({ ...goodVisitor, pincode: "012345" }).errors, ["pincode"]);
  assert.deepEqual(validateVisitor({ ...goodVisitor, pincode: "12345" }).errors, ["pincode"]);
  assert.deepEqual(validateVisitor({ ...goodVisitor, phone: "0124 4567890" }).errors, ["phone"]);
  assert.deepEqual(validateVisitor({ ...goodVisitor, pincode: "" }).errors, []);
  assert.equal(validateVisitor({ ...goodVisitor, pincode: "" }).out.pincode, null);
});

test("validateVisitor checks the token, name length and email", () => {
  assert.deepEqual(validateVisitor({ ...goodVisitor, token: "short" }).errors, ["token"]);
  assert.deepEqual(validateVisitor({ ...goodVisitor, token: "has spaces in it which is not allowed" }).errors, ["token"]);
  assert.deepEqual(validateVisitor({ ...goodVisitor, name: "A" }).errors, ["name"]);
  assert.deepEqual(validateVisitor({ ...goodVisitor, email: "nope" }).errors, ["email"]);
  assert.deepEqual(validateVisitor(null).errors, ["token", "name", "phone", "email", "consent"]);
});

test("validateEvent enforces the allowlist, token shape and meta size", () => {
  assert.deepEqual(EVENTS, ["page_view", "report_start", "report_step", "report_submit", "follow", "join", "gate_shown", "gate_done", "gate_skipped", "search", "outbound_click"]);
  for (const e of EVENTS) assert.deepEqual(validateEvent({ event: e }).errors, [], e);
  assert.deepEqual(validateEvent({ event: "login" }).errors, ["event"]);
  assert.deepEqual(validateEvent({ event: "" }).errors, ["event"]);
  assert.deepEqual(validateEvent({ event: "page_view", token: "bad token!" }).errors, ["token"]);
  const ok = validateEvent({ event: "page_view", token: TOKEN, path: "/report", meta: { step: 2 } });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.out, { visitor_token: TOKEN, event: "page_view", path: "/report", meta: { step: 2 } });
  assert.equal(validateEvent({ event: "page_view" }).out.visitor_token, null);
  assert.deepEqual(validateEvent({ event: "search", meta: { q: "x".repeat(1100) } }).errors, ["meta"]);
  assert.deepEqual(validateEvent({ event: "search", meta: [1, 2] }).errors, ["meta"]);
});

// ---------------------------------------------------------------------------
// /api/visitor handler
// ---------------------------------------------------------------------------
test("visitor POST registers a new token with ip hash and visits 1", async () => {
  const sb = fakeSb({ rpc: { visitors_from_ip_last_hour: 0 }, tables: { visitors: [] } });
  const res = fakeRes();
  await visitor({ method: "POST", headers: { "user-agent": "UA/1", "x-forwarded-for": "1.2.3.4" }, body: goodVisitor }, res, sb);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
  const up = sb.calls.queries.find((q) => q.table === "visitors" && q.op === "upsert");
  assert.ok(up, "upsert");
  assert.deepEqual(up.opts, { onConflict: "token" });
  assert.equal(up.row.token, TOKEN);
  assert.equal(up.row.phone, "+919899375445");
  assert.equal(up.row.visits, 1);
  assert.equal(up.row.user_agent, "UA/1");
  assert.match(up.row.ip_hash, /^[0-9a-f]{32}$/);
  assert.ok(up.row.consent_at);
  assert.equal(up.row.first_page, "/report");
});

test("visitor POST bumps visits and refreshes the profile for a known token", async () => {
  const sb = fakeSb({ rpc: { visitors_from_ip_last_hour: 2 }, tables: { visitors: [{ id: "v1", visits: 4 }] } });
  const res = fakeRes();
  await visitor({ method: "POST", headers: {}, body: { ...goodVisitor, area: "DLF Phase 3" } }, res, sb);
  assert.equal(res.statusCode, 200);
  const up = sb.calls.queries.find((q) => q.table === "visitors" && q.op === "update");
  assert.ok(up, "update");
  assert.deepEqual(up.filters, [["eq", "id", "v1"]]);
  assert.equal(up.row.visits, 5);
  assert.equal(up.row.area, "DLF Phase 3");
  assert.ok(up.row.last_seen_at);
  assert.ok(!("consent_at" in up.row), "consent date is kept from the first registration");
  assert.ok(!sb.calls.queries.some((q) => q.op === "upsert"));
});

test("visitor POST answers 400, 429 and 405", async () => {
  let res = fakeRes();
  await visitor({ method: "POST", headers: {}, body: { ...goodVisitor, consent: false } }, res, fakeSb());
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.json().fields, ["consent"]);

  res = fakeRes();
  const sb = fakeSb({ rpc: { visitors_from_ip_last_hour: 30 } });
  await visitor({ method: "POST", headers: {}, body: goodVisitor }, res, sb);
  assert.equal(res.statusCode, 429);
  assert.equal(res.json().error, "too_many");
  assert.ok(!sb.calls.queries.some((q) => q.table === "visitors"));

  res = fakeRes();
  await visitor({ method: "POST", headers: {}, body: "{bad" }, res, fakeSb());
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "bad_json");

  res = fakeRes();
  await visitor({ method: "GET", headers: {} }, res, fakeSb());
  assert.equal(res.statusCode, 405);
});

test("visitor POST with an event records a visitor_event, with or without a token", async () => {
  let sb = fakeSb();
  let res = fakeRes();
  await visitor({ method: "POST", headers: {}, body: { token: TOKEN, event: "report_step", path: "/report", meta: { step: 3 } } }, res, sb);
  assert.equal(res.statusCode, 200);
  let ins = sb.calls.queries.find((q) => q.table === "visitor_events" && q.op === "insert");
  assert.ok(ins);
  assert.equal(ins.row.visitor_token, TOKEN);
  assert.equal(ins.row.event, "report_step");
  assert.deepEqual(ins.row.meta, { step: 3 });
  assert.ok(ins.row.ip_hash);
  assert.ok(!sb.calls.rpc.length, "no rate-limit rpc for events");

  sb = fakeSb();
  res = fakeRes();
  await visitor({ method: "POST", headers: {}, body: { event: "page_view", path: "/" } }, res, sb);
  assert.equal(res.statusCode, 200);
  ins = sb.calls.queries.find((q) => q.table === "visitor_events" && q.op === "insert");
  assert.equal(ins.row.visitor_token, null);

  res = fakeRes();
  await visitor({ method: "POST", headers: {}, body: { event: "hack" } }, res, fakeSb());
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.json().fields, ["event"]);
});

// ---------------------------------------------------------------------------
// /api/news
// ---------------------------------------------------------------------------
test("news GET returns items newest first with source names and a ten-minute cache", async () => {
  const sources = [
    { id: "mcg", name: "MCG notices", home: "https://www.mcg.gov.in/", enabled: true, last_fetched_at: "2026-10-07T03:30:00Z", last_status: "ok" },
    { id: "gmda", name: "GMDA", home: null, enabled: true, last_fetched_at: null, last_status: null }
  ];
  const items = [
    { source_id: "mcg", title: "Old", url: "https://www.mcg.gov.in/a", published_at: "2026-09-01T00:00:00Z", fetched_at: "2026-10-07T03:30:00Z" },
    { source_id: "gmda", title: "Undated", url: "https://www.gmda.gov.in/b", published_at: null, fetched_at: "2026-10-06T03:30:00Z" },
    { source_id: "mcg", title: "New", url: "https://www.mcg.gov.in/c", published_at: "2026-10-07T01:00:00Z", fetched_at: "2026-10-07T03:30:00Z" },
    { source_id: "gone", title: "Disabled source", url: "https://x/", published_at: "2026-10-07T02:00:00Z", fetched_at: "2026-10-07T03:30:00Z" }
  ];
  const sb = fakeSb({ tables: { news_sources: sources, news_items: items } });
  const res = fakeRes();
  await news({ method: "GET", headers: {}, query: { limit: "2" } }, res, sb);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Cache-Control"], "public, max-age=600");
  const j = res.json();
  assert.equal(j.ok, true);
  assert.deepEqual(j.items.map((i) => i.title), ["New", "Undated"]);
  assert.deepEqual(j.items[0], { title: "New", url: "https://www.mcg.gov.in/c", published_at: "2026-10-07T01:00:00Z", fetched_at: "2026-10-07T03:30:00Z", source_id: "mcg", source_name: "MCG notices", home: "https://www.mcg.gov.in/" });
  assert.deepEqual(j.sources, [
    { id: "mcg", name: "MCG notices", home: "https://www.mcg.gov.in/", last_fetched_at: "2026-10-07T03:30:00Z", last_status: "ok" },
    { id: "gmda", name: "GMDA", home: null, last_fetched_at: null, last_status: null }
  ]);
  const sel = sb.calls.queries.find((q) => q.table === "news_sources");
  assert.deepEqual(sel.filters, [["eq", "enabled", true]]);
});

test("news limit is clamped to 1..200 with 60 as default", () => {
  assert.equal(clampLimit(undefined), 60);
  assert.equal(clampLimit("0"), 1);
  assert.equal(clampLimit("999"), 200);
  assert.equal(clampLimit("25"), 25);
});

// ---------------------------------------------------------------------------
// /api/health
// ---------------------------------------------------------------------------
const healthyTables = {
  cron_runs: [{ id: 3, started_at: new Date(Date.now() - 2 * 36e5).toISOString(), finished_at: new Date().toISOString(), ok: true }],
  link_status: (q) => (q.filters.some((f) => f[0] === "eq" && f[1] === "ok") ? [] : []),
  news_sources: [{ id: "mcg", type: "rss", last_fetched_at: new Date().toISOString() }, { id: "old", type: "html", last_fetched_at: "2026-01-01T00:00:00Z" }, { id: "none", type: "none", last_fetched_at: null }]
};
const healthyCounts = { outbox: (q) => (q.filters[0][2] === "pending" ? 4 : 1), link_status: 120, news_items: 300 };

test("health answers the documented shape and 200 when everything is fine", async () => {
  process.env.VERCEL_GIT_COMMIT_SHA = "abc1234";
  const sb = fakeSb({ tables: healthyTables, counts: healthyCounts });
  const res = fakeRes();
  await health({ method: "GET", headers: {} }, res, sb);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Cache-Control"], "no-store");
  const j = res.json();
  assert.equal(j.ok, true);
  assert.equal(j.version, "abc1234");
  assert.deepEqual(Object.keys(j.checks), ["db", "storage", "cron", "outbox", "links", "news"]);
  assert.equal(j.checks.db.ok, true);
  assert.equal(typeof j.checks.db.ms, "number");
  assert.deepEqual(j.checks.storage, { ok: true });
  assert.equal(j.checks.cron.ok, true);
  assert.ok(j.checks.cron.last_run_at);
  assert.ok(j.checks.cron.hours_since >= 1.9 && j.checks.cron.hours_since <= 2.1, String(j.checks.cron.hours_since));
  assert.deepEqual(j.checks.outbox, { pending: 4, failed: 1 });
  assert.deepEqual(j.checks.links, { checked: 120, broken: [] });
  assert.deepEqual(j.checks.news, { sources: 2, items: 300, stale_sources: ["old"] });
  assert.ok(!JSON.stringify(j).includes("SUPABASE"), "no secrets");
});

test("health is 503 with ok false on a stale cron, a broken link or a db failure", async () => {
  let sb = fakeSb({ tables: { ...healthyTables, cron_runs: [{ id: 1, started_at: new Date(Date.now() - 40 * 36e5).toISOString(), ok: true }] }, counts: healthyCounts });
  let res = fakeRes();
  await health({ method: "GET", headers: {} }, res, sb);
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().ok, false);
  assert.ok(res.json().checks.cron.hours_since > 36);

  sb = fakeSb({ tables: { ...healthyTables, link_status: (q) => (q.filters.some((f) => f[1] === "ok") ? [{ url: "https://dead.example/", status: 404, where_used: "L.dead" }] : []) }, counts: healthyCounts });
  res = fakeRes();
  await health({ method: "GET", headers: {} }, res, sb);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.json().checks.links.broken, [{ url: "https://dead.example/", status: 404, where_used: "L.dead" }]);

  sb = fakeSb({ errors: { cron_runs: "connection refused" } });
  res = fakeRes();
  await health({ method: "GET", headers: {} }, res, sb);
  assert.equal(res.statusCode, 503);
  const j = res.json();
  assert.equal(j.checks.db.ok, false);
  assert.deepEqual(j.checks.links, { checked: 0, broken: [] });

  const r = await healthChecks(fakeSb({ tables: { ...healthyTables, cron_runs: [] }, counts: healthyCounts }));
  assert.equal(r.ok, false, "no cron run yet counts as stale");
  assert.deepEqual(r.checks.cron, { last_run_at: null, ok: null, hours_since: null });
});

// ---------------------------------------------------------------------------
// triage/visitors helpers
// ---------------------------------------------------------------------------
test("csv export quotes fields and defuses formulas", () => {
  assert.equal(csvCell('He said "hi"'), '"He said ""hi"""');
  assert.equal(csvCell("=SUM(A1)"), "\"'=SUM(A1)\"");
  assert.equal(csvCell(null), '""');
  const csv = toCsv([{ name: "A, B", phone: "+919899375445", email: "a@b.co", area: null, pincode: "122001", city: "Gurugram", consent_at: "2026-10-07T00:00:00Z", created_at: "x", last_seen_at: "y", visits: 2 }]);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], '﻿"name","phone","email","area","pincode","city","consent_at","created_at","last_seen_at","visits"');
  assert.equal(lines[1], '"A, B","+919899375445","a@b.co","","122001","Gurugram","2026-10-07T00:00:00Z","x","y","2"');
  assert.equal(clampDays("0"), 1);
  assert.equal(clampDays(undefined), 30);
  assert.equal(clampDays("99999"), 3650);
});

// ---------------------------------------------------------------------------
// News parsing
// ---------------------------------------------------------------------------
const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>MCG</title>
<item><title><![CDATA[Property tax camp &amp; rebate]]></title><link>https://www.mcg.gov.in/notice/1</link><pubDate>Mon, 06 Oct 2026 10:00:00 +0530</pubDate><guid>1</guid></item>
<item><title>Relative link item</title><link>/notice/2</link><dc:date>2026-10-05T04:00:00Z</dc:date></item>
<item><title>No link</title></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>GMDA</title>
<entry><title type="html">Water supply &lt;b&gt;schedule&lt;/b&gt;</title><link rel="self" href="https://www.gmda.gov.in/feed/1"/><link rel="alternate" href="https://www.gmda.gov.in/news/1"/><updated>2026-10-04T09:30:00Z</updated></entry>
<entry><title>Only self link, no alternate</title><link href="https://www.gmda.gov.in/news/2" /><published>2026-10-03T09:30:00Z</published></entry>
</feed>`;

test("parseRss reads RSS 2.0 items with CDATA, entities, relative links and dates", () => {
  const items = parseRss(RSS, "https://www.mcg.gov.in/feed.xml");
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { title: "Property tax camp & rebate", url: "https://www.mcg.gov.in/notice/1", published_at: "2026-10-06T04:30:00.000Z" });
  assert.deepEqual(items[1], { title: "Relative link item", url: "https://www.mcg.gov.in/notice/2", published_at: "2026-10-05T04:00:00.000Z" });
});

test("parseRss reads Atom entries preferring the alternate link", () => {
  const items = parseRss(ATOM);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { title: "Water supply schedule", url: "https://www.gmda.gov.in/news/1", published_at: "2026-10-04T09:30:00.000Z" });
  assert.deepEqual(items[1], { title: "Only self link, no alternate", url: "https://www.gmda.gov.in/news/2", published_at: "2026-10-03T09:30:00.000Z" });
  assert.deepEqual(parseRss(""), []);
  assert.deepEqual(parseRss("<html><body><a href='/x'>not a feed</a></body></html>"), []);
});

const HTML = `<html><body>
<nav><a href="/">Home</a><a href="/about-us-and-the-whole-story">About the municipal corporation</a></nav>
<div class="news-list latest">
  <ul>
    <li><a href="/notice/road-closure.html">Road closure on Sohna road from Monday</a></li>
    <li><a href='https://other.example.org/x?a=1&amp;b=2'>Joint drive with GMDA</a></li>
    <li><a href="#">Skip</a></li>
    <li><a href="javascript:void(0)">Nope</a></li>
    <li><a href="/notice/road-closure.html">Road closure on Sohna road from Monday</a></li>
  </ul>
</div>
<div id="footer"><a href="/contact-the-corporation-office-today">Contact the corporation office today</a></div>
</body></html>`;

test("parseHtmlLinks scopes to a tag.class selector and resolves relative URLs", () => {
  const items = parseHtmlLinks(HTML, "div.news-list", "https://www.mcg.gov.in/en/news");
  assert.deepEqual(items, [
    { title: "Road closure on Sohna road from Monday", url: "https://www.mcg.gov.in/notice/road-closure.html", published_at: null },
    { title: "Joint drive with GMDA", url: "https://other.example.org/x?a=1&b=2", published_at: null }
  ]);
  const byId = parseHtmlLinks(HTML, "#footer", "https://www.mcg.gov.in/");
  assert.deepEqual(byId.map((i) => i.url), ["https://www.mcg.gov.in/contact-the-corporation-office-today"]);
  const byTag = parseHtmlLinks(HTML, "nav", "https://www.mcg.gov.in/");
  assert.deepEqual(byTag.map((i) => i.title), ["About the municipal corporation"]);
  // Selector lists: the first candidate whose container exists and holds anchors wins; descendant parts are ignored.
  const list = parseHtmlLinks(HTML, "table td a, .news-list li a, #footer a", "https://www.mcg.gov.in/");
  assert.deepEqual(list.map((i) => i.title), ["Road closure on Sohna road from Monday", "Joint drive with GMDA"]);
  const footer = parseHtmlLinks(HTML, "section.missing a, #footer a", "https://www.mcg.gov.in/");
  assert.deepEqual(footer.map((i) => i.title), ["Contact the corporation office today"]);
});

test("parseHtmlLinks falls back to all anchors with 20..200 character text", () => {
  const items = parseHtmlLinks(HTML, "", "https://www.mcg.gov.in/");
  assert.deepEqual(items.map((i) => i.title), ["About the municipal corporation", "Road closure on Sohna road from Monday", "Joint drive with GMDA", "Contact the corporation office today"]);
  const missing = parseHtmlLinks(HTML, "section.nothing", "https://www.mcg.gov.in/");
  assert.equal(missing.length, 4);
  assert.equal(scopeHtml("<div><p class='a'>x<p class='a'>y</p></p></div>", "p.a"), "x<p class='a'>y</p>");
});

test("fetchSources parses each source in isolation with the bot UA and reports timeouts", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, ua: init.headers["User-Agent"] });
    if (url.endsWith("rss")) return { ok: true, status: 200, text: async () => RSS };
    if (url.endsWith("html")) return { ok: true, status: 200, text: async () => HTML };
    if (url.endsWith("slow")) return new Promise((_, rej) => init.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); }));
    return { ok: false, status: 500, text: async () => "" };
  };
  const sources = [
    { id: "a", type: "rss", url: "https://a.example/rss" },
    { id: "b", type: "html", url: "https://b.example/html", selector: "div.news-list" },
    { id: "c", type: "rss", url: "https://c.example/slow" },
    { id: "d", type: "html", url: "https://d.example/err" },
    { id: "e", type: "none", url: null }
  ];
  const r = await fetchSources(sources, fetchImpl, { timeoutMs: 30 });
  assert.equal(seen.length, 4);
  assert.ok(seen.every((s) => s.ua === USER_AGENT));
  assert.equal(USER_AGENT, "GurugramVisionForumBot/1.0 (+https://gurugramvisionforum.org)");
  assert.equal(r[0].items.length, 2);
  assert.equal(r[0].error, null);
  assert.equal(r[1].items.length, 2);
  assert.equal(r[2].error, "timeout");
  assert.equal(r[3].error, "http 500");
  assert.equal(r[4].skipped, true);
});

test("loadSourcesFile reads an array and tolerates a missing file", async () => {
  const dir = new URL("./fixtures-news/", import.meta.url);
  const { mkdir, writeFile, rm } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
  const file = new URL("./sources.json", dir);
  try {
    await writeFile(file, JSON.stringify([{ id: "mcg", name: "MCG", url: "https://www.mcg.gov.in/feed", type: "rss", home: "https://www.mcg.gov.in/" }, { id: "bad" }, { id: "x", name: "X", type: "weird" }]));
    const s = await loadSourcesFile(file);
    assert.deepEqual(s, [
      { id: "mcg", name: "MCG", url: "https://www.mcg.gov.in/feed", type: "rss", selector: null, home: "https://www.mcg.gov.in/", note: null, enabled: true },
      { id: "x", name: "X", url: null, type: "none", selector: null, home: null, note: null, enabled: true }
    ]);
    assert.deepEqual(await loadSourcesFile(new URL("./missing.json", dir)), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Link collection and checking
// ---------------------------------------------------------------------------
test("collectFrom gathers every http(s) URL with a where_used label", () => {
  const G = {
    L: { gmda: "https://www.gmda.gov.in/", wa: "https://wa.me/1", blank: "" },
    CATS: [{ id: "roads", channels: [{ k: "Portal", href: "https://services.gmda.gov.in/" }, { k: "Toll-free", href: "tel:1800" }] }],
    PORTALS: [{ n: "GMDA", h: "https://services.gmda.gov.in/" }],
    CHARTERS: [{ id: "rts", src: [["Saral", "https://saralharyana.gov.in/"]] }],
    ROLES: { mp: { links: [["Lok Sabha", "https://sansad.in/ls/members"]] } },
    CIVIC: [{ id: "home", ent: [{ l: "Wards", h: "#/wards" }, { l: "CPGRAMS", h: "https://pgportal.gov.in/" }] }]
  };
  const links = collectFrom(G);
  assert.deepEqual(links, [
    { url: "https://www.gmda.gov.in/", where_used: "L.gmda" },
    { url: "https://wa.me/1", where_used: "L.wa" },
    { url: "https://services.gmda.gov.in/", where_used: "CATS.roads.channels.Portal (+1)" },
    { url: "https://saralharyana.gov.in/", where_used: "CHARTERS.rts.src.Saral" },
    { url: "https://sansad.in/ls/members", where_used: "ROLES.mp.links.Lok Sabha" },
    { url: "https://pgportal.gov.in/", where_used: "CIVIC.home.ent.CPGRAMS" }
  ]);
});

test("collectLinks loads the real site/data.js and finds the official portals", async () => {
  const links = await collectLinks();
  assert.ok(links.length > 30, String(links.length));
  assert.ok(links.every((l) => /^https?:\/\//.test(l.url) && l.where_used));
  assert.ok(links.some((l) => l.url === "https://services.gmda.gov.in/"));
  assert.equal(new Set(links.map((l) => l.url)).size, links.length, "no duplicates");
});

test("checkLinks: ok, 404, HEAD 405 then GET 200, and timeout", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push([url, init.method]);
    if (url === "https://ok.example/") return { status: 200, body: { cancel: async () => {} } };
    if (url === "https://gone.example/") return { status: 404 };
    if (url === "https://nohead.example/") return init.method === "HEAD" ? { status: 405 } : { status: 200, body: null };
    if (url === "https://slow.example/") return new Promise((_, rej) => init.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); }));
    throw new Error("ECONNREFUSED");
  };
  const results = await checkLinks([
    { url: "https://ok.example/", where_used: "L.ok" }, "https://gone.example/", "https://nohead.example/", "https://slow.example/", "https://down.example/"
  ], fetchImpl, { concurrency: 2, timeoutMs: 25 });
  const by = Object.fromEntries(results.map((r) => [r.url, r]));
  assert.equal(by["https://ok.example/"].ok, true);
  assert.equal(by["https://ok.example/"].status, 200);
  assert.equal(by["https://ok.example/"].where_used, "L.ok");
  assert.equal(by["https://gone.example/"].ok, false);
  assert.equal(by["https://gone.example/"].status, 404);
  assert.equal(by["https://nohead.example/"].ok, true);
  assert.equal(by["https://nohead.example/"].status, 200);
  assert.deepEqual(seen.filter((s) => s[0] === "https://nohead.example/").map((s) => s[1]), ["HEAD", "GET"]);
  assert.deepEqual(seen.filter((s) => s[0] === "https://ok.example/").map((s) => s[1]), ["HEAD"]);
  assert.equal(by["https://slow.example/"].ok, false);
  assert.equal(by["https://slow.example/"].error, "timeout");
  assert.equal(by["https://down.example/"].ok, false);
  assert.equal(by["https://down.example/"].error, "ECONNREFUSED");
  assert.ok(results.every((r) => r.checked_at));
  const one = await checkLink("https://gone.example/", fetchImpl);
  assert.equal(one.status, 404);
});

// ---------------------------------------------------------------------------
// Cron: news, links and cron_runs steps
// ---------------------------------------------------------------------------
const emptyDigest = { unmapped: [], filed_overdue: [] };
const emptySweep = { deleted: 0, refs: [] };

test("runDaily records a cron_runs row, fetches news and checks links with the injected fetch", async () => {
  const sources = [{ id: "mcg", name: "MCG", url: "https://www.mcg.gov.in/rss", type: "rss", selector: null, home: null, enabled: true }, { id: "dead", name: "Dead", url: "https://dead.example/html", type: "html", selector: null, home: null, enabled: true }];
  const sb = fakeSb({ rpc: { sla_digest: emptyDigest, retention_sweep: emptySweep }, tables: { news_sources: sources, link_status: [{ url: "https://services.gmda.gov.in/", checked_at: "2026-10-01T00:00:00Z" }] } });
  const fetchImpl = async (url, init) => {
    if (url === "https://www.mcg.gov.in/rss") return { ok: true, status: 200, text: async () => RSS };
    if (url === "https://dead.example/html") return { ok: false, status: 503, text: async () => "" };
    return { status: url.includes("gmda") ? 200 : 404, body: null };
  };
  const r = await runDaily(sb, { COORDINATOR_EMAIL: "coord@example.org" }, { fetch: fetchImpl });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.news, { sources: 2, fetched: 1, new_items: 2, failed: ["dead"] });
  assert.ok(r.links.total > 30, String(r.links.total));
  assert.equal(r.links.checked, Math.min(40, r.links.total));
  assert.equal(r.links.remaining, Math.max(0, r.links.total - 40));
  assert.ok(r.links.broken > 0);

  const ins = sb.calls.queries.find((q) => q.table === "news_items" && q.op === "upsert");
  assert.deepEqual(ins.opts, { onConflict: "source_id,url", ignoreDuplicates: true });
  assert.equal(ins.row.length, 2);
  assert.equal(ins.row[0].source_id, "mcg");
  const ups = sb.calls.queries.filter((q) => q.table === "news_sources" && q.op === "update");
  assert.equal(ups.length, 2);
  assert.equal(ups.find((q) => q.filters[0][2] === "dead").row.last_status, "error");
  assert.equal(ups.find((q) => q.filters[0][2] === "dead").row.last_error, "http 503");
  assert.equal(ups.find((q) => q.filters[0][2] === "mcg").row.last_status, "ok");

  const stored = sb.calls.queries.find((q) => q.table === "link_status" && q.op === "upsert");
  assert.deepEqual(stored.opts, { onConflict: "url" });
  assert.equal(stored.row.length, r.links.checked);
  assert.equal(stored.row[stored.row.length - 1].url, "https://services.gmda.gov.in/", "an already checked URL queues behind the unchecked ones");
  assert.equal(stored.row[stored.row.length - 1].ok, true);
  assert.ok(stored.row.every((row) => "ok" in row && "where_used" in row && row.checked_at));

  const start = sb.calls.queries.find((q) => q.table === "cron_runs" && q.op === "insert");
  assert.ok(start.row.started_at);
  const fin = sb.calls.queries.find((q) => q.table === "cron_runs" && q.op === "update");
  assert.deepEqual(fin.filters, [["eq", "id", 7]]);
  assert.equal(fin.row.ok, true);
  assert.ok(fin.row.finished_at);
  assert.deepEqual(fin.row.result.news, r.news);
});

test("runDaily seeds news_sources from the data file when the table is empty and skips the network without a fetch", async () => {
  const sb = fakeSb({ rpc: { sla_digest: emptyDigest, retention_sweep: emptySweep } });
  const r = await runDaily(sb, {});
  assert.equal(r.ok, true);
  assert.deepEqual(r.news, { sources: 0, fetched: 0, new_items: 0, failed: [], skipped: true });
  assert.equal(r.links.skipped, true);
  assert.equal(r.links.checked, 0);
  assert.ok(!sb.calls.queries.some((q) => q.table === "link_status" && q.op === "upsert"));
  const seed = sb.calls.queries.find((q) => q.table === "news_sources" && q.op === "upsert");
  if (seed) {
    assert.deepEqual(seed.opts, { onConflict: "id", ignoreDuplicates: true });
    assert.ok(seed.row.every((s) => s.id && s.name && ["rss", "html", "none"].includes(s.type)));
  }
});

test("the SLA digest lists broken links and is sent for them alone", async () => {
  const broken = [{ url: "https://dead.example/", status: 404, error: null, where_used: "PORTALS.Dead" }, { url: "https://slow.example/", status: 0, error: "timeout", where_used: "L.slow" }];
  const m = slaDigestMail(emptyDigest, "coord@example.org", broken);
  assert.match(m.subject, /2 broken links$/);
  assert.ok(m.body_text.includes("Broken links (2):"));
  assert.ok(m.body_text.includes("- https://dead.example/ (HTTP 404), used in PORTALS.Dead"));
  assert.ok(m.body_text.includes("- https://slow.example/ (timeout), used in L.slow"));
  assert.ok(!slaDigestMail(emptyDigest, "c@x.org").body_text.includes("Broken links"));

  const sb = fakeSb({ rpc: { sla_digest: emptyDigest, retention_sweep: emptySweep }, tables: { link_status: (q) => (q.filters.some((f) => f[1] === "ok") ? broken : []) } });
  const r = await runDaily(sb, { COORDINATOR_EMAIL: "coord@example.org" });
  assert.equal(r.sla.digest_sent, true);
  const ins = sb.calls.queries.find((q) => q.table === "outbox" && q.op === "insert");
  assert.ok(ins.row.body_text.includes("https://dead.example/"));
});

test("runDaily isolates a failing news step from the others", async () => {
  const sb = fakeSb({ rpc: { sla_digest: emptyDigest, retention_sweep: emptySweep }, errors: { news_sources: "relation missing" } });
  const r = await runDaily(sb, {});
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, ["news: news_sources select: relation missing"]);
  assert.deepEqual(r.retention, { deleted: 0 });
  const fin = sb.calls.queries.find((q) => q.table === "cron_runs" && q.op === "update");
  assert.equal(fin.row.ok, false);
});
