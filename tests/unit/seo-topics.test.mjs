import { test } from "node:test";
import assert from "node:assert/strict";
import { pickTopic, eligible, topicFacts, buildTopicPost, titleFor, checkIntro, pipelineState, topicsStep, topicSettings, isTopicPost, topicOf, MIN_DEMAND, PER_WEEK_DEFAULT, SOURCE_PREFIX, DISCLOSURE_EN } from "../../lib/seo/topics.js";
import { clusterHealth } from "../../lib/seo/clusters.js";
import { validatePost } from "../../lib/content.js";

const NOW = Date.UTC(2026, 9, 8, 21, 30);
const DAY = 86400000;
const iso = (d) => new Date(NOW - d * DAY).toISOString();
const sig = (issue, n, area = "Sector 45", source = "reddit") => Array.from({ length: n }, (_, i) => ({ issue_type: issue, title: `${issue} post ${i + 1} near ${area}`, url: `https://www.reddit.com/r/gurgaon/comments/${issue}${i}/`, source, area, posted_at: iso(i % 10) }));
const health = (signals, posts = []) => clusterHealth({ posts, signals, now: NOW, days: 14 });

test("eligible: gaps and stale clusters with real discussion, most discussed first, never the catch-all", () => {
  const h = health([...sig("waste", 9), ...sig("traffic", 4), ...sig("roads", 1), ...sig("other", 30)]);
  assert.equal(JSON.stringify(eligible(h).map((c) => c.id)), JSON.stringify(["waste", "traffic"]));
  assert.equal(h.find((c) => c.id === "other").demand, 0, "the catch-all carries no demand");
  assert.equal(h.find((c) => c.id === "roads").demand, 1);
  assert.ok(MIN_DEMAND >= 2);
});

test("pickTopic: the most discussed topic first, one per topic a month, at most per_week a week", () => {
  const h = health([...sig("waste", 9), ...sig("traffic", 4), ...sig("pollution", 3)]);
  assert.deepEqual(pickTopic(h, [], { now: NOW }), { id: "waste", reason: "gap" });
  const wastePost = { source: `${SOURCE_PREFIX}waste:2026-10-07`, created_at: iso(1) };
  assert.equal(pickTopic(h, [wastePost], { now: NOW }).id, "traffic", "waste was written this month");
  const three = ["waste", "traffic", "pollution"].map((id, i) => ({ source: `${SOURCE_PREFIX}${id}:x`, created_at: iso(i) }));
  assert.deepEqual(pickTopic(h, three, { now: NOW, perWeek: 3 }), { skipped: "weekly_limit" });
  const old = ["waste", "traffic", "pollution"].map((id) => ({ source: `${SOURCE_PREFIX}${id}:x`, created_at: iso(40) }));
  assert.equal(pickTopic(h, old, { now: NOW }).id, "waste", "a month later the topic can be written again");
  assert.deepEqual(pickTopic(health(sig("roads", 1)), [], { now: NOW }), { skipped: "nothing_to_write" });
  assert.equal(isTopicPost(wastePost), true); assert.equal(topicOf(wastePost), "waste"); assert.equal(isTopicPost({ source: "auto:weekly:2026-W41" }), false);
});

test("topicSettings: defaults, bounds", () => {
  assert.deepEqual(topicSettings(null), { enabled: true, per_week: PER_WEEK_DEFAULT });
  assert.deepEqual(topicSettings({ enabled: false, per_week: 2 }), { enabled: false, per_week: 2 });
  assert.deepEqual(topicSettings({ per_week: 50 }), { enabled: true, per_week: PER_WEEK_DEFAULT });
});

test("topicFacts and the template post: public posts, the guide's official facts, notices, links back to the guide and the report form", async () => {
  const signals = [...sig("waste", 6, "Sector 45"), ...sig("waste", 2, "DLF Phase 3", "news"), { issue_type: "waste", title: "Not https", url: "http://x", area: null, posted_at: iso(1), source: "news" }, { issue_type: "waste", title: "Too old", url: "https://x/old", posted_at: iso(30), source: "news" }];
  const news = [{ title: "MCG starts door-to-door garbage collection drive in sectors", url: "https://mcg.gov.in/notice/1", published_at: iso(3), source: "MCG" }, { title: "Power cut schedule", url: "https://dhbvn.org.in/n", published_at: iso(2), source: "DHBVN" }];
  const f = topicFacts("waste", { signals, news, now: NOW });
  assert.equal(f.count, 9, "the http post counts as discussion but is never linked; the old one is outside the window");
  assert.deepEqual(f.areas[0], { area: "Sector 45", n: 6 });
  assert.equal(f.examples.length, 5);
  assert.ok(f.examples.every((e) => e.url.startsWith("https://")));
  assert.equal(f.notices.length, 1, "only notices about the topic");
  assert.ok(f.agency && f.ladder.length);
  const post = await buildTopicPost("waste", { signals, news, now: NOW });
  assert.equal(post.ai, false);
  assert.equal(post.title, "Garbage in Gurugram, October 2026: what residents raised");
  assert.ok(post.title.length <= 70);
  assert.match(post.title_hi, /गुरुग्राम में .+, अक्टूबर 2026/);
  assert.deepEqual(post.tags, ["auto", "topic", "waste"]);
  assert.equal(post.slug, "waste-gurugram-2026-10");
  assert.equal(post.source, `${SOURCE_PREFIX}waste:2026-10-08`);
  assert.equal(post.kind, "story");
  for (const b of [post.body, post.body_hi]) {
    assert.match(b, /href="https:\/\/www\.reddit\.com\/r\/gurgaon\/comments\/waste0\/"/);
    assert.match(b, /href="\/report\/waste"/);
    assert.match(b, /href="https:\/\/mcg\.gov\.in\/notice\/1"/);
    assert.doesNotMatch(b, /dhbvn/i);
    assert.doesNotMatch(b, /http:\/\/x/);
  }
  assert.match(post.body, /href="\/guide\/waste"/);
  assert.match(post.body_hi, /href="\/hi\/guide\/waste"/);
  assert.ok(post.body.includes(DISCLOSURE_EN));
  assert.match(post.body_hi, /[ऀ-ॿ]/);
  assert.deepEqual(validatePost(post).errors, []);
  assert.equal(await buildTopicPost("waste", { signals: sig("waste", 1), news: [], now: NOW }), null, "one public post is not enough to write about");
  assert.equal(topicFacts("nope", { now: NOW }), null);
  assert.equal(titleFor({ ...f, label: "Illegal construction" }, "en").length <= 70, true);
});

test("the model writes only the opening paragraph, and only from the facts", async () => {
  const signals = sig("traffic", 5, "Golf Course Road");
  const f = topicFacts("traffic", { signals, now: NOW });
  const ok = "Residents posted 5 times in the last 14 days about traffic, most of it about Golf Course Road: jams at peak hours, signals that stay red and wrong-side driving near the junctions. The posts ask who is responsible and how to get it fixed.";
  assert.ok(checkIntro(ok, f, "en"));
  assert.equal(checkIntro(ok.replace("5 times", "500 times"), f, "en"), null, "a number not in the data");
  assert.equal(checkIntro(ok + " See https://x.com", f, "en"), null, "no links");
  assert.equal(checkIntro(ok, f, "hi"), null, "Hindi must be Hindi");
  const hi = "पिछले 14 दिनों में निवासियों ने गोल्फ़ कोर्स रोड पर ट्रैफ़िक के बारे में 5 पोस्ट लिखीं: व्यस्त समय में जाम, लंबे समय तक लाल रहने वाले सिग्नल और गलत दिशा में गाड़ी चलाना। लोग पूछ रहे हैं कि ज़िम्मेदार कौन है।";
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ intro_en: ok, intro_hi: hi }) }] } }] }) }; };
  const post = await buildTopicPost("traffic", { signals, news: [], env: { GEMINI_API_KEY: "k" }, fetchImpl, now: NOW });
  assert.equal(post.ai, true); assert.equal(calls, 1);
  assert.ok(post.body.startsWith("<p>Residents posted 5 times"));
  const bad = async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ intro_en: ok.replace("5 times", "77 times"), intro_hi: hi }) }] } }] }) });
  const fallback = await buildTopicPost("traffic", { signals, news: [], env: { GEMINI_API_KEY: "k" }, fetchImpl: bad, now: NOW });
  assert.equal(fallback.ai, false, "a checked-out intro falls back to the template");
  assert.match(fallback.body, /^<p>In the last 14 days Gurugram residents wrote 5 public posts/);
});

test("pipelineState: what the desk shows per cluster", () => {
  const h = health([...sig("waste", 9), ...sig("traffic", 4), ...sig("pollution", 3), ...sig("roads", 1)], [{ slug: "p", title: "Parks drive", tags: ["parks"], date: new Date(NOW - 5 * DAY) }]);
  const posts = [
    { slug: "waste-gurugram-2026-10", source: `${SOURCE_PREFIX}waste:2026-10-07`, tags: ["auto", "topic", "waste"], published: false, created_at: iso(1) },
    { slug: "traffic-gurugram-2026-10", source: `${SOURCE_PREFIX}traffic:2026-10-01`, tags: ["auto", "topic", "traffic"], published: true, published_at: iso(5), created_at: iso(7) }
  ];
  const s = pipelineState(h, posts, { now: NOW, perWeek: 3, reviewHours: 48 });
  assert.equal(s.waste.state, "draft"); assert.equal(s.waste.publish_at, new Date(NOW - DAY + 48 * 3600000).toISOString());
  assert.equal(s.traffic.state, "published");
  assert.deepEqual(s.pollution, { state: "queued", position: 1, eta_days: 0 });
  assert.equal(s.roads.state, "guide", "one public post: the guide covers it");
  assert.equal(s.parks.state, "covered");
  assert.equal(s.other.state, "guide");
  const held = pipelineState(h, [{ ...posts[0], tags: ["auto", "topic", "waste", "hold"] }], { now: NOW });
  assert.equal(held.waste.state, "held");
  assert.equal(pipelineState(h, [], { now: NOW, enabled: false }).waste.state, "off");
});

// A small Supabase stand-in for the step.
function fakeSb(tables = {}) {
  const writes = [];
  const sb = {
    writes,
    from(table) {
      const q = { table, rows: (tables[table] || []).slice() };
      const chain = {
        select() { return chain; }, gte() { return chain; }, order() { return chain; }, limit() { return chain; }, eq() { return chain; },
        insert(row) { writes.push({ table, row }); if (table === "posts") (tables.posts = tables.posts || []).push(row); return Promise.resolve({ error: null }); },
        then(ok, bad) { return Promise.resolve({ data: q.rows, error: null }).then(ok, bad); }
      };
      return chain;
    }
  };
  return sb;
}

test("topicsStep drafts one post, mails the coordinator, then respects the weekly limit", async () => {
  const tables = { signals: [...sig("waste", 9), ...sig("traffic", 4)], posts: [], news_items: [] };
  const sb = fakeSb(tables);
  const fetchImpl = async () => { throw new Error("no network in tests"); };
  const out = await topicsStep(sb, { COORDINATOR_EMAIL: "c@x" }, { fetch: fetchImpl, now: NOW, settings: { per_week: 1 }, reviewHours: 48 });
  assert.deepEqual([out.drafted, out.topic, out.slug, out.published, out.mentions], [true, "waste", "waste-gurugram-2026-10", false, 9]);
  const ins = sb.writes.find((w) => w.table === "posts").row;
  assert.equal(ins.published, false); assert.equal(ins.created_by, "cron:topics"); assert.equal(ins.author, "Gurugram Vision Forum data desk");
  const mail = sb.writes.find((w) => w.table === "outbox").row;
  assert.match(mail.subject, /^Topic post draft ready: Garbage in Gurugram/);
  assert.match(mail.body_text, /unless held/);
  tables.posts[0].created_at = new Date(NOW).toISOString();
  const again = await topicsStep(sb, {}, { fetch: fetchImpl, now: NOW + 3600000, settings: { per_week: 1 } });
  assert.equal(again.skipped, "weekly_limit");
  assert.equal((await topicsStep(fakeSb(), {}, { fetch: fetchImpl, settings: { enabled: false } })).skipped, "disabled");
  assert.equal((await topicsStep(fakeSb(), {}, {})).skipped, "no_fetch");
  assert.equal((await topicsStep(fakeSb({ signals: sig("roads", 1) }), {}, { fetch: fetchImpl, now: NOW })).skipped, "nothing_to_write");
});

test("desk settings: topics.enabled is a boolean and per_week 1 to 5", async () => {
  const { validateTopics } = await import("../../lib/handlers/triage/content.js");
  assert.deepEqual(validateTopics({ enabled: false, per_week: 2 }), { value: { enabled: false, per_week: 2 }, errors: [] });
  assert.deepEqual(validateTopics({ enabled: "yes", per_week: 9 }).errors, ["enabled", "per_week"]);
  assert.deepEqual(validateTopics({}), { value: {}, errors: [] });
});
