import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { findings, reconcile, countBy, dailyMarkdown, weeklyMarkdown, issueMarkdown, agentStep, agentView, istDay, isoWeekOf, PHASES } from "../../lib/seo/agent.js";
import { stepErrors } from "../../lib/handlers/triage/seo.js";
import { submitSitemap } from "../../lib/seo/gsc.js";
import { seoStep } from "../../lib/seo/audit.js";

const SITE = "https://gurugramvisionforum.org";
const NOW = Date.UTC(2026, 9, 9, 13, 30); // 19:00 IST, Friday 9 Oct 2026

const STATE = {
  site: SITE,
  summary: { pages: 131, audited: 131, avg_score: 98 },
  pages: [
    { path: "/about", kind: "app", issues: [{ code: "canonical_other", level: "info", detail: "x" }] },
    { path: "/join", kind: "app", issues: [{ code: "canonical_other", level: "info", detail: "x" }, { code: "jsonld_missing", level: "info" }] },
    { path: "/blog/x", kind: "blog", issues: [{ code: "status", level: "error", detail: "HTTP 500" }] }
  ],
  crawl: { broken: [{ url: "/hi/wards", status: 404, sources: ["/hi/ward/5"] }], orphans: [] },
  sitechecks: [{ key: "robots", ok: true }, { key: "gsc_sitemap", ok: false, detail: "0 URLs submitted" }, { key: "bing_crawl", ok: null, detail: "not yet" }, { key: "headers", ok: false, detail: "No HSTS" }],
  vitals: { latest: [{ url: `${SITE}/`, performance: 77, lcp_ms: 4100, cls: 0.01, tbt_ms: 90 }] },
  index: { total: 3, indexed: 1, rows: [{ url: `${SITE}/`, verdict: "PASS", coverage: "Submitted and indexed" }, { url: `${SITE}/guides`, verdict: "NEUTRAL", coverage: "URL is unknown to Google" }, { url: `${SITE}/guide/roads`, verdict: "NEUTRAL", coverage: "Crawled - currently not indexed" }] },
  geo: { asked: 2, cited: 0, questions: [{ key: "issue:roads", issue: "roads", cited: false }, { key: "issue:drains", issue: "drains", cited: null, error: "http_429_RESOURCE_EXHAUSTED: Quota exceeded" }] },
  clusters: [{ id: "waste", label: "Garbage", demand: 27, auto: { state: "queued", position: 1, eta_days: 0 } }, { id: "traffic", label: "Traffic", demand: 8, auto: { state: "held", slug: "traffic-gurugram-2026-10" } }, { id: "roads", label: "Roads", demand: 0, auto: { state: "covered" } }],
  run_errors: { gsc: { at: "2026-10-08T21:41:00Z", error: "FUNCTION_INVOCATION_TIMEOUT" }, brief: { at: "x", error: "boom" } },
  connections: { gsc: true, bing: true, gemini: true, pagespeed: false },
  search: { google: { queries: [{ key: "who fixes potholes gurugram", clicks: 1, impressions: 40, ctr: 0.025, position: 11.2 }], pages: [{ key: "/guide/roads", clicks: 0, impressions: 120, ctr: 0, position: 4 }], totals: { clicks: 1, impressions: 160 } } },
  checklist: [{ key: "mentions", title: "Off-page: the Forum in the news", ok: false, detail: "None found yet" }, { key: "titles", title: "Unique titles", ok: false }],
  topics: { per_week: 3 }
};

test("findings: every problem in the state, with who acts and what happens", () => {
  const f = findings(STATE);
  const by = Object.fromEntries(f.map((x) => [x.key, x]));
  assert.equal(by["page:canonical_other"].owner, "code"); assert.equal(by["page:canonical_other"].title, "Canonical points elsewhere on 2 pages"); assert.deepEqual(by["page:canonical_other"].data.paths, ["/about", "/join"]);
  assert.equal(by["page:status"].owner, "auto"); assert.equal(by["page:status"].severity, "high");
  assert.equal(by["link:/hi/wards"].owner, "code");
  assert.equal(by["site:gsc_sitemap"].owner, "auto");
  assert.equal(by["site:bing_crawl"].owner, "wait");
  assert.equal(by["site:headers"].owner, "code");
  assert.equal(by["speed:/"].owner, "code");
  assert.equal(by["index:unknown"].owner, "auto"); assert.deepEqual(by["index:unknown"].data.urls, [`${SITE}/guides`]);
  assert.equal(by["index:not_indexed"].owner, "wait");
  assert.equal(by["geo:error"].owner, "person", "a quota error needs Google billing switched on, which only the owner can do");
  assert.equal(by["geo:not_cited"].owner, "auto");
  assert.equal(by["cluster:waste"].owner, "auto"); assert.equal(by["cluster:traffic"].owner, "person"); assert.equal(by["cluster:roads"], undefined);
  assert.equal(by["ops:gsc"].owner, "auto", "a failed SEO step is re-run"); assert.equal(by["ops:brief"].owner, "code", "a mail step is never re-run by the agent");
  assert.equal(by["conn:pagespeed"].owner, "person"); assert.equal(by["conn:gsc"], undefined);
  assert.equal(by["search:striking"].owner, "auto"); assert.equal(by["search:low_ctr"].owner, "code");
  assert.equal(by["check:mentions"].owner, "person"); assert.equal(by["check:titles"], undefined, "covered by the page findings");
  assert.deepEqual([...new Set(f.map((x) => x.severity))].every((s) => ["high", "medium", "low"].includes(s)), true);
  assert.equal(f[0].severity, "high", "most severe first");
  assert.deepEqual(findings({}), []);
});

test("reconcile: new, still open (keeps first_seen) and fixed", () => {
  const f = findings(STATE).filter((x) => ["page:canonical_other", "index:unknown"].includes(x.key));
  const tasks = [
    { key: "index:unknown", status: "open", first_seen: "2026-10-01T00:00:00Z", last_action_at: "2026-10-09T03:30:00Z", last_result: "Pinged" },
    { key: "link:/hi/wards", status: "open", title: "Broken internal link", first_seen: "2026-10-08T00:00:00Z" },
    { key: "page:canonical_other", status: "fixed", first_seen: "2026-09-01T00:00:00Z", resolved_at: "2026-09-02T00:00:00Z" }
  ];
  const r = reconcile(f, tasks, "2026-10-09T13:30:00Z");
  assert.deepEqual(r.opened.map((t) => t.key), ["page:canonical_other"], "a fixed task that comes back is new again");
  assert.deepEqual(r.fixed.map((t) => t.key), ["link:/hi/wards"]);
  assert.equal(r.open.find((t) => t.key === "index:unknown").first_seen, "2026-10-01T00:00:00Z");
  assert.equal(r.open.find((t) => t.key === "index:unknown").last_result, "Pinged");
  assert.equal(r.upserts.find((t) => t.key === "link:/hi/wards").status, "fixed");
  assert.deepEqual(countBy(r.open), { auto: 1, wait: 0, code: 1, person: 0 });
});

test("reports: daily timeline, fixed, new, open by who acts; weekly plan; the code-fix issue", () => {
  const open = reconcile(findings(STATE), [], "2026-10-09T03:30:00Z").open;
  const md = dailyMarkdown({ day: "2026-10-09", state: STATE, log: [{ at: "2026-10-09T03:30:01Z", text: "Plan for today", ok: null }, { at: "2026-10-09T07:30:01Z", text: "Re-running gsc", ok: false }], fixed: [{ title: "Broken internal link: /hi/wards" }], opened: open.slice(0, 2), open, issueUrl: "https://github.com/x/y/issues/9" });
  assert.match(md, /^# SEO agent: daily report, 9 Oct 2026/);
  assert.match(md, /- 09:00 Plan for today/); assert.match(md, /- 13:00 ⚠️ Re-running gsc/);
  assert.match(md, /## Fixed today \(1\)\n\n- Broken internal link: \/hi\/wards/);
  assert.match(md, /### Needs a code change \(\d+\) · \[GitHub issue\]\(https:\/\/github.com\/x\/y\/issues\/9\)/);
  assert.match(md, /131 pages audited, average score 98 · 1 of 3 inspected pages indexed by Google · mobile speed 77/);
  const wk = weeklyMarkdown({ week: "2026-W41", day: "2026-10-05", state: STATE, open, lastWeek: { fixed: 4, opened: 2, open: 9 } });
  assert.match(wk, /# SEO agent: plan for 2026-W41/); assert.match(wk, /1\. Garbage: 27 public posts in 14 days/); assert.match(wk, /Fixed: 4 · New: 2 · Open at the end: 9/);
  const issue = issueMarkdown(open.filter((t) => t.owner === "code"), "2026-10-09");
  assert.match(issue, /- \[ \] \*\*Canonical points elsewhere on 2 pages\*\*/); assert.match(issue, /tree\/seo-agent-log/);
  assert.equal(issueMarkdown([], "2026-10-09"), "");
});

test("time helpers: IST day and ISO week", () => {
  assert.equal(istDay(Date.UTC(2026, 9, 8, 19, 0)), "2026-10-09", "00:30 IST is the next day");
  assert.equal(isoWeekOf("2026-10-09"), "2026-W41"); assert.equal(isoWeekOf("2026-01-01"), "2026-W01"); assert.equal(isoWeekOf("2027-01-01"), "2026-W53");
  assert.deepEqual(PHASES, ["plan", "work", "report"]);
});

test("stepErrors: a step's newest run decides; a later clean run clears an older failure", () => {
  const runs = [
    { started_at: "3", result: { steps: ["gsc"], gsc: { queries: 1 } } },
    { started_at: "2", result: { steps: ["gsc"], errors: ["gsc: timeout"] } },
    { started_at: "1", finished_at: "1", result: { steps: ["geo", "bing"], errors: ["bing: 401 bad key"] } }
  ];
  assert.deepEqual(stepErrors(runs), { bing: { at: "1", error: "401 bad key" } });
  assert.deepEqual(stepErrors([{ result: { news: { fetched: 1 }, links: { skipped: "not_in_run" }, errors: ["links: x"] } }]), {});
});

// A small Supabase stand-in.
function fakeSb(tables = {}) {
  const writes = [];
  const from = (table) => {
    const rows = () => (tables[table] || []).slice();
    const filters = [];
    const chain = {
      select() { return chain; }, order() { return chain; }, limit() { return chain; },
      eq(k, v) { filters.push((r) => r[k] === v); return chain; }, gte(k, v) { filters.push((r) => String(r[k]) >= String(v)); return chain; }, lt(k, v) { filters.push((r) => String(r[k]) < String(v)); return chain; },
      upsert(data, opts) { writes.push({ table, op: "upsert", data, opts }); const list = Array.isArray(data) ? data : [data]; tables[table] = (tables[table] || []).filter((r) => !list.some((x) => x.key ? x.key === r.key : x.id === r.id)).concat(list); return Promise.resolve({ error: null }); },
      insert(data) { writes.push({ table, op: "insert", data }); tables[table] = (tables[table] || []).concat(data); return Promise.resolve({ error: null }); },
      delete() { return { lt: () => Promise.resolve({ error: null }) }; },
      then(ok, bad) { return Promise.resolve({ data: rows().filter((r) => filters.every((f) => f(r))), error: null }).then(ok, bad); }
    };
    return chain;
  };
  return { from, writes, tables };
}

test("agentStep: plan, act, store, report; the workflow gets the retries, the reports and the issue", async () => {
  const tables = { seo_tasks: [{ key: "link:/old", status: "open", owner: "code", area: "links", severity: "high", title: "Broken internal link: /old", first_seen: "2026-10-01T00:00:00Z" }], seo_agent_log: [], seo_agent_reports: [], seo_pages: [] };
  const sb = fakeSb(tables);
  const calls = [];
  const fetchImpl = async (url, init = {}) => { calls.push({ url, method: init.method || "GET" }); return { ok: true, status: 200, json: async () => (url.startsWith("https://oauth2") ? { access_token: "T" } : {}), text: async () => "<html></html>", headers: { get: () => null } }; };
  const state = { ...STATE, pages: [], crawl: { broken: [] }, run_errors: { gsc: { error: "timeout" } } };
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
  const env = { SITE_URL: SITE, INDEXNOW_KEY: "k", GSC_SERVICE_ACCOUNT: JSON.stringify({ client_email: "a@b.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }) };
  const plan = await agentStep(sb, env, { fetch: fetchImpl, now: Date.UTC(2026, 9, 9, 3, 30), phase: "plan", loadState: async () => state });
  assert.deepEqual(plan.retry, ["gsc"]);
  assert.equal(plan.fixed, 1, "the broken link is gone from the state");
  assert.ok(plan.opened > 5);
  assert.ok(calls.some((c) => c.url.includes("indexnow")), "IndexNow pinged for the unknown pages");
  assert.equal(calls.filter((c) => c.url.includes("/sitemaps/") && c.method === "PUT").length, 1, "the sitemap resubmitted once");
  assert.ok(plan.weekly && plan.weekly_md.includes("plan for 2026-W41"), "the first run of a week writes the week's plan");
  assert.equal(plan.report, undefined);
  assert.ok(tables.seo_agent_log.some((l) => l.kind === "plan" && /^Plan for today/.test(l.text)));
  assert.ok(tables.seo_agent_log.some((l) => /^Fixed: Broken internal link: \/old/.test(l.text)));
  assert.equal(tables.seo_tasks.find((t) => t.key === "link:/old").status, "fixed");
  assert.equal(tables.seo_tasks.find((t) => t.key === "index:unknown").last_result.startsWith("Pinged IndexNow"), true);
  assert.match(plan.issue_md, /Site check failing: headers/);

  const kinds = tables.seo_agent_log.map((l) => l.kind);
  assert.equal(kinds[0], "plan", "the day's plan opens the timeline");
  assert.ok(kinds.indexOf("action") < kinds.lastIndexOf("check"));
  const n = calls.length;
  const report = await agentStep(sb, env, { fetch: fetchImpl, now: NOW, phase: "report", loadState: async () => state });
  assert.equal(calls.slice(n).filter((c) => c.url.includes("indexnow")).length, 0, "IndexNow at most once a day");
  assert.equal(calls.slice(n).filter((c) => c.url.includes("/sitemaps/")).length, 0, "the sitemap is resubmitted at most once a day");
  assert.equal(report.report.path, "daily/2026/10/2026-10-09.md");
  assert.match(report.report_md, /## Timeline \(IST\)/);
  assert.match(report.report_md, /- 09:00 Plan for today/);
  assert.match(report.report_md, /## Fixed today \(1\)\n\n- Broken internal link: \/old/);
  assert.ok(tables.seo_agent_reports.some((r) => r.id === "daily:2026-10-09" && r.summary.fixed === 1));
  assert.equal(report.weekly, undefined, "the week's plan is written once");

  const view = await agentView(sb, { now: NOW });
  assert.ok(view.open.length > 5 && view.fixed.length === 1 && view.reports.length === 2 && view.log.length > 3);
  assert.equal((await agentStep(sb, env, { phase: "work" })).skipped, "no_state");
});

test("submitSitemap: one PUT with the write scope, read-only otherwise", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
  const SA = JSON.stringify({ client_email: "a@b.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) });
  const calls = [];
  const fetchImpl = async (url, init = {}) => { calls.push({ url, init }); if (url.startsWith("https://oauth2")) return { ok: true, status: 200, json: async () => ({ access_token: "T" }) }; return { ok: true, status: 204, json: async () => null }; };
  const r = await submitSitemap({ SITE_URL: SITE, GSC_SERVICE_ACCOUNT: SA }, fetchImpl);
  assert.deepEqual(r, { ok: true, sitemap: `${SITE}/sitemap.xml` });
  const claims = JSON.parse(Buffer.from(new URLSearchParams(calls[0].init.body).get("assertion").split(".")[1], "base64url").toString());
  assert.equal(claims.scope, "https://www.googleapis.com/auth/webmasters");
  assert.equal(calls[1].init.method, "PUT");
  assert.equal(calls[1].url, `https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Agurugramvisionforum.org/sitemaps/${encodeURIComponent(SITE + "/sitemap.xml")}`);
  assert.deepEqual(await submitSitemap({}, fetchImpl), { ok: false, error: "no_key" });
});

test("seoStep only: re-audits just the given paths and never drops other pages", async () => {
  const tables = { seo_pages: [{ url: `${SITE}/blog/live-post`, checked_at: "2026-10-01T00:00:00Z" }], seo_links: [], seo_site: [] };
  const sb = fakeSb(tables);
  sb.from = ((orig) => (t) => { const c = orig(t); c.in = () => Promise.resolve({ error: null }); return c; })(sb.from);
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return { ok: true, status: 200, url, headers: { get: () => "text/html" }, text: async () => "<html lang=en><head><title>About the Forum | Gurugram Vision Forum</title></head><body><h1>About</h1></body></html>" }; };
  const r = await seoStep(sb, { SITE_URL: SITE }, { fetch: fetchImpl, posts: [], only: ["/about", "/join"], now: NOW });
  assert.equal(r.checked, 2);
  assert.ok(urls.includes(`${SITE}/about`) && urls.includes(`${SITE}/join`));
  assert.ok(!sb.writes.some((w) => w.table === "seo_pages" && w.op === "delete"), "the blog page outside this run is kept");
});

test("the AI answer task quotes the newest failure, not an old one", () => {
  const geo = { asked: 0, cited: 0, questions: [
    { key: "issue:roads", issue: "roads", cited: null, error: "model_gemini-2.0-flash_not_found", checked_at: "2026-10-08T01:19:00Z" },
    { key: "issue:drains", issue: "drains", cited: null, error: "http_429_RESOURCE_EXHAUSTED: Quota exceeded", checked_at: "2026-10-09T01:19:00Z" }
  ] };
  const t = findings({ ...STATE, geo }, NOW).find((x) => x.key === "geo:error");
  assert.equal(t.detail, "http_429_RESOURCE_EXHAUSTED: Quota exceeded");
  assert.equal(t.owner, "person");
  assert.match(t.action, /billing/);
});
