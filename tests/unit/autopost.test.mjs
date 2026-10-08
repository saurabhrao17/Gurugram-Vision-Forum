import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWeeklyPost, collectFacts, isThin, isoWeek, weekTag, formatRange, periodDays, templateBodyEn, templateBodyHi,
  checkAiBody, allowedNumbers, allowedLinks, headlineFor, DISCLOSURE_EN, DISCLOSURE_HI, AUTHOR, PUBLIC_MIN_REPORTS, MIN_SIGNALS
} from "../../lib/autopost.js";
import { validatePost } from "../../lib/content.js";
import { siteUrl, pingIndexNow, cleanUrls, INDEXNOW_URL } from "../../lib/indexnow.js";
import { runDaily, autopostStep, digestStep, indexnowStep, loadSettings, autopostMail, digestMail, AUTOPOST_DEFAULTS, SEO_DEFAULTS } from "../../lib/handlers/cron.js";
import { makeHandler as makeContent, validateAutopost, validateSeo } from "../../lib/handlers/triage/content.js";
import { HttpError } from "../../lib/auth.js";

// ---------------------------------------------------------------------------
// Fakes: a Vercel-style response and a Supabase client that records every
// terminal query. Tables can be arrays or functions of the query; `counts`
// answers head/count selects; `errors` fails a table; `inserts` can reject.
// ---------------------------------------------------------------------------
function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: "" };
  res.status = (s) => { res.statusCode = s; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; return res; };
  res.end = (b) => { res.body = b || ""; };
  res.json = () => JSON.parse(res.body);
  return res;
}

function fakeSb({ rpc = {}, tables = {}, counts = {}, errors = {} } = {}) {
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
      gte(k, v) { q.filters.push(["gte", k, v]); return chain; },
      not(k, op, v) { q.filters.push(["not", k, op, v]); return chain; },
      is(k, v) { q.filters.push(["is", k, v]); return chain; },
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
        return Promise.resolve(out).then(resolve, reject);
      }
    };
    return chain;
  };
  return {
    calls,
    from,
    rpc: async (name, args) => { calls.rpc.push([name, args]); const v = rpc[name]; return typeof v === "function" ? v(args) : { data: v ?? null, error: null }; },
    storage: { from: () => ({ list: async () => ({ data: [], error: null }), remove: async () => ({ data: [], error: null }) }) }
  };
}

const MONDAY = Date.parse("2026-10-05T03:30:00Z");     // ISO week 2026-W41
const TUESDAY = MONDAY + 86400000;
const iso = (ms) => new Date(ms).toISOString();
const emptyRpc = { sla_digest: { unmapped: [], filed_overdue: [] }, retention_sweep: { deleted: 0, refs: [] } };

// A realistic week: the stored insight (as the cron writes insights.data),
// two official notices, one published post and the rule-based actions.
const PERIOD = { from: iso(MONDAY - 7 * 86400000), to: iso(MONDAY) };
const PULSE = {
  period: PERIOD, total: 14, previous_total: 9, sources_checked: ["reddit", "news", "reports"],
  headline_en: "Waste tops the week's civic talk", headline_hi: "इस हफ़्ते सबसे ज़्यादा चर्चा: कचरा",
  summary_en: "This week residents talked most about waste (7), drains (4) and roads (3).",
  summary_hi: "इस हफ़्ते निवासियों ने सबसे ज़्यादा कचरा (7), नाले (4) और सड़कें (3) की बात की।",
  topics: [
    { issue_type: "waste", label: "Waste", label_hi: "कचरा", count: 7, previous: 3, trend: "up", by_source: { reddit: 5, news: 1, reports: 1 },
      areas: [{ area: "Sector 45", n: 3 }, { area: "DLF Phase 3", n: 2 }],
      examples: [{ title: "Garbage not lifted in Sector 45 for a week", url: "https://www.reddit.com/r/gurgaon/comments/r1/x/", source: "reddit", posted_at: PERIOD.to }, { title: "Bandhwari fire: MCG told to act", url: "https://news.google.com/rss/articles/g1", source: "news", posted_at: PERIOD.to }, { title: "third", url: "https://www.reddit.com/r/gurgaon/comments/r3/z/", source: "reddit", posted_at: PERIOD.to }] },
    { issue_type: "drains", label: "Drains and waterlogging", label_hi: "नाले और जलभराव", count: 4, previous: 4, trend: "flat", by_source: { reddit: 2, news: 0, reports: 2 },
      areas: [{ area: "Sector 29", n: 2 }], examples: [{ title: "Drains, Sector 29", url: "https://gurugramvisionforum.org/#/r/GVF-2026-ABC23", source: "reports", posted_at: PERIOD.to }] },
    { issue_type: "roads", label: "Roads and potholes", label_hi: "सड़कें और गड्ढे", count: 3, previous: 6, trend: "down", by_source: { reddit: 3, news: 0, reports: 0 }, areas: [], examples: [{ title: "Potholes on Golf Course Road", url: "javascript:alert(1)", source: "reddit" }] }
  ],
  actions: [
    { title: "Sector cleaning drive with MCG's sanitation wing", why: "7 mentions this week, rising; most about Sector 45", where: "Sector 45", when: "this week", issue_type: "waste" },
    { title: "Pre-monsoon drain walk and townhall with GMDA/MCG engineers", why: "4 mentions this week, steady", where: "Sector 29", when: "within two weeks", issue_type: "drains" }
  ],
  ai: false, provider: null
};
const NEWS = [
  { title: "MCG notice: property tax rebate till 31 October", url: "https://www.mcg.gov.in/notice/1", published_at: iso(MONDAY - 2 * 86400000), source: "MCG" },
  { title: "GMDA water supply schedule for Sector 56", url: "https://gmda.gov.in/n/2", published_at: iso(MONDAY - 3 * 86400000), source: "GMDA" },
  { title: "ignored: not https", url: "ftp://x", source: "X" }
];
const POSTS = [{ title: "Ward 12 townhall: what residents asked", slug: "ward-12-townhall-ab2cd", kind: "story" }];
const STATS_LOW = { total: 49, week: 12, by_stage: { 0: 5, 2: 7 }, by_issue: { waste: 8, drains: 4 } };
const STATS_OK = { total: 50, week: 12, by_stage: { 0: 5, 2: 7 }, by_issue: { waste: 8, drains: 4 } };
const INPUT = { pulse: PULSE, news: NEWS, posts: POSTS, reportStats: STATS_OK, period: PERIOD, env: {}, fetchImpl: null, now: MONDAY };

// ---------------------------------------------------------------------------
// Dates and facts
// ---------------------------------------------------------------------------
test("isoWeek, weekTag and formatRange follow ISO 8601 and the calendar", () => {
  assert.deepEqual(isoWeek(new Date(MONDAY)), { year: 2026, week: 41 });
  assert.deepEqual(isoWeek("2026-01-01T00:00:00Z"), { year: 2026, week: 1 });
  assert.deepEqual(isoWeek("2027-01-01T00:00:00Z"), { year: 2026, week: 53 });
  assert.equal(weekTag(isoWeek(new Date(MONDAY))), "2026-W41");
  assert.equal(weekTag({ year: 2027, week: 3 }), "2027-W03");
  assert.equal(formatRange(PERIOD, "en"), "28 September–4 October 2026", "a Monday-to-Monday window reads Monday to Sunday");
  assert.equal(formatRange(PERIOD, "hi"), "28 सितंबर–4 अक्टूबर 2026");
  assert.equal(formatRange({ from: "2026-10-05T00:00:00Z", to: "2026-10-12T00:00:00Z" }, "en"), "5–11 October 2026");
  assert.equal(formatRange({ from: "2026-12-29T00:00:00Z", to: "2027-01-05T00:00:00Z" }, "en"), "29 December 2026–4 January 2027");
  assert.equal(periodDays({ from: "2026-10-05T00:00:00Z", to: "2026-10-06T12:00:00Z" }).to.toISOString(), "2026-10-06T12:00:00.000Z", "a short window keeps its end");
});

test("collectFacts keeps only public links, caps lists and withholds report numbers under 50", () => {
  const f = collectFacts(INPUT);
  assert.equal(f.topics.length, 3);
  assert.deepEqual(f.topics[0].examples.map((e) => e.url), ["https://www.reddit.com/r/gurgaon/comments/r1/x/", "https://news.google.com/rss/articles/g1"], "two examples at most");
  assert.deepEqual(f.topics[2].examples, [], "a javascript: link is not a public link");
  assert.equal(f.news.length, 2, "the non-https notice is dropped");
  assert.deepEqual(f.reports, { total: 50, week: 12, by_stage: { 0: 5, 2: 7 }, by_issue: { waste: 8, drains: 4 } });
  assert.equal(collectFacts({ ...INPUT, reportStats: STATS_LOW }).reports, null);
  assert.equal(collectFacts({ ...INPUT, reportStats: null }).reports, null);
  assert.equal(f.week.week, 41);
  assert.equal(PUBLIC_MIN_REPORTS, 50);
  assert.equal(MIN_SIGNALS, 3);
  assert.equal(isThin(collectFacts({ pulse: { total: 2, topics: [] }, news: [], posts: [] })), true);
  assert.equal(isThin(collectFacts({ pulse: { total: 2, topics: [] }, news: NEWS, posts: [] })), false);
  assert.equal(isThin(collectFacts({ pulse: null, news: [], posts: POSTS })), false);
  assert.equal(headlineFor(collectFacts({ pulse: null, news: NEWS }), "en"), "official notices and Forum updates");
  assert.equal(headlineFor(collectFacts({ pulse: { total: 5, topics: [{ issue_type: "waste", count: 5 }] } }), "hi"), "इस हफ़्ते सबसे ज़्यादा चर्चा: कचरा");
});

// ---------------------------------------------------------------------------
// buildWeeklyPost: rule-based
// ---------------------------------------------------------------------------
test("buildWeeklyPost writes both languages from templates with the disclosure, byline, slug and source", async () => {
  const p = await buildWeeklyPost(INPUT);
  assert.ok(p);
  assert.equal(p.ai, false);
  assert.equal(p.kind, "news");
  assert.equal(p.title, "Gurugram civic week, 28 September–4 October 2026: Waste tops the week's civic talk");
  assert.equal(p.title_hi, "गुरुग्राम नागरिक सप्ताह, 28 सितंबर–4 अक्टूबर 2026: इस हफ़्ते सबसे ज़्यादा चर्चा: कचरा");
  assert.equal(p.slug, "civic-week-2026-W41");
  assert.equal(p.source, "auto:weekly:2026-W41");
  assert.equal(p.week, "2026-W41");
  assert.deepEqual(p.tags, ["auto", "weekly", "waste", "drains", "roads"]);
  assert.equal(p.author, AUTHOR);
  assert.equal(p.published, false);
  assert.match(p.summary, /^14 public mentions across 3 topics this week; most about waste \(7\), drains and waterlogging \(4\) and roads and potholes \(3\)\. 2 official notices\. 12 reports to the Forum\. 1 new Forum post\.$/);
  assert.match(p.summary_hi, /^इस हफ़्ते 3 विषयों पर 14 सार्वजनिक ज़िक्र; सबसे ज़्यादा कचरा \(7\), नाले और जलभराव \(4\) और सड़कें और गड्ढे \(3\)।/);
  // Sections, in order.
  const order = ["<h2>What residents talked about</h2>", "<h2>Official notices this week</h2>", "<h2>What the Forum received</h2>", "<h2>From the Forum this week</h2>", "<h2>Suggested next steps</h2>", 'href="/report"', 'href="/guides"', DISCLOSURE_EN.replace("'", "&#39;").replace("&#39;", "'")];
  let at = -1;
  for (const s of order) { const i = p.body.indexOf(s); assert.ok(i > at, `${s} in order`); at = i; }
  const orderHi = ["<h2>इस हफ़्ते निवासियों ने किस बारे में बात की</h2>", "<h2>इस हफ़्ते की आधिकारिक सूचनाएँ</h2>", "<h2>फ़ोरम को क्या मिला</h2>", "<h2>इस हफ़्ते फ़ोरम से</h2>", "<h2>सुझाए गए अगले कदम</h2>", 'href="/report"', 'href="/guides"', DISCLOSURE_HI];
  at = -1;
  for (const s of orderHi) { const i = p.body_hi.indexOf(s); assert.ok(i > at, `${s} in order (hi)`); at = i; }
  assert.ok(p.body.endsWith(`<p class="disclosure"><em>${DISCLOSURE_EN}</em></p>`), "the disclosure is the last paragraph");
  assert.ok(p.body_hi.endsWith(`<p class="disclosure"><em>${DISCLOSURE_HI}</em></p>`));
  // Facts, trend words, areas, examples and public links only.
  assert.ok(p.body.includes("<strong>Waste</strong>: 7 mentions, rising (3 the week before). Most mentions were about Sector 45 and DLF Phase 3. For example: <a href=\"https://www.reddit.com/r/gurgaon/comments/r1/x/\" target=\"_blank\" rel=\"noopener\">Garbage not lifted in Sector 45 for a week</a> (Reddit); "), p.body);
  assert.ok(p.body.includes("<strong>Roads and potholes</strong>: 3 mentions, falling (6 the week before).</li>"));
  assert.ok(p.body_hi.includes("<strong>कचरा</strong>: 7 ज़िक्र, पिछले हफ़्ते से ज़्यादा (पिछले हफ़्ते 3)। सबसे ज़्यादा ज़िक्र Sector 45 और DLF Phase 3 के बारे में थे। उदाहरण: "));
  assert.ok(p.body_hi.includes("(रेडिट)"));
  assert.ok(!p.body.includes("javascript:"));
  assert.ok(p.body.includes('<a href="https://www.mcg.gov.in/notice/1" target="_blank" rel="noopener">MCG notice: property tax rebate till 31 October</a> — MCG, 3 October'));
  assert.ok(p.body.includes("Residents sent the Forum 12 reports this week; 50 in all so far."));
  assert.ok(p.body.includes("By stage: 5 received and 7 filed officially."));
  assert.ok(p.body_hi.includes("चरण के अनुसार: 5 प्राप्त और 7 आधिकारिक रूप से दर्ज।"));
  assert.ok(p.body.includes('<a href="/blog/ward-12-townhall-ab2cd">Ward 12 townhall: what residents asked</a> (story)'));
  assert.ok(p.body_hi.includes('<a href="/hi/blog/ward-12-townhall-ab2cd">Ward 12 townhall: what residents asked</a> (कहानी)'));
  assert.ok(p.body.includes("<strong>Sector cleaning drive with MCG's sanitation wing</strong>: 7 mentions this week, rising; most about Sector 45. Where: Sector 45. When: this week."));
  assert.ok(p.body_hi.includes("। कहाँ: Sector 29। कब: within two weeks।"));
  assert.ok(!/<(script|iframe|img)/i.test(p.body + p.body_hi));
  // Ready for the posts table.
  const { errors } = validatePost(p);
  assert.deepEqual(errors, []);
  assert.ok(p.body.length < 20000 && p.body_hi.length < 20000);
});

test("the report-count section appears only from 50 public reports and the thin week is skipped", async () => {
  const under = await buildWeeklyPost({ ...INPUT, reportStats: STATS_LOW });
  assert.ok(!under.body.includes("What the Forum received"), "counts withheld under 50");
  assert.ok(!under.body_hi.includes("फ़ोरम को क्या मिला"));
  assert.ok(!under.summary.includes("reports to the Forum"));
  assert.ok(!under.body.includes("49"));
  const at = await buildWeeklyPost({ ...INPUT, reportStats: STATS_OK });
  assert.ok(at.body.includes("What the Forum received"));
  assert.ok(at.body.includes("50 in all so far"));

  assert.equal(await buildWeeklyPost({ pulse: { total: 2, topics: [{ issue_type: "waste", count: 2 }] }, news: [], posts: [], now: MONDAY }), null, "fewer than 3 signals, no notices, no posts");
  assert.equal(await buildWeeklyPost({ pulse: null, news: [], posts: [], now: MONDAY }), null);
  const notices = await buildWeeklyPost({ pulse: null, news: NEWS, posts: [], now: MONDAY, period: PERIOD });
  assert.ok(notices, "notices alone are worth a post");
  assert.equal(notices.title, "Gurugram civic week, 28 September–4 October 2026: official notices and Forum updates");
  assert.ok(!notices.body.includes("What residents talked about"));
  assert.ok(notices.body.includes("Official notices this week"));
  assert.deepEqual(notices.tags, ["auto", "weekly"]);
  assert.deepEqual(validatePost(notices).errors, []);
  const en = await buildWeeklyPost({ ...INPUT, lang: "en" });
  assert.equal(en.body_hi, "");
  assert.equal(en.title_hi, "");
});

// ---------------------------------------------------------------------------
// buildWeeklyPost: the AI path
// ---------------------------------------------------------------------------
const gemini = (text) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] }) });

// A compliant model reply: prose from the templates (every link and number
// is from the facts) with its own headlines and summaries.
function modelReply(overrides = {}) {
  const f = collectFacts(INPUT);
  return JSON.stringify({
    headline_en: "Waste complaints rise in Sector 45",
    headline_hi: "सेक्टर 45 में कचरे की शिकायतें बढ़ीं",
    summary_en: "Residents talked most about waste this week, with 7 mentions. Two official notices came in.",
    summary_hi: "इस हफ़्ते निवासियों ने सबसे ज़्यादा कचरे की बात की, 7 ज़िक्र। दो आधिकारिक सूचनाएँ आईं।",
    body_en: templateBodyEn(f),
    body_hi: templateBodyHi(f),
    ...overrides
  });
}

test("with a provider key one Gemini call writes both languages; links and numbers are checked against the facts", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return gemini(modelReply()); };
  const p = await buildWeeklyPost({ ...INPUT, env: { GEMINI_API_KEY: "g-key" }, fetchImpl });
  assert.equal(calls.length, 1, "one call");
  assert.ok(calls[0].url.startsWith("https://generativelanguage.googleapis.com/v1beta/models/gemini-"), calls[0].url);
  assert.ok(calls[0].url.endsWith("key=g-key"));
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.match(body.systemInstruction.parts[0].text, /non-partisan citizens' forum/);
  assert.match(body.systemInstruction.parts[0].text, /GMDA, MCG, DHBVN, HRERA/);
  assert.match(body.systemInstruction.parts[0].text, /Do not invent anything/);
  const facts = JSON.parse(body.contents[0].parts[0].text);
  assert.equal(facts.total_mentions, 14);
  assert.deepEqual(facts.topics.map((t) => t.issue_type), ["waste", "drains", "roads"]);
  assert.equal(facts.official_notices.length, 2);
  assert.equal(facts.forum_reports.total_so_far, 50);
  assert.ok(!JSON.stringify(facts).includes("javascript:"));
  assert.equal(p.ai, true);
  assert.equal(p.provider, "gemini");
  assert.equal(p.title, "Gurugram civic week, 28 September–4 October 2026: Waste complaints rise in Sector 45");
  assert.equal(p.title_hi, "गुरुग्राम नागरिक सप्ताह, 28 सितंबर–4 अक्टूबर 2026: सेक्टर 45 में कचरे की शिकायतें बढ़ीं");
  assert.equal(p.summary, "Residents talked most about waste this week, with 7 mentions. Two official notices came in.");
  assert.ok(p.body.endsWith(`<p class="disclosure"><em>${DISCLOSURE_EN}</em></p>`), "disclosure and closing are appended to the model's text too");
  assert.ok(p.body.includes('href="/report"') && p.body.includes('href="/guides"'));
  assert.equal(p.slug, "civic-week-2026-W41");
  assert.deepEqual(validatePost(p).errors, []);
});

test("a bad model reply, a foreign link or an invented number falls back to the templates", async () => {
  const cases = [
    ["not json", async () => gemini("Sure! Here is the post you asked for.")],
    ["foreign link", async () => gemini(modelReply({ body_en: templateBodyEn(collectFacts(INPUT)) + '<p>Also see <a href="https://evil.example/buy">this</a>.</p>' }))],
    ["invented number", async () => gemini(modelReply({ body_hi: templateBodyHi(collectFacts(INPUT)) + "<p>कुल 999 शिकायतें।</p>" }))],
    ["too short", async () => gemini(modelReply({ body_en: "<p>Short.</p>" }))],
    ["english where hindi was asked", async () => gemini(modelReply({ body_hi: templateBodyEn(collectFacts(INPUT)) }))],
    ["number in the headline", async () => gemini(modelReply({ headline_en: "Waste up 300 percent" }))],
    ["upstream error", async () => ({ ok: false, status: 503, json: async () => ({ error: { message: "busy" } }) })],
    ["network error", async () => { throw new Error("ECONNRESET"); }]
  ];
  for (const [name, fetchImpl] of cases) {
    const p = await buildWeeklyPost({ ...INPUT, env: { GROQ_API_KEY: "q" }, fetchImpl });
    assert.ok(p, name);
    assert.equal(p.ai, false, name);
    assert.equal(p.title, "Gurugram civic week, 28 September–4 October 2026: Waste tops the week's civic talk", name);
    assert.ok(!p.body.includes("evil.example") && !p.body_hi.includes("999"), name);
  }
  // No key: no call at all.
  let called = 0;
  const p = await buildWeeklyPost({ ...INPUT, env: {}, fetchImpl: async () => { called++; return gemini(modelReply()); } });
  assert.equal(called, 0);
  assert.equal(p.ai, false);
});

test("checkAiBody, allowedNumbers and allowedLinks guard the model's text", () => {
  const f = collectFacts(INPUT);
  const nums = allowedNumbers(f);
  for (const n of [0, 7, 12, 14, 9, 3, 4, 6, 45, 29, 28, 2026, 41, 50, 31]) assert.ok(nums.has(n), String(n));
  assert.ok(!nums.has(999));
  const links = allowedLinks(f);
  assert.ok(links.has("/report") && links.has("https://www.mcg.gov.in/notice/1") && links.has("/blog/ward-12-townhall-ab2cd") && links.has("/hi/blog/ward-12-townhall-ab2cd"));
  const good = templateBodyEn(f);
  assert.equal(typeof checkAiBody(good, f, "en"), "string");
  assert.equal(checkAiBody(good + '<a href="https://x.example/">x</a>', f, "en"), null);
  assert.equal(checkAiBody(good + "<p>1234 complaints</p>", f, "en"), null);
  assert.equal(checkAiBody(good + "<script>x()</script>", f, "en"), null);
  assert.equal(checkAiBody(good, f, "hi"), null, "no Devanagari");
  assert.equal(checkAiBody("<p>" + "x".repeat(19000) + "</p>", f, "en"), null, "too long");
  assert.equal(checkAiBody(null, f, "en"), null);
});

// ---------------------------------------------------------------------------
// Cron: settings, autopost step
// ---------------------------------------------------------------------------
test("loadSettings merges defaults with the site_settings rows and rejects nonsense", async () => {
  assert.deepEqual(await loadSettings(fakeSb()), { autopost: AUTOPOST_DEFAULTS, seo: SEO_DEFAULTS, topics: { enabled: true, per_week: 3 } });
  assert.deepEqual(AUTOPOST_DEFAULTS, { enabled: true, weekday: 1, review_hours: 48 });
  assert.deepEqual(SEO_DEFAULTS, { indexnow: true, gsc_verified: false, bing_verified: false });
  const s = await loadSettings(fakeSb({ tables: { site_settings: [{ key: "autopost", value: { enabled: false, weekday: 9, review_hours: -1 } }, { key: "seo", value: { indexnow: false } }, { key: "social", value: {} }] } }));
  assert.deepEqual(s, { autopost: { enabled: false, weekday: 1, review_hours: -1 }, seo: { indexnow: false, gsc_verified: false, bing_verified: false }, topics: { enabled: true, per_week: 3 } });
  await assert.rejects(loadSettings(fakeSb({ errors: { site_settings: "gone" } })), /site_settings select: gone/);
});

const weekTables = (extra = {}) => ({
  news_items: [{ title: NEWS[0].title, url: NEWS[0].url, published_at: NEWS[0].published_at, source_id: "mcg", news_sources: { name: "MCG" } }],
  posts: [],
  ...extra
});

test("autopost drafts once on the configured weekday, from the run's pulse, and mails the coordinator", async () => {
  const sb = fakeSb({ tables: weekTables(), counts: { reports: 49 } });
  const env = { COORDINATOR_EMAIL: "coord@example.org", SITE_URL: "https://gvf.test" };
  const r = await autopostStep(sb, env, { fetch: async () => ({ ok: false, status: 503 }), now: MONDAY, ctx: { insight: PULSE } });
  assert.deepEqual({ drafted: r.drafted, published: r.published, skipped: r.skipped, slug: r.slug, ai: r.ai }, { drafted: true, published: 0, skipped: null, slug: "civic-week-2026-W41", ai: false });
  const dup = sb.calls.queries.find((q) => q.table === "posts" && q.op === "select" && q.filters.some((f) => f[1] === "source"));
  assert.deepEqual(dup.filters, [["eq", "source", "auto:weekly:2026-W41"]]);
  assert.ok(!sb.calls.queries.some((q) => q.table === "insights"), "the pulse came from the run, not the table");
  const stats = sb.calls.queries.filter((q) => q.table === "reports");
  assert.equal(stats.length, 1, "under 50 reports the week's breakdown is not even read");
  assert.deepEqual(stats[0].opts, { count: "exact", head: true });
  const ins = sb.calls.queries.find((q) => q.table === "posts" && q.op === "insert");
  assert.equal(ins.row.kind, "news");
  assert.equal(ins.row.slug, "civic-week-2026-W41");
  assert.equal(ins.row.source, "auto:weekly:2026-W41");
  assert.equal(ins.row.published, false);
  assert.equal(ins.row.published_at, null);
  assert.equal(ins.row.created_by, "cron:autopost");
  assert.equal(ins.row.author, AUTHOR);
  assert.deepEqual(ins.row.tags, ["auto", "weekly", "waste", "drains", "roads"]);
  assert.ok(ins.row.body.includes("MCG notice: property tax rebate till 31 October") && ins.row.body.includes("— MCG"));
  assert.ok(!ins.row.body.includes("What the Forum received"));
  assert.ok(ins.row.body_hi.includes(DISCLOSURE_HI));
  assert.ok(!("ai" in ins.row) && !("week" in ins.row) && !("period" in ins.row), "only post columns are inserted");
  const mail = sb.calls.queries.find((q) => q.table === "outbox" && q.op === "insert");
  assert.equal(mail.row.kind, "autopost");
  assert.equal(mail.row.to_email, "coord@example.org");
  assert.equal(mail.row.subject, "Weekly round-up draft ready: Gurugram civic week, 28 September–4 October 2026: Waste tops the week's civic talk");
  assert.ok(mail.row.body_text.includes("https://gvf.test/desk"));
  assert.ok(mail.row.body_text.includes("It publishes on 2026-10-07 03:30 UTC unless held"));
});

test("autopost skips on other days, when disabled, when the week's post exists, when there is nothing to say, and without a fetch client", async () => {
  const fetchImpl = async () => ({ ok: false, status: 503 });
  let sb = fakeSb({ tables: weekTables() });
  let r = await autopostStep(sb, {}, { fetch: fetchImpl, now: TUESDAY, ctx: { insight: PULSE } });
  assert.deepEqual(r, { drafted: false, published: 0, skipped: "not_the_day" });
  assert.ok(!sb.calls.queries.some((q) => q.op === "insert"));

  sb = fakeSb({ tables: weekTables({ site_settings: [{ key: "autopost", value: { enabled: false } }] }) });
  r = await autopostStep(sb, {}, { fetch: fetchImpl, now: MONDAY, ctx: { insight: PULSE } });
  assert.equal(r.skipped, "disabled");

  sb = fakeSb({ tables: weekTables({ site_settings: [{ key: "autopost", value: { weekday: 2 } }] }) });
  r = await autopostStep(sb, {}, { fetch: fetchImpl, now: TUESDAY, ctx: { insight: PULSE } });
  assert.equal(r.drafted, true, "Tuesday when weekday is 2");

  sb = fakeSb({ tables: weekTables({ posts: (q) => (q.filters.some((f) => f[1] === "source") ? [{ id: "p1" }] : []) }) });
  r = await autopostStep(sb, { COORDINATOR_EMAIL: "c@x.org" }, { fetch: fetchImpl, now: MONDAY, ctx: { insight: PULSE } });
  assert.equal(r.skipped, "exists");
  assert.equal(r.drafted, false);
  assert.ok(!sb.calls.queries.some((q) => q.op === "insert"), "no second draft, no second mail");

  sb = fakeSb({ tables: { news_items: [], posts: [] } });
  r = await autopostStep(sb, {}, { fetch: fetchImpl, now: MONDAY, ctx: { insight: null } });
  assert.equal(r.skipped, "nothing_to_say");
  assert.ok(!sb.calls.queries.some((q) => q.op === "insert"));

  sb = fakeSb({ tables: weekTables() });
  r = await autopostStep(sb, {}, { now: MONDAY, ctx: { insight: PULSE } });
  assert.equal(r.skipped, "no_fetch");
});

test("autopost reads the latest stored insight when this run's insights step did not settle it", async () => {
  const sb = fakeSb({ tables: weekTables({ insights: [{ data: PULSE }] }) });
  const r = await autopostStep(sb, {}, { fetch: async () => ({ ok: false, status: 503 }), now: MONDAY, ctx: {} });
  assert.equal(r.drafted, true);
  const q = sb.calls.queries.find((x) => x.table === "insights");
  assert.deepEqual(q.filters, [["eq", "published", true]]);
  assert.equal(q.limit, 1);
  const ins = sb.calls.queries.find((x) => x.table === "posts" && x.op === "insert");
  assert.ok(ins.row.body.includes("<strong>Waste</strong>: 7 mentions"));
});

test("autopost includes the report counts once 50 reports exist", async () => {
  const sb = fakeSb({
    tables: weekTables({ reports: [{ stage: 0, issue_type: "waste" }, { stage: 2, issue_type: "waste" }, { stage: 2, issue_type: "drains" }] }),
    counts: { reports: 50 }
  });
  const r = await autopostStep(sb, {}, { fetch: async () => ({ ok: false, status: 503 }), now: MONDAY, ctx: { insight: PULSE } });
  assert.equal(r.drafted, true);
  const week = sb.calls.queries.find((q) => q.table === "reports" && !q.opts?.head);
  assert.equal(week.cols, "stage, issue_type");
  assert.deepEqual(week.filters, [["gte", "created_at", iso(MONDAY - 7 * 86400000)]]);
  const ins = sb.calls.queries.find((q) => q.table === "posts" && q.op === "insert");
  assert.ok(ins.row.body.includes("Residents sent the Forum 3 reports this week; 50 in all so far."));
  assert.ok(ins.row.body.includes("By stage: 1 received and 2 filed officially."));
  assert.ok(ins.row.body.includes("By issue: 2 garbage and 1 drains, flooding."), "issue labels come from the site's taxonomy");
  assert.ok(ins.row.body_hi.includes("विषय के अनुसार: 2 कचरा और 1 नाले, जलभराव।"));
  const counts = ins.row.body.slice(ins.row.body.indexOf("<h2>What the Forum received</h2>"), ins.row.body.indexOf("<h2>Suggested next steps</h2>"));
  assert.doesNotMatch(counts, /GVF-\d{4}-[A-Z2-9]{5}/, "the counts section carries no references");
  assert.ok(!/\+91\d{10}|\b[6-9]\d{9}\b|@/.test(counts.replace(/contact@gurugramvisionforum\.org/g, "")), "nor any contact detail");
});

test("autopost publishes drafts after the review window, honours the hold tag and review_hours -1 and 0", async () => {
  const drafts = [
    { id: "due", source: "auto:weekly:2026-W40", tags: ["auto", "weekly"], created_at: iso(TUESDAY - 49 * 3600000) },
    { id: "fresh", source: "auto:weekly:2026-W41", tags: ["auto", "weekly"], created_at: iso(TUESDAY - 47 * 3600000) },
    { id: "held", source: "auto:weekly:2026-W39", tags: ["auto", "weekly", "hold"], created_at: iso(TUESDAY - 200 * 3600000) },
    { id: "manual", source: "", tags: [], created_at: iso(TUESDAY - 500 * 3600000) }
  ];
  const tables = (settings) => ({ posts: (q) => (q.filters.some((f) => f[1] === "published" && f[2] === false) ? drafts : []), site_settings: settings ? [{ key: "autopost", value: settings }] : [] });
  let sb = fakeSb({ tables: tables() });
  let r = await autopostStep(sb, {}, { now: TUESDAY });
  assert.deepEqual(r, { drafted: false, published: 1, skipped: "not_the_day" });
  const ups = sb.calls.queries.filter((q) => q.table === "posts" && q.op === "update");
  assert.equal(ups.length, 1);
  assert.deepEqual(ups[0].filters, [["eq", "id", "due"]]);
  assert.deepEqual(ups[0].row, { published: true, published_at: iso(TUESDAY) });

  sb = fakeSb({ tables: tables({ review_hours: 24 }) });
  r = await autopostStep(sb, {}, { now: TUESDAY });
  assert.equal(r.published, 2, "a shorter window publishes the fresh one too; the held one never");
  assert.ok(!sb.calls.queries.some((q) => q.op === "update" && q.filters[0][2] === "held"));
  assert.ok(!sb.calls.queries.some((q) => q.op === "update" && q.filters[0][2] === "manual"));

  sb = fakeSb({ tables: tables({ review_hours: -1 }) });
  r = await autopostStep(sb, {}, { now: TUESDAY });
  assert.equal(r.published, 0);
  assert.ok(!sb.calls.queries.some((q) => q.table === "posts" && q.op === "update"), "-1 never auto-publishes");

  // 0: the draft is inserted already published, and the mail says so.
  sb = fakeSb({ tables: weekTables({ site_settings: [{ key: "autopost", value: { review_hours: 0 } }] }) });
  r = await autopostStep(sb, { COORDINATOR_EMAIL: "c@x.org" }, { fetch: async () => ({ ok: false, status: 503 }), now: MONDAY, ctx: { insight: PULSE } });
  assert.equal(r.drafted, true);
  assert.equal(r.published, 1);
  const ins = sb.calls.queries.find((q) => q.table === "posts" && q.op === "insert");
  assert.equal(ins.row.published, true);
  assert.equal(ins.row.published_at, iso(MONDAY));
  const mail = sb.calls.queries.find((q) => q.table === "outbox" && q.op === "insert");
  assert.ok(mail.row.body_text.includes("published immediately"));
  const never = autopostMail({ title: "T", summary: "S", week: "2026-W41" }, "c@x.org", { review_hours: -1 }, {}, MONDAY);
  assert.ok(never.body_text.includes("will not publish until someone on the desk publishes it"));
  assert.ok(never.body_text.includes("https://gurugramvisionforum.org/desk"));
});

test("autopost retries the slug once on a collision and reports a failed insert", async () => {
  let attempts = 0;
  const sb = fakeSb({ tables: weekTables() });
  const base = sb.from;
  sb.from = (table) => {
    const chain = base(table);
    if (table !== "posts") return chain;
    const insert = chain.insert;
    chain.insert = (row) => { insert(row); attempts++; const t = chain.then; chain.then = (res, rej) => t((v) => res(attempts === 1 ? { data: null, error: { code: "23505", message: "dup" } } : v), rej); return chain; };
    return chain;
  };
  const r = await autopostStep(sb, {}, { fetch: async () => ({ ok: false, status: 503 }), now: MONDAY, ctx: { insight: PULSE } });
  assert.equal(r.drafted, true);
  assert.equal(attempts, 2);
  assert.match(r.slug, /^civic-week-2026-w41-[a-z2-9]{5}$/);
  await assert.rejects(autopostStep(fakeSb({ tables: weekTables(), errors: { news_items: "boom" } }), {}, { fetch: async () => ({ ok: false }), now: MONDAY, ctx: { insight: PULSE } }), /news_items select: boom/);
});

// ---------------------------------------------------------------------------
// Cron: digest and IndexNow steps
// ---------------------------------------------------------------------------
const published = { id: "w41", slug: "civic-week-2026-W41", title: "Gurugram civic week: waste", title_hi: "गुरुग्राम नागरिक सप्ताह: कचरा", summary: "Waste led the week.", summary_hi: "कचरा सबसे आगे रहा।", tags: ["auto", "weekly", "waste"], source: "auto:weekly:2026-W41", published_at: iso(TUESDAY - 3600000), digest_sent_at: null };
const subscribers = [
  { id: 1, email: "a@example.org", lang: "en", token: "a".repeat(32), confirmed_at: "2026-09-01T00:00:00Z", unsubscribed_at: null },
  { id: 2, email: "b@example.org", lang: "hi", token: "b".repeat(32), confirmed_at: "2026-09-02T00:00:00Z", unsubscribed_at: null }
];

test("digest queues the published weekly post to confirmed subscribers once, in their language", async () => {
  const subsQuery = (q) => { // the fake applies the confirmed/unsubscribed filters the real query has
    assert.deepEqual(q.filters, [["not", "confirmed_at", "is", null], ["is", "unsubscribed_at", null]]);
    return subscribers;
  };
  const sb = fakeSb({ tables: { posts: [published, { ...published, id: "old", slug: "civic-week-2026-W40", published_at: iso(TUESDAY - 30 * 3600000) }, { ...published, id: "sent", slug: "civic-week-2026-W39", digest_sent_at: iso(TUESDAY) }, { id: "story", slug: "s", title: "Story", tags: [], published_at: iso(TUESDAY), digest_sent_at: null }], subscribers: subsQuery } });
  const r = await digestStep(sb, { SITE_URL: "https://gvf.test" }, { now: TUESDAY });
  assert.deepEqual(r, { posts: 1, queued: 2 });
  const ins = sb.calls.queries.filter((q) => q.table === "outbox" && q.op === "insert");
  assert.equal(ins.length, 1, "one batch");
  const rows = ins[0].row;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((x) => x.kind), ["digest", "digest"]);
  assert.equal(rows[0].to_email, "a@example.org");
  assert.equal(rows[0].subject, "Gurugram civic week: waste");
  assert.ok(rows[0].body_text.startsWith("Waste led the week.\n"));
  assert.ok(rows[0].body_text.includes("Read the round-up: https://gvf.test/blog/civic-week-2026-W41"));
  assert.ok(rows[0].body_text.includes(`Stop these emails: https://gvf.test/api/subscribe?unsubscribe=${"a".repeat(32)}`));
  assert.ok(rows[0].body_html.includes('href="https://gvf.test/blog/civic-week-2026-W41"'));
  assert.equal(rows[1].subject, "गुरुग्राम नागरिक सप्ताह: कचरा");
  assert.ok(rows[1].body_text.includes("पूरा सार पढ़ें: https://gvf.test/hi/blog/civic-week-2026-W41"));
  assert.ok(rows[1].body_text.includes(`unsubscribe=${"b".repeat(32)}`));
  const mark = sb.calls.queries.find((q) => q.table === "posts" && q.op === "update");
  assert.deepEqual(mark.filters, [["eq", "id", "w41"]]);
  assert.equal(mark.row.digest_sent_at, iso(TUESDAY));
  // Hindi falls back to English when the post has no Hindi.
  const m = digestMail({ ...published, title_hi: "", summary_hi: "" }, subscribers[1], {});
  assert.equal(m.subject, "Gurugram civic week: waste");
  assert.ok(m.body_text.includes("https://gurugramvisionforum.org/blog/civic-week-2026-W41"));
});

test("digest does nothing when the post was already mailed, there is no weekly post, or there are no confirmed subscribers", async () => {
  let sb = fakeSb({ tables: { posts: [{ ...published, digest_sent_at: iso(TUESDAY) }], subscribers } });
  assert.deepEqual(await digestStep(sb, {}, { now: TUESDAY }), { posts: 0, queued: 0 });
  assert.ok(!sb.calls.queries.some((q) => q.table === "subscribers"), "subscribers are not even read");
  sb = fakeSb({ tables: { posts: [], subscribers } });
  assert.deepEqual(await digestStep(sb, {}, { now: TUESDAY }), { posts: 0, queued: 0 });
  sb = fakeSb({ tables: { posts: [published], subscribers: [] } });
  assert.deepEqual(await digestStep(sb, {}, { now: TUESDAY }), { posts: 1, queued: 0 });
  assert.ok(!sb.calls.queries.some((q) => q.table === "outbox"));
  assert.ok(sb.calls.queries.some((q) => q.table === "posts" && q.op === "update"), "still marked, so it is not retried forever");
});

test("digest batches 200 rows per insert", async () => {
  const many = Array.from({ length: 450 }, (_, i) => ({ id: i + 1, email: `u${i}@example.org`, lang: "en", token: String(i).padStart(32, "0") }));
  const sb = fakeSb({ tables: { posts: [published], subscribers: (q) => many.slice(q.range[0], q.range[1] + 1) } });
  const r = await digestStep(sb, {}, { now: TUESDAY });
  assert.deepEqual(r, { posts: 1, queued: 450 });
  const ins = sb.calls.queries.filter((q) => q.table === "outbox" && q.op === "insert");
  assert.deepEqual(ins.map((q) => q.row.length), [200, 200, 50]);
  assert.equal(sb.calls.queries.filter((q) => q.table === "subscribers").length, 1, "one page of 1000 was enough");
});

test("indexnow pings the changed pages with the key and skips without a key, a client or the setting", async () => {
  assert.equal(siteUrl({}), "https://gurugramvisionforum.org");
  assert.equal(siteUrl({ SITE_URL: "https://gvf.test/" }), "https://gvf.test");
  assert.equal(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "gvf.vercel.app" }), "https://gvf.vercel.app");
  assert.deepEqual(cleanUrls(["https://gvf.test/a", "https://gvf.test/a", "https://other.test/b", "nope", 5], "https://gvf.test"), ["https://gvf.test/a"]);

  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 202 }; };
  const sb = fakeSb({ tables: { posts: [published] } });
  const r = await indexnowStep(sb, { INDEXNOW_KEY: "k123", SITE_URL: "https://gvf.test" }, { fetch: fetchImpl, now: TUESDAY });
  assert.deepEqual(r, { pinged: true, urls: 6, status: 202, skipped: null });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, INDEXNOW_URL);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json; charset=utf-8");
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body, {
    host: "gvf.test", key: "k123", keyLocation: "https://gvf.test/indexnow-key.txt",
    urlList: ["https://gvf.test/sitemap.xml", "https://gvf.test/pulse", "https://gvf.test/news", "https://gvf.test/blog", "https://gvf.test/blog/civic-week-2026-W41", "https://gvf.test/hi/blog/civic-week-2026-W41"]
  });

  assert.deepEqual(await indexnowStep(fakeSb(), {}, { fetch: fetchImpl, now: TUESDAY }), { pinged: false, urls: 0, status: 0, skipped: "no_key" });
  assert.deepEqual(await indexnowStep(fakeSb(), { INDEXNOW_KEY: "k" }, { now: TUESDAY }), { pinged: false, urls: 0, status: 0, skipped: "no_fetch" });
  const off = fakeSb({ tables: { site_settings: [{ key: "seo", value: { indexnow: false } }] } });
  assert.deepEqual(await indexnowStep(off, { INDEXNOW_KEY: "k" }, { fetch: fetchImpl, now: TUESDAY }), { pinged: false, urls: 0, status: 0, skipped: "disabled" });
  assert.equal(calls.length, 1, "no further calls");

  const bad = await indexnowStep(fakeSb(), { INDEXNOW_KEY: "k" }, { fetch: async () => ({ ok: false, status: 422 }), now: TUESDAY });
  assert.deepEqual(bad, { pinged: false, urls: 4, status: 422, skipped: "http_422" });
  const down = await pingIndexNow({ INDEXNOW_KEY: "k" }, ["https://gurugramvisionforum.org/"], async () => { throw new Error("ENOTFOUND"); });
  assert.deepEqual(down, { ok: false, status: 0, count: 1, error: "ENOTFOUND" });
  assert.deepEqual(await pingIndexNow({ INDEXNOW_KEY: "k" }, [], fetchImpl), { ok: true, status: 0, count: 0, skipped: "no_urls" });
});

test("runDaily runs autopost, digest and indexnow between insights and sla, with a fixed clock", async () => {
  const sb = fakeSb({ rpc: emptyRpc, tables: weekTables({ news_sources: [], insights: [{ data: PULSE }], posts: [] }) });
  const fetchImpl = async () => ({ ok: false, status: 503, text: async () => "", json: async () => null, body: null });
  const r = await runDaily(sb, { INDEXNOW_KEY: "k" }, { fetch: fetchImpl, now: MONDAY });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(Object.keys(r), ["ok", "news", "links", "signals", "insights", "autopost", "digest", "audience", "social", "indexnow", "sla", "brief", "outbox", "retention", "seo", "vitals", "mentions", "geo", "gsc", "bing", "topics"]);
  // The insights step saw no signals, so the autopost step had nothing from this run and did not reach for the table.
  assert.deepEqual(r.insights, { topics: 0, ai: false, stored: false });
  assert.equal(r.autopost.skipped, null);
  assert.equal(r.autopost.drafted, true, "notices alone are worth a post");
  assert.ok(!sb.calls.queries.some((q) => q.table === "insights" && q.op === "select"));
  assert.deepEqual(r.digest, { posts: 0, queued: 0 });
  assert.deepEqual(r.indexnow, { pinged: false, urls: 4, status: 503, skipped: "http_503" });
  const fin = sb.calls.queries.find((q) => q.table === "cron_runs" && q.op === "update");
  assert.deepEqual(fin.row.result.autopost, r.autopost);

  const quiet = fakeSb({ rpc: emptyRpc });
  const r2 = await runDaily(quiet, {});
  assert.equal(r2.ok, true);
  assert.deepEqual(r2.indexnow, { pinged: false, urls: 0, status: 0, skipped: "no_key" });
  assert.equal(r2.autopost.drafted, false);
});

// ---------------------------------------------------------------------------
// Desk settings: PUT /api/triage/content { settings: { autopost, seo } }
// ---------------------------------------------------------------------------
const okAuth = async () => ({ user: { id: "u" }, staff: { user_id: "u", name: "A", role: "owner", email: "a@b.co" } });

test("validateAutopost and validateSeo accept the documented shapes only", () => {
  assert.deepEqual(validateAutopost({ enabled: true, weekday: 3, review_hours: 24 }), { value: { enabled: true, weekday: 3, review_hours: 24 }, errors: [] });
  assert.deepEqual(validateAutopost({ enabled: "yes", weekday: 7, review_hours: 721 }).errors, ["enabled", "weekday", "review_hours"]);
  assert.deepEqual(validateAutopost({ weekday: -1 }).errors, ["weekday"]);
  assert.deepEqual(validateAutopost({ review_hours: -1 }), { value: { review_hours: -1 }, errors: [] });
  assert.deepEqual(validateAutopost({ review_hours: 0 }), { value: { review_hours: 0 }, errors: [] });
  assert.deepEqual(validateAutopost({ review_hours: 1.5 }).errors, ["review_hours"]);
  assert.deepEqual(validateAutopost({ review_hours: 720 }).errors, []);
  assert.deepEqual(validateAutopost(null), { value: {}, errors: [] });
  assert.deepEqual(validateSeo({ indexnow: false }), { value: { indexnow: false }, errors: [] });
  assert.deepEqual(validateSeo({ indexnow: "no" }).errors, ["indexnow"]);
});

test("PUT settings merges autopost and seo into site_settings and rejects bad values whole", async () => {
  const sb = fakeSb({ tables: { site_settings: (q) => (q.filters[0]?.[2] === "autopost" ? [{ value: { enabled: true, weekday: 1, review_hours: 48 } }] : []) } });
  const handler = makeContent({ auth: okAuth, sb });
  let res = fakeRes();
  await handler({ method: "PUT", body: { settings: { autopost: { weekday: 5, review_hours: 0 }, seo: { indexnow: false } } } }, res);
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().settings, { autopost: { enabled: true, weekday: 5, review_hours: 0 }, seo: { indexnow: false } });
  const ups = sb.calls.queries.filter((q) => q.table === "site_settings" && q.op === "upsert");
  assert.deepEqual(ups.map((q) => q.row.key), ["autopost", "seo"]);
  assert.deepEqual(ups[0].row.value, { enabled: true, weekday: 5, review_hours: 0 });
  assert.ok(ups[0].row.updated_at);

  const sb2 = fakeSb();
  res = fakeRes();
  await makeContent({ auth: okAuth, sb: sb2 })({ method: "PUT", body: { settings: { autopost: { weekday: 9 }, seo: { indexnow: true }, social: { x: "http://x.com/a" } } } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.json(), { ok: false, error: "invalid", fields: ["social.x", "autopost.weekday"] });
  assert.ok(!sb2.calls.queries.some((q) => q.op === "upsert"), "nothing written when any group is invalid");

  res = fakeRes();
  await makeContent({ auth: okAuth, sb: sb2 })({ method: "PUT", body: { settings: { other: {} } } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "empty");

  res = fakeRes();
  await makeContent({ auth: async () => { throw new HttpError(403, "forbidden"); }, sb: sb2 })({ method: "PUT", body: { settings: { seo: { indexnow: true } } } }, res);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { ok: false, error: "forbidden" });
});
