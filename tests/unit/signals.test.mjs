import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KEYWORDS, classify, extractArea, fetchReddit, fetchGoogleNews, computePulse, suggestActions,
  narrate, fallbackBrief, insightData, taxonomy, trendOf, newsSearchUrl, REDDIT_URLS, NEWS_QUERIES, sha1
} from "../../lib/signals.js";
import pulse from "../../lib/handlers/pulse.js";
import { makeHandler as makeInsights, clampLimit, ROLES } from "../../lib/handlers/triage/insights.js";
import { HttpError } from "../../lib/auth.js";
import { runDaily } from "../../lib/handlers/cron.js";

// ---------------------------------------------------------------------------
// Fakes: a Vercel-style response and a Supabase client that records every
// terminal query. Tables can be arrays or functions of the query.
// ---------------------------------------------------------------------------
function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: "" };
  res.status = (s) => { res.statusCode = s; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; return res; };
  res.end = (b) => { res.body = b || ""; };
  res.json = () => JSON.parse(res.body);
  return res;
}

function fakeSb({ tables = {}, errors = {}, rpc = {} } = {}) {
  const calls = { queries: [], rpc: [] };
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
      order(k, o) { q.order = [k, o]; return chain; },
      limit(n) { q.limit = n; return chain; },
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
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      }
    };
    return chain;
  };
  return {
    calls, from,
    rpc: async (name, args) => { calls.rpc.push([name, args]); const v = rpc[name]; return typeof v === "function" ? v(args) : { data: v ?? null, error: null }; },
    storage: { from: () => ({ list: async () => ({ data: [], error: null }) }) }
  };
}

const AREAS = taxonomy().areas;
const hoursAgo = (h, now = Date.now()) => new Date(now - h * 3600000).toISOString();

// ---------------------------------------------------------------------------
// classify
// ---------------------------------------------------------------------------
test("KEYWORDS cover every issue type except other, with Hindi in each", () => {
  const ids = taxonomy().cats.map((c) => c.id).filter((id) => id !== "other");
  for (const id of ids) assert.ok(Array.isArray(KEYWORDS[id]) && KEYWORDS[id].length >= 3, id);
  for (const id of ids) assert.ok(KEYWORDS[id].some((k) => /[ऀ-ॿ]/.test(k)), `${id} has no Hindi keyword`);
});

test("classify: English, with word boundaries and plurals", () => {
  assert.deepEqual(classify("Huge potholes on the service road near the mall"), { issue_type: "roads", score: 1 });
  assert.equal(classify("Garbage dump growing behind the market, sanitation is zero").issue_type, "waste");
  assert.equal(classify("Streetlights off for a week; dark stretch near the school").issue_type, "lights");
  assert.equal(classify("DHBVN power cut since morning, bijli nahi hai").issue_type, "power");
  assert.equal(classify("AQI 400, smog everywhere, GRAP stage 3").issue_type, "pollution");
  assert.equal(classify("Stray dog bite at the park gate").issue_type, "animals");
  assert.equal(classify("Property tax portal shows wrong dues").issue_type, "property");
  assert.equal(classify("Builder delaying possession, RERA complaint filed").issue_type, "housing");
  assert.equal(classify("Filed an RTI about the tender for the new flyover").issue_type, "rti");
  // "jam" is a whole word: "pajama" and "jammu" do not count as traffic.
  assert.deepEqual(classify("bought pajamas in jammu"), { issue_type: "other", score: 0 });
});

test("classify: Hindi and Hinglish", () => {
  assert.equal(classify("सेक्टर 31 में कचरा नहीं उठ रहा, गंदगी फैली है").issue_type, "waste");
  assert.equal(classify("सड़क पर बड़े गड्ढे हैं, कई लोग गिर चुके हैं").issue_type, "roads");
  assert.equal(classify("बारिश के बाद जलभराव, नाला जाम").issue_type, "drains");
  assert.equal(classify("sec 56 me jalbharav ho gaya, sewer overflow ka koi hal nahi").issue_type, "drains");
  assert.equal(classify("kooda uthane wale do din se nahi aaye").issue_type, "waste");
});

test("classify: nothing civic is other with score 0", () => {
  assert.deepEqual(classify("Best biryani in town?"), { issue_type: "other", score: 0 });
  assert.deepEqual(classify(""), { issue_type: "other", score: 0 });
  assert.deepEqual(classify(null), { issue_type: "other", score: 0 });
});

// ---------------------------------------------------------------------------
// extractArea
// ---------------------------------------------------------------------------
test("extractArea reads the sector forms and named areas, first mention wins", () => {
  assert.equal(extractArea("Potholes near Sector 45 market", AREAS), "Sector 45");
  assert.equal(extractArea("sec 45 ka haal bura hai", AREAS), "Sector 45");
  assert.equal(extractArea("waterlogging in sector-45 again", AREAS), "Sector 45");
  assert.equal(extractArea("Sec. 45 and sector 46 both", AREAS), "Sector 45");
  assert.equal(extractArea("सेक्टर 31 में कचरा", AREAS), "Sector 31");
  assert.equal(extractArea("Dogs in DLF Phase 3 again", AREAS), "DLF Phase 3");
  assert.equal(extractArea("dlf-3 roads are a mess", AREAS), "DLF Phase 3");
  assert.equal(extractArea("Jam at Sushant Lok-1 signal", AREAS), "Sushant Lok 1");
  assert.equal(extractArea("Palam Vihar then Sector 23", AREAS), "Palam Vihar");
  assert.equal(extractArea("Sector 23 then Palam Vihar", AREAS), "Sector 23");
  assert.equal(extractArea("South City 2 water", AREAS), "South City 2");
  assert.equal(extractArea("sector 450 is not a place; sector 4 is", AREAS), "Sector 4");
  assert.equal(extractArea("No area here", AREAS), null);
  assert.equal(extractArea("", AREAS), null);
  // Falls back to the site's own list when none is given.
  assert.equal(extractArea("Udyog Vihar traffic"), "Udyog Vihar");
});

// ---------------------------------------------------------------------------
// fetchReddit
// ---------------------------------------------------------------------------
const redditFixture = (children) => JSON.stringify({ kind: "Listing", data: { children: children.map((d) => ({ kind: "t3", data: d })) } });
const post = (o) => ({ author: "someuser", author_fullname: "t2_abc", subreddit: "gurgaon", ups: 3, score: 3, num_comments: 1, created_utc: 1759800000, selftext: "", ...o });

test("fetchReddit turns the public listing into signals and stores no author", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    if (url === REDDIT_URLS[0]) return { ok: true, status: 200, text: async () => redditFixture([
      post({ id: "a1", title: "Potholes on the road near Sector 45", selftext: "Been like this for months. " + "x".repeat(400), permalink: "/r/gurgaon/comments/a1/potholes/", ups: 12, num_comments: 4 }),
      post({ id: "a2", title: "Best momos in town?", ups: 2, num_comments: 1 }),
      post({ id: "a3", title: "Rant about everything", ups: 60, num_comments: 10 }),
      post({ id: "a4", title: "सेक्टर 31 में कचरा नहीं उठ रहा", permalink: "/r/gurgaon/comments/a4/x/" })
    ]) };
    return { ok: false, status: 429, text: async () => "" };
  };
  const out = await fetchReddit(fetchImpl, { areas: AREAS });
  assert.equal(seen.length, 2);
  assert.deepEqual(seen.map((s) => s.url), REDDIT_URLS);
  assert.match(seen[0].init.headers["User-Agent"], /GurugramVisionForumBot/);
  assert.deepEqual(out.map((s) => s.external_id), ["a1", "a3", "a4"]);
  const a1 = out[0];
  assert.equal(a1.source, "reddit");
  assert.equal(a1.title, "Potholes on the road near Sector 45");
  assert.equal(a1.snippet.length, 300);
  assert.equal(a1.url, "https://www.reddit.com/r/gurgaon/comments/a1/potholes/");
  assert.equal(a1.posted_at, new Date(1759800000 * 1000).toISOString());
  assert.equal(a1.issue_type, "roads");
  assert.equal(a1.area, "Sector 45");
  assert.equal(a1.score, 16);
  assert.equal(a1.lang, "en");
  assert.equal(out[1].issue_type, "other"); // kept only because it is popular
  assert.equal(out[2].issue_type, "waste");
  assert.equal(out[2].lang, "hi");
  assert.equal(out[2].snippet, null);
  for (const s of out) {
    assert.ok(!("author" in s) && !("author_fullname" in s), "author must not be stored");
    assert.ok(!JSON.stringify(s).includes("someuser"));
  }
});

test("fetchReddit tolerates 429/403, bad JSON and network errors", async () => {
  assert.deepEqual(await fetchReddit(async () => ({ ok: false, status: 403, text: async () => "" })), []);
  assert.deepEqual(await fetchReddit(async () => ({ ok: true, status: 200, text: async () => "<html>blocked</html>" })), []);
  assert.deepEqual(await fetchReddit(async () => { throw new Error("ECONNRESET"); }), []);
});

// ---------------------------------------------------------------------------
// fetchGoogleNews
// ---------------------------------------------------------------------------
const RSS = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Search</title>${items.map((i) =>
  `<item><title>${i.title}</title><link>${i.link}</link><guid>${i.link}</guid><pubDate>${i.date || "Mon, 06 Oct 2026 08:00:00 GMT"}</pubDate><source url="https://example.news">Example</source></item>`).join("")}</channel></rss>`;

test("fetchGoogleNews queries each search feed and dedupes by url", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url === newsSearchUrl("Gurugram civic")) return { ok: true, status: 200, text: async () => RSS([
      { title: "Waterlogging chokes Sector 29 after night rain - Example", link: "https://news.google.com/rss/articles/one" },
      { title: "MCG plans garbage drive in DLF Phase 2 - Example", link: "https://news.google.com/rss/articles/two" }
    ]) };
    if (url === newsSearchUrl("Gurgaon waterlogging")) return { ok: true, status: 200, text: async () => RSS([
      { title: "Waterlogging chokes Sector 29 after night rain - Example", link: "https://news.google.com/rss/articles/one" }
    ]) };
    return { ok: false, status: 503, text: async () => "" };
  };
  const out = await fetchGoogleNews(fetchImpl, { areas: AREAS });
  assert.equal(urls.length, NEWS_QUERIES.length);
  assert.ok(urls[0].includes("hl=en-IN&gl=IN&ceid=IN:en"));
  assert.equal(out.length, 2);
  assert.equal(out[0].source, "news");
  assert.equal(out[0].external_id, sha1("https://news.google.com/rss/articles/one"));
  assert.equal(out[0].issue_type, "drains");
  assert.equal(out[0].area, "Sector 29");
  assert.equal(out[0].snippet, out[0].title);
  assert.equal(out[0].score, 5);
  assert.equal(out[0].posted_at, "2026-10-06T08:00:00.000Z");
  assert.equal(out[1].issue_type, "waste");
  assert.equal(out[1].area, "DLF Phase 2");
});

// ---------------------------------------------------------------------------
// computePulse
// ---------------------------------------------------------------------------
const NOW = Date.parse("2026-10-07T06:00:00Z");
const sig = (o) => ({ source: "reddit", title: "t", url: "https://www.reddit.com/x", score: 1, area: null, issue_type: "other", ...o });

test("computePulse groups the week's signals into sorted topics with areas, examples and trend", () => {
  const rows = [
    sig({ issue_type: "waste", posted_at: hoursAgo(5, NOW), area: "Sector 45", score: 30, title: "Garbage A", source: "reddit" }),
    sig({ issue_type: "waste", posted_at: hoursAgo(30, NOW), area: "Sector 45", score: 5, title: "Garbage B", source: "news", url: "https://news.example/b" }),
    sig({ issue_type: "waste", posted_at: hoursAgo(50, NOW), area: "DLF Phase 2", score: 10, title: "Waste, DLF Phase 2", source: "news", url: "https://news.example/dlf" }),
    sig({ issue_type: "waste", posted_at: hoursAgo(70, NOW), area: null, score: 2, title: "Garbage D" }),
    sig({ issue_type: "waste", posted_at: hoursAgo(90, NOW), area: null, score: 8, title: "Garbage E" }),
    sig({ issue_type: "waste", posted_at: hoursAgo(100, NOW), area: null, score: 1, title: "Garbage F" }),
    sig({ issue_type: "drains", posted_at: hoursAgo(20, NOW), area: "Sector 29", score: 3 }),
    sig({ issue_type: "drains", posted_at: hoursAgo(21, NOW), area: "Sector 29", score: 3 }),
    sig({ issue_type: "roads", posted_at: hoursAgo(10, NOW), score: 1 }),
    // previous period
    sig({ issue_type: "waste", posted_at: hoursAgo(24 * 9, NOW) }),
    sig({ issue_type: "roads", posted_at: hoursAgo(24 * 8, NOW) }),
    sig({ issue_type: "roads", posted_at: hoursAgo(24 * 10, NOW) }),
    sig({ issue_type: "roads", posted_at: hoursAgo(24 * 11, NOW) }),
    sig({ issue_type: "drains", posted_at: hoursAgo(24 * 12, NOW) }),
    sig({ issue_type: "drains", posted_at: hoursAgo(24 * 13, NOW) }),
    // too old for either window
    sig({ issue_type: "lights", posted_at: hoursAgo(24 * 20, NOW) })
  ];
  const p = computePulse(rows, { days: 7, prev: 7, now: NOW });
  assert.deepEqual(p.period, { from: "2026-09-30T06:00:00.000Z", to: "2026-10-07T06:00:00.000Z" });
  assert.equal(p.total, 9);
  assert.equal(p.previous_total, 6);
  assert.deepEqual(p.sources_checked, ["reddit", "news"]);
  assert.deepEqual(p.topics.map((t) => [t.issue_type, t.count, t.trend]), [["waste", 6, "up"], ["drains", 2, "flat"], ["roads", 1, "down"]]);
  const w = p.topics[0];
  assert.equal(w.label, "Garbage");
  assert.equal(w.label_hi, "कचरा");
  assert.deepEqual(w.by_source, { reddit: 4, news: 2 });
  assert.deepEqual(w.areas, [{ area: "Sector 45", n: 2 }, { area: "DLF Phase 2", n: 1 }]);
  assert.equal(w.examples.length, 5);
  assert.deepEqual(w.examples[0], { title: "Garbage A", url: "https://www.reddit.com/x", source: "reddit", posted_at: hoursAgo(5, NOW) });
  assert.deepEqual(w.examples.map((e) => e.title), ["Garbage A", "Waste, DLF Phase 2", "Garbage E", "Garbage B", "Garbage D"]);
  assert.equal(w.examples[1].url, "https://news.example/dlf");
  assert.equal(w.previous, 1);
});

test("computePulse on nothing gives an empty pulse; trendOf needs a real change", () => {
  const p = computePulse([], { now: NOW });
  assert.deepEqual(p.topics, []);
  assert.equal(p.total, 0);
  assert.equal(trendOf(3, 2), "flat");
  assert.equal(trendOf(2, 0), "up");
  assert.equal(trendOf(0, 2), "down");
  assert.equal(trendOf(10, 9), "flat");
  assert.equal(trendOf(12, 9), "up");
});

// ---------------------------------------------------------------------------
// suggestActions and narrate
// ---------------------------------------------------------------------------
const topicsFixture = () => computePulse([
  sig({ issue_type: "waste", posted_at: hoursAgo(5, NOW), area: "Sector 45" }), sig({ issue_type: "waste", posted_at: hoursAgo(6, NOW), area: "Sector 45" }),
  sig({ issue_type: "drains", posted_at: hoursAgo(7, NOW), area: "Sector 29" }),
  sig({ issue_type: "roads", posted_at: hoursAgo(8, NOW) }),
  sig({ issue_type: "animals", posted_at: hoursAgo(9, NOW) }),
  sig({ issue_type: "power", posted_at: hoursAgo(10, NOW) }),
  sig({ issue_type: "lights", posted_at: hoursAgo(11, NOW) }),
  sig({ issue_type: "zzz-unknown", posted_at: hoursAgo(12, NOW) })
], { now: NOW });

test("suggestActions maps the top five topics to a drive, camp or clinic", () => {
  const p = topicsFixture();
  const a = suggestActions(p.topics);
  assert.equal(a.length, 5);
  assert.deepEqual(a[0], { issue_type: "waste", action: "Sector cleaning drive with MCG's sanitation wing", why: "2 mentions this week, rising; most about Sector 45", who: "MCG sanitation wing, sector RWA", when: "this week" });
  assert.equal(a[1].action, "Sterilisation and vaccination camp with the MCG veterinary wing"); // equal counts sort by id
  assert.equal(a[2].action, "Pre-monsoon drain walk and townhall with GMDA/MCG engineers");
  assert.ok(a.every((x) => x.issue_type && x.action && x.why && x.who && x.when));
  assert.deepEqual(suggestActions([{ issue_type: "nope", count: 1, trend: "flat", areas: [] }])[0].action, "Listening session in the most-mentioned area");
  assert.deepEqual(suggestActions([]), []);
});

test("narrate falls back to the rule-based brief without a provider and never touches the network", async () => {
  const p = topicsFixture();
  let called = false;
  const b = await narrate({}, p, async () => { called = true; throw new Error("no"); });
  assert.equal(called, false);
  assert.equal(b.ai, false);
  assert.equal(b.provider, null);
  assert.equal(b.summary_en, "This week residents talked most about garbage (2), stray animals (1) and drains, flooding (1), across 8 public posts, news items and reports.");
  assert.match(b.summary_hi, /इस हफ़्ते निवासियों ने सबसे ज़्यादा कचरा \(2\)/);
  assert.equal(b.headline_en, "Garbage top the week's civic talk");
  assert.equal(b.actions.length, 5);
  assert.deepEqual(Object.keys(b.actions[0]).sort(), ["issue_type", "title", "when", "where", "who", "why"]);
  assert.equal(b.actions[0].where, "Sector 45");
  assert.equal(b.actions[1].where, "across Gurugram");
  assert.equal(b.actions[2].where, "Sector 29");
  assert.deepEqual(fallbackBrief(computePulse([], { now: NOW })).actions, []);
});

test("narrate uses the AI brief when a provider answers, and falls back when it fails", async () => {
  const p = topicsFixture();
  const reply = { headline_en: "Garbage piles up in Sector 45", headline_hi: "सेक्टर 45 में कचरे का ढेर", summary_en: "Waste led the week.", summary_hi: "कचरा सबसे आगे रहा।",
    actions: [{ title: "Cleaning drive", why: "2 mentions", where: "Sector 45", when: "Saturday", issue_type: "waste" }, { title: "Odd", issue_type: "not-a-type" }] };
  let body;
  const fetchImpl = async (url, init) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(reply) }, finish_reason: "stop" }], model: "llama-3.3-70b-versatile" }) }; };
  const b = await narrate({ GROQ_API_KEY: "gsk-free" }, p, fetchImpl);
  assert.equal(b.ai, true);
  assert.equal(b.provider, "groq");
  assert.equal(b.headline_en, "Garbage piles up in Sector 45");
  assert.equal(b.actions.length, 2);
  assert.equal(b.actions[1].issue_type, "other");
  assert.match(body.messages[0].content, /non-partisan|never mention a political party/i);
  assert.ok(!body.messages[1].content.includes("someuser"));

  const failed = await narrate({ GROQ_API_KEY: "gsk-free" }, p, async () => ({ ok: false, status: 429, json: async () => ({ error: "rate" }) }));
  assert.equal(failed.ai, false);
  assert.equal(failed.actions.length, 5);
  const garbage = await narrate({ GROQ_API_KEY: "gsk-free" }, p, async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "not json" } }] }) }));
  assert.equal(garbage.ai, false);
});

// ---------------------------------------------------------------------------
// GET /api/pulse
// ---------------------------------------------------------------------------
test("pulse handler returns the latest insight's data with generated_at, cached", async () => {
  const p = topicsFixture();
  const data = insightData(p, fallbackBrief(p));
  const sb = fakeSb({ tables: { insights: [{ generated_at: "2026-10-07T06:05:00Z", period_start: p.period.from, period_end: p.period.to, data }] } });
  const res = fakeRes();
  await pulse({ method: "GET", query: {} }, res, sb);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Cache-Control"], "public, max-age=600");
  const j = res.json();
  assert.equal(j.ok, true);
  assert.deepEqual(Object.keys(j.pulse), ["generated_at", "period", "headline_en", "headline_hi", "summary_en", "summary_hi", "total", "sources_checked", "topics", "actions", "ai"]);
  assert.equal(j.pulse.generated_at, "2026-10-07T06:05:00Z");
  assert.equal(j.pulse.topics[0].issue_type, "waste");
  assert.equal(j.pulse.topics[0].examples[0].url, "https://www.reddit.com/x");
  assert.equal(j.pulse.actions.length, 5);
  assert.equal(j.pulse.ai, false);
  const q = sb.calls.queries[0];
  assert.equal(q.table, "insights");
  assert.deepEqual(q.filters, [["eq", "published", true]]);
  assert.deepEqual(q.order, ["generated_at", { ascending: false }]);
});

test("pulse handler gives pulse: null when nothing is stored, 500 on a DB error, 405 on POST", async () => {
  let res = fakeRes();
  await pulse({ method: "GET" }, res, fakeSb());
  assert.deepEqual(res.json(), { ok: true, pulse: null });
  res = fakeRes();
  await pulse({ method: "GET" }, res, fakeSb({ errors: { insights: "relation missing" } }));
  assert.equal(res.statusCode, 500);
  res = fakeRes();
  await pulse({ method: "POST" }, res, fakeSb());
  assert.equal(res.statusCode, 405);
});

// ---------------------------------------------------------------------------
// GET /api/triage/insights
// ---------------------------------------------------------------------------
const okAuth = (role) => async (req, roles) => { if (!roles.includes(role)) throw new HttpError(403, "forbidden"); return { user: { id: "u" }, staff: { user_id: "u", name: "A", role, email: "a@b.co" } }; };

test("insights handler lists insights and the top signals of the week for the allowed roles", async () => {
  assert.deepEqual(ROLES, ["owner", "coordinator", "content"]);
  const sb = fakeSb({ tables: {
    insights: [{ id: 2, generated_at: "2026-10-07T06:05:00Z", period_start: "a", period_end: "b", data: { total: 3 }, published: true }],
    signals: [{ id: 1, source: "reddit", external_id: "a1", title: "Potholes", snippet: null, url: "https://www.reddit.com/x", posted_at: hoursAgo(2), fetched_at: hoursAgo(1), issue_type: "roads", area: "Sector 45", ward: null, score: 16, lang: "en" }]
  } });
  for (const role of ["owner", "coordinator", "content"]) {
    const res = fakeRes();
    await makeInsights({ auth: okAuth(role) })({ method: "GET", query: { limit: "50" } }, res, sb);
    assert.equal(res.statusCode, 200, role);
    const j = res.json();
    assert.equal(j.ok, true);
    assert.equal(j.limit, 12);
    assert.equal(j.insights.length, 1);
    assert.equal(j.signals.length, 1);
    assert.equal(j.signals[0].title, "Potholes");
    assert.ok(j.since);
    assert.equal(res.headers["Cache-Control"], "no-store");
  }
  const sq = sb.calls.queries.find((q) => q.table === "signals");
  assert.equal(sq.filters[0][0], "gte");
  assert.equal(sq.filters[0][1], "posted_at");
  assert.deepEqual(sq.order, ["score", { ascending: false }]);
  assert.equal(sq.limit, 100);
  const iq = sb.calls.queries.find((q) => q.table === "insights");
  assert.equal(iq.limit, 12);
  assert.equal(clampLimit(undefined), 6);
  assert.equal(clampLimit("0"), 1);
});

test("insights handler refuses triage volunteers and the signed-out", async () => {
  const sb = fakeSb();
  let res = fakeRes();
  await makeInsights({ auth: okAuth("triage") })({ method: "GET", query: {} }, res, sb);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { ok: false, error: "forbidden" });
  res = fakeRes();
  await makeInsights({ auth: async () => { throw new HttpError(401, "unauthenticated"); } })({ method: "GET", query: {} }, res, sb);
  assert.equal(res.statusCode, 401);
  assert.equal(sb.calls.queries.length, 0);
  res = fakeRes();
  await makeInsights({ auth: okAuth("owner") })({ method: "POST" }, res, sb);
  assert.equal(res.statusCode, 405);
});

// ---------------------------------------------------------------------------
// Cron steps
// ---------------------------------------------------------------------------
test("runDaily skips the signals and insights steps without a fetch client", async () => {
  const sb = fakeSb({ rpc: { sla_digest: { unmapped: [], filed_overdue: [] }, retention_sweep: { deleted: 0, refs: [] } } });
  const r = await runDaily(sb, {});
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.signals, { reddit: 0, news: 0, new: 0, skipped: true });
  assert.deepEqual(r.insights, { topics: 0, ai: false, stored: false, skipped: true });
  assert.ok(!sb.calls.queries.some((q) => q.table === "signals" || q.table === "insights"));
});

test("runDaily scans reddit, news and reports into signals, cleans up and stores an insight", async () => {
  const reports = [{ ref: "GVF-2026-ABC23", issue_type: "drains", area: "Sector 29", ward: 12, created_at: hoursAgo(3) }];
  const stored = [];
  const sb = fakeSb({
    rpc: { sla_digest: { unmapped: [], filed_overdue: [] }, retention_sweep: { deleted: 0, refs: [] } },
    tables: {
      reports,
      signals: (q) => (q.op === "select" ? stored : []),
      news_sources: [{ id: "x", name: "X", url: null, type: "none", enabled: true }]
    }
  });
  const fetchImpl = async (url) => {
    if (url === REDDIT_URLS[0]) return { ok: true, status: 200, text: async () => redditFixture([post({ id: "r1", title: "Garbage not lifted in Sector 45 for a week", permalink: "/r/gurgaon/comments/r1/x/", ups: 20, num_comments: 5, created_utc: Math.floor(Date.now() / 1000) - 3600 })]) };
    if (url === REDDIT_URLS[1]) return { ok: false, status: 429, text: async () => "" };
    if (url === newsSearchUrl("Gurugram garbage")) return { ok: true, status: 200, text: async () => RSS([{ title: "Garbage piles up in Sector 45 - Example", link: "https://news.google.com/rss/articles/g1", date: new Date(Date.now() - 7200000).toUTCString() }]) };
    if (url.startsWith("https://news.google.com/")) return { ok: false, status: 503, text: async () => "" };
    return { status: 200, body: null }; // link checks
  };
  // The signals the insights step reads back are the ones the signals step wrote.
  const origThen = sb.from;
  const r = await runDaily(sb, {}, { fetch: fetchImpl });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.signals, { reddit: 1, news: 1, new: 2 });
  const up = sb.calls.queries.find((q) => q.table === "signals" && q.op === "upsert");
  assert.deepEqual(up.opts, { onConflict: "source,external_id", ignoreDuplicates: true });
  assert.deepEqual(up.row.map((s) => s.source), ["reddit", "news"]);
  assert.ok(up.row.every((s) => !("author" in s)));
  const del = sb.calls.queries.find((q) => q.table === "signals" && q.op === "delete");
  assert.equal(del.filters[0][0], "lt");
  assert.equal(del.filters[0][1], "fetched_at");
  assert.ok(!sb.calls.queries.some((q) => q.table === "reports"), "the pulse never reads the Forum's reports");
  // The empty signals table gives no insight to store.
  assert.deepEqual(r.insights, { topics: 0, ai: false, stored: false });
  assert.ok(!sb.calls.queries.some((q) => q.table === "insights"));
  void origThen;
});

test("runDaily stores the insight when the week has signals, rule-based without a provider", async () => {
  const now = Date.now();
  const stored = [
    { source: "reddit", title: "Garbage not lifted in Sector 45", url: "https://www.reddit.com/r/gurgaon/comments/r1/x/", posted_at: hoursAgo(1, now), fetched_at: hoursAgo(1, now), issue_type: "waste", area: "Sector 45", score: 25 },
    { source: "reports", title: "Drains, flooding, Sector 29", url: "https://gurugramvisionforum.org/#/r/GVF-2026-ABC23", posted_at: hoursAgo(3, now), fetched_at: hoursAgo(1, now), issue_type: "drains", area: "Sector 29", score: 10 },
    { source: "news", title: "Old news", url: "https://news.example/old", posted_at: hoursAgo(24 * 9, now), fetched_at: hoursAgo(24 * 9, now), issue_type: "waste", area: null, score: 5 }
  ];
  const sb = fakeSb({ rpc: { sla_digest: { unmapped: [], filed_overdue: [] }, retention_sweep: { deleted: 0, refs: [] } }, tables: { signals: (q) => (q.op === "select" ? stored : []), news_sources: [] } });
  const r = await runDaily(sb, {}, { fetch: async () => ({ ok: false, status: 503, text: async () => "", body: null }) });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.insights, { topics: 2, ai: false, stored: true });
  const ins = sb.calls.queries.find((q) => q.table === "insights" && q.op === "insert");
  assert.equal(ins.row.published, true);
  assert.equal(ins.row.data.total, 2);
  assert.deepEqual(ins.row.data.topics.map((t) => [t.issue_type, t.count, t.trend]), [["drains", 1, "flat"], ["waste", 1, "flat"]]);
  assert.equal(ins.row.data.actions.length, 2);
  assert.equal(ins.row.data.ai, false);
  assert.match(ins.row.data.summary_en, /^This week residents talked most about/);
  assert.equal(ins.row.period_start, ins.row.data.period.from);
});

test("the unclassified bucket ranks last and stays out of the headline and actions", () => {
  const now = Date.parse("2026-10-07T06:00:00Z");
  const mk = (issue_type, n) => Array.from({ length: n }, (_, i) => ({ source: "news", title: `${issue_type} item ${i}`, url: `https://n.example/${issue_type}/${i}`, posted_at: new Date(now - 3600000).toISOString(), fetched_at: new Date(now - 1800000).toISOString(), issue_type, area: null, score: 5 }));
  const pulse = computePulse([...mk("other", 21), ...mk("waste", 18), ...mk("traffic", 7)], { days: 7, prev: 7, now });
  assert.deepEqual(pulse.topics.map((t) => t.issue_type), ["waste", "traffic", "other"]);
  const brief = fallbackBrief(pulse);
  assert.match(brief.headline_en, /^Garbage/);
  assert.ok(!brief.actions.some((a) => a.issue_type === "other"), "no action for the unclassified bucket while named topics exist");
  const onlyOther = computePulse(mk("other", 3), { days: 7, prev: 7, now });
  assert.equal(fallbackBrief(onlyOther).actions.length, 1);
});
