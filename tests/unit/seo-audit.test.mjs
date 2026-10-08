import { test } from "node:test";
import assert from "node:assert/strict";
import { pageList, auditHtml, scoreOf, duplicates, parseVitals, sourceOf, opportunities, checklist, seoStep, vitalsStep, mentionsStep, RULES, ISSUE_TEXT, VITALS_PAGES } from "../../lib/seo/audit.js";
import { makeHandler, summarise, activityOf, lastVitalsReason, ROLES } from "../../lib/handlers/triage/seo.js";
import { renderGuide } from "../../lib/seo/guides.js";
import { renderWard, wardById } from "../../lib/seo/wards.js";
import { gvf } from "../../lib/site-data.js";
import { HttpError, CONTENT_ROLES } from "../../lib/auth.js";
import { runDaily, STEP_GROUPS, STEP_NAMES } from "../../lib/handlers/cron.js";

const SITE = "https://gurugramvisionforum.org";
const GOOD = (over = {}) => {
  const o = { title: "Roads, footpaths in Gurugram: who fixes it, how to complain", desc: "A guide to reporting potholes and broken roads in Gurugram to the right authority, with the portal, the fields it asks for and the timelines.", url: `${SITE}/guide/roads`, hi: `${SITE}/hi/guide/roads`, lang: "en", h1: "<h1>Who fixes roads, footpaths in Gurugram: how to complain</h1>", ld: '<script type="application/ld+json">{"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Who fixes roads?","acceptedAnswer":{"@type":"Answer","text":"GMDA and MCG."}}]}</script>', og: '<meta property="og:title" content="x"><meta property="og:description" content="y"><meta property="og:image" content="z">', viewport: '<meta name="viewport" content="width=device-width">', words: 200, links: '<a href="/a">a</a><a href="/b">b</a><a href="/guides">c</a>', ...over };
  return `<html lang="${o.lang}"><head><title>${o.title}</title><meta name="description" content="${o.desc}"><link rel="canonical" href="${o.url}"><link rel="alternate" hreflang="en-IN" href="${SITE}/guide/roads"><link rel="alternate" hreflang="hi-IN" href="${o.hi}"><link rel="alternate" hreflang="x-default" href="${SITE}/guide/roads">${o.og}${o.viewport}${o.ld}</head><body>${o.h1}<p>${"word ".repeat(o.words)}</p>${o.links}${o.extra || ""}</body></html>`;
};

test("pageList mirrors the sitemap: app routes, guides, wards and posts in both languages", () => {
  const list = pageList([{ slug: "monsoon" }, { slug: null }], SITE);
  const cats = (gvf().CATS || []).length;
  assert.equal(list.length, 13 + 2 + cats * 2 + 36 * 2 + 2 + 2);
  assert.deepEqual(list[0], { url: `${SITE}/`, path: "/", kind: "app", lang: "en" });
  assert.ok(list.some((p) => p.url === `${SITE}/hi/guide/roads` && p.kind === "guide" && p.lang === "hi"));
  assert.ok(list.some((p) => p.url === `${SITE}/ward/36` && p.kind === "ward"));
  assert.ok(list.some((p) => p.url === `${SITE}/hi/blog/monsoon` && p.kind === "blog" && p.lang === "hi"));
  assert.equal(new Set(list.map((p) => p.url)).size, list.length, "no duplicate URLs");
});

test("auditHtml: a well-formed guide page scores 100 with the facts recorded", () => {
  const r = auditHtml(GOOD(), { url: `${SITE}/guide/roads`, lang: "en", kind: "guide" });
  assert.deepEqual(r.issues, []);
  assert.equal(r.score, 100);
  assert.equal(r.words, 212);
  assert.deepEqual(r.facts.schema, ["FAQPage"]);
  assert.equal(r.facts.canonical, `${SITE}/guide/roads`);
  assert.equal(r.facts.internal_links, 3);
  assert.equal(r.facts.og, true);
});

test("auditHtml: each consultant rule fires with the right level", () => {
  const codes = (html, o) => auditHtml(html, { url: `${SITE}/guide/roads`, lang: "en", kind: "guide", ...o }).issues.map((i) => i.code);
  assert.ok(codes(GOOD({ title: "Roads" })).includes("title_short"));
  assert.ok(codes(GOOD({ title: "R".repeat(RULES.title[1] + 1) })).includes("title_long"));
  assert.ok(codes(GOOD({ desc: "Short" })).includes("description_short"));
  assert.ok(codes(GOOD({ desc: "d".repeat(170) })).includes("description_long"));
  assert.ok(codes(GOOD({ h1: "" })).includes("h1_missing"));
  assert.ok(codes(GOOD({ h1: "<h1>A</h1><h1>B</h1>" })).includes("h1_multiple"));
  assert.ok(codes(GOOD({ url: `${SITE}/guide/other` })).includes("canonical_other"));
  assert.ok(codes(GOOD({ ld: "" })).includes("jsonld_missing"));
  assert.ok(codes(GOOD({ ld: '<script type="application/ld+json">{bad</script>' })).includes("jsonld_invalid"));
  assert.ok(codes(GOOD({ og: "" })).includes("og_missing"));
  assert.ok(codes(GOOD({ viewport: "" })).includes("viewport_missing"));
  assert.ok(codes(GOOD({ lang: "hi" })).includes("lang_mismatch"));
  assert.ok(codes(GOOD({ words: 20 })).includes("thin"));
  assert.ok(codes(GOOD({ links: "" })).includes("links_few"));
  assert.ok(codes(GOOD({ extra: '<img src="a.png"><img src="b.png" alt="">' })).includes("img_alt"));
  assert.ok(codes(GOOD({ extra: '<meta name="robots" content="noindex">' }).replace("</head>", '<meta name="robots" content="noindex"></head>')).includes("noindex"));
  const hiOnly = GOOD().replace(/<link rel="alternate"[^>]*hreflang="hi-IN"[^>]*>/, "");
  assert.ok(codes(hiOnly).includes("hreflang_missing"));
  const r = auditHtml("", { url: `${SITE}/guide/roads`, status: 500 });
  assert.deepEqual(r.issues.map((i) => i.code), ["status"]);
  assert.equal(r.score, 0);
  for (const c of new Set(Object.keys(ISSUE_TEXT))) assert.ok(ISSUE_TEXT[c], `label for ${c}`);
});

test("auditHtml: the app shell is held to the technical rules only", () => {
  const shell = `<html lang="en"><head><title>Gurugram Vision Forum: who fixes my problem</title><meta name="description" content="${"d".repeat(80)}"><link rel="canonical" href="${SITE}/"><meta name="viewport" content="width=device-width"><meta property="og:title" content="x"><meta property="og:description" content="y"><meta property="og:image" content="z"></head><body><div id="app"></div></body></html>`;
  const r = auditHtml(shell, { url: `${SITE}/report`, lang: "en", kind: "app" });
  assert.deepEqual(r.issues.map((i) => [i.code, i.level]), [["canonical_other", "info"], ["jsonld_missing", "info"]]);
  assert.equal(r.score, 96);
});

test("the site's own rendered pages pass the audit", () => {
  const G = gvf();
  for (const cat of G.CATS) for (const lang of ["en", "hi"]) {
    const url = `${SITE}/${lang === "hi" ? "hi/" : ""}guide/${cat.id}`;
    const r = auditHtml(renderGuide(cat, { lang }), { url, lang, kind: "guide" });
    assert.deepEqual(r.issues, [], `${url}: ${JSON.stringify(r.issues)}`);
  }
  for (const n of [1, 18, 36]) for (const lang of ["en", "hi"]) {
    const url = `${SITE}/${lang === "hi" ? "hi/" : ""}ward/${n}`;
    const r = auditHtml(renderWard(wardById(n), { lang }), { url, lang, kind: "ward" });
    assert.deepEqual(r.issues, [], `${url}: ${JSON.stringify(r.issues)}`);
  }
});

test("scoreOf and duplicates", () => {
  assert.equal(scoreOf([{ level: "error" }, { level: "warn" }, { level: "info" }]), 65);
  assert.equal(scoreOf(Array(5).fill({ level: "error" })), 0);
  const d = duplicates([
    { url: "a", kind: "guide", status: 200, title: "Same", description: "x" },
    { url: "b", kind: "guide", status: 200, title: "same", description: "y" },
    { url: "c", kind: "app", status: 200, title: "Same", description: "x" },
    { url: "d", kind: "guide", status: 500, title: "Same", description: "x" }
  ]);
  assert.deepEqual([...d.keys()].sort(), ["a", "b"]);
  assert.equal(d.get("a")[0].code, "duplicate_title");
  assert.equal(d.get("a").length, 1, "descriptions differ, so only the title is flagged");
});

test("parseVitals reads the PageSpeed response and sourceOf the publisher", () => {
  const j = { lighthouseResult: { categories: { performance: { score: 0.91 }, seo: { score: 1 }, accessibility: { score: 0.95 }, "best-practices": { score: 0.78 } }, audits: { "largest-contentful-paint": { numericValue: 1834.4 }, "cumulative-layout-shift": { numericValue: 0.0123 }, "total-blocking-time": { numericValue: 120 }, "first-contentful-paint": { numericValue: 900 }, "speed-index": { numericValue: 1500 } } } };
  assert.deepEqual(parseVitals(j, { url: "u" }), { url: "u", strategy: "mobile", performance: 91, seo: 100, accessibility: 95, best_practices: 78, lcp_ms: 1834, cls: 0.012, tbt_ms: 120, fcp_ms: 900, speed_index_ms: 1500 });
  assert.equal(parseVitals({ error: {} }, { url: "u" }), null);
  assert.equal(sourceOf("Citizens' forum tracks potholes - Hindustan Times"), "Hindustan Times");
  assert.equal(sourceOf("No publisher here"), null);
});

test("opportunities: topics the city discusses that the site has not covered, with a target page", () => {
  const now = Date.parse("2026-10-08T00:00:00Z");
  const sig = (issue_type, area, d, title = "t") => ({ issue_type, area, posted_at: new Date(now - d * 86400000).toISOString(), title, url: "https://x/" + title });
  const signals = [sig("waste", "Sector 45", 1, "a"), sig("waste", "Sector 45", 2, "b"), sig("waste", "Sector 45", 3, "c"), sig("roads", null, 1), sig("roads", null, 2), sig("water", "Sector 10", 20), sig("water", "Sector 10", 21), sig("other", null, 1), sig("other", null, 1), sig("lights", "DLF 2", 1)];
  const posts = [{ title: "Roads: potholes this week", summary: "", tags: [], published_at: new Date(now - 3 * 86400000).toISOString() }];
  const out = opportunities(signals, posts, { now });
  assert.deepEqual(out.map((o) => [o.issue_type, o.area, o.mentions]), [["waste", "Sector 45", 3]]);
  assert.equal(out[0].target, "/guide/waste");
  assert.match(out[0].title, /Garbage in Sector 45/);
  assert.equal(out[0].examples.length, 2);
  assert.deepEqual(opportunities(signals, [], { now }).map((o) => o.issue_type), ["waste", "roads"], "without the roads post, roads is a gap too; single mentions and 'other' never are");
});

test("checklist: automatic items follow the audit rows, manual ones the settings", () => {
  const good = { kind: "guide", status: 200, issues: [] };
  const c1 = checklist({ env: { INDEXNOW_KEY: "k" }, settings: { seo: { indexnow: true, gsc_verified: true }, autopost: { enabled: true } }, pages: [good, { kind: "app", status: 200, issues: [{ code: "viewport_missing" }] }], vitals: { url: "u", performance: 92, lcp_ms: 1800 }, links: { total: 36, broken: 0, checked_at: "2026-10-08T00:00:00Z" }, autopost: { enabled: true }, mentions: 2 });
  const by = Object.fromEntries(c1.map((i) => [i.key, i]));
  assert.equal(c1.length, 30);
  assert.ok(by.mobile.ok, "the app shell's row does not count against the rendered pages");
  assert.ok(by.canonical.ok && by.hreflang.ok && by.schema.ok && by.og.ok && by.thin.ok && by.indexnow.ok && by.links.ok && by.content.ok && by.vitals.ok && by.gsc.ok && by.mentions.ok);
  assert.equal(by.bing.ok, false);
  assert.equal(by.gsc.auto, false);
  assert.equal(by.gsc.setting, "gsc_verified"); assert.equal(by.bing.setting, "bing_verified"); assert.equal(by.titles.setting, undefined);
  assert.equal(by.titles.auto, true);
  const c2 = checklist({ env: {}, settings: { seo: {} }, pages: [{ kind: "guide", status: 200, issues: [{ code: "thin" }, { code: "hreflang_missing" }] }], vitals: { url: "u", performance: 40, lcp_ms: 4000 } });
  const b2 = Object.fromEntries(c2.map((i) => [i.key, i]));
  assert.equal(b2.thin.ok, false); assert.equal(b2.hreflang.ok, false); assert.equal(b2.indexnow.ok, false); assert.equal(b2.vitals.ok, false);
  assert.equal(b2.links.ok, null, "no link run yet is neither pass nor fail");
  const c3 = checklist({});
  assert.equal(c3.find((i) => i.key === "titles").ok, null, "nothing audited yet");
});

// A fake Supabase that records upserts and answers selects from a table map.
function fakeSb(tables = {}) {
  const writes = [];
  const chain = (table) => {
    const rows = tables[table] || [];
    const c = { _rows: rows, then(r) { r({ data: c._rows, error: null }); } };
    for (const m of ["select", "eq", "in", "gte", "lt", "order", "limit", "is", "not"]) c[m] = () => c;
    c.upsert = (data, opts) => { writes.push({ table, op: "upsert", data, opts }); c._rows = data; return c; };
    c.insert = (data) => { writes.push({ table, op: "insert", data }); return c; };
    c.delete = () => { writes.push({ table, op: "delete" }); return c; };
    c.maybeSingle = async () => ({ data: null, error: null });
    return c;
  };
  return { from: chain, writes };
}

test("seoStep audits the least-recently-checked pages and stores one row each", async () => {
  const fetched = [];
  const fetchImpl = async (url) => { fetched.push(url); return { status: 200, url, text: async () => GOOD({ url }) }; };
  const old = { url: `${SITE}/ward/2`, checked_at: "2026-01-01T00:00:00Z" };
  const fresh = pageList([], SITE).filter((p) => p.url !== old.url).map((p) => ({ url: p.url, checked_at: "2026-10-07T00:00:00Z" }));
  const sb = fakeSb({ seo_pages: [old, ...fresh] });
  const out = await seoStep(sb, { SITE_URL: SITE }, { fetch: fetchImpl, limit: 3, now: Date.parse("2026-10-08T00:00:00Z") });
  assert.equal(out.checked, 3);
  assert.equal(fetched[0], old.url, "the oldest check goes first");
  const up = sb.writes.find((w) => w.table === "seo_pages" && w.op === "upsert");
  assert.equal(up.data.length, 3);
  assert.equal(up.opts.onConflict, "url");
  assert.equal(up.data[0].kind, "ward");
  assert.ok(Number.isFinite(up.data[0].score));
  assert.equal(up.data[0].checked_at, "2026-10-08T00:00:00.000Z");
  assert.equal(out.remaining, pageList([], SITE).length - 3);
  const skip = await seoStep(fakeSb(), {}, {});
  assert.equal(skip.skipped, "no_fetch");
});

test("vitalsStep calls PageSpeed for the page not checked longest and stores the scores", async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ lighthouseResult: { categories: { performance: { score: 0.8 } }, audits: { "largest-contentful-paint": { numericValue: 2000 } } } }) }; };
  const sb = fakeSb({ seo_vitals: [{ url: `${SITE}/`, checked_at: "2026-10-07T00:00:00Z" }] });
  const out = await vitalsStep(sb, { SITE_URL: SITE, PAGESPEED_API_KEY: "KEY" }, { fetch: fetchImpl, now: Date.parse("2026-10-08T00:00:00Z") });
  assert.equal(out.checked, 1);
  const u = new URL(calls[0]);
  assert.equal(u.searchParams.get("url"), `${SITE}${VITALS_PAGES[1]}`, "home was checked yesterday, the next key page goes");
  assert.equal(u.searchParams.get("strategy"), "mobile");
  assert.deepEqual(u.searchParams.getAll("category"), ["performance", "seo", "accessibility", "best-practices"]);
  assert.equal(u.searchParams.get("key"), "KEY");
  const ins = sb.writes.find((w) => w.table === "seo_vitals" && w.op === "insert");
  assert.equal(ins.data.performance, 80);
  assert.equal(ins.data.lcp_ms, 2000);
  const bad = await vitalsStep(fakeSb(), { SITE_URL: SITE }, { fetch: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: "quota" } }) }) });
  assert.deepEqual(bad, { checked: 0, failed: 1, reason: "no_key_quota" }, "a 429 without a key says the key is missing");
  const spent = await vitalsStep(fakeSb(), { SITE_URL: SITE, PAGESPEED_API_KEY: "K" }, { fetch: async () => ({ ok: false, status: 429, json: async () => ({}) }) });
  assert.equal(spent.reason, "quota");
  const down = await vitalsStep(fakeSb(), { SITE_URL: SITE }, { fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  assert.equal(down.reason, "http_500");
});

test("mentionsStep searches Google News for the Forum's name and skips the site's own pages", async () => {
  const rss = `<rss><channel><item><title>Forum maps potholes - The Tribune</title><link>https://www.tribuneindia.com/x</link><pubDate>Tue, 07 Oct 2026 10:00:00 GMT</pubDate></item><item><title>Own page</title><link>${SITE}/blog/x</link></item><item><title>Forum maps potholes - The Tribune</title><link>https://www.tribuneindia.com/x</link></item></channel></rss>`;
  const calls = [];
  const sb = fakeSb();
  const out = await mentionsStep(sb, { SITE_URL: SITE }, { fetch: async (url) => { calls.push(url); return { status: 200, url, text: async () => rss }; } });
  assert.equal(calls.length, 3, "one search per query");
  assert.ok(decodeURIComponent(calls[0]).includes('"Gurugram Vision Forum"'));
  assert.equal(out.found, 1);
  const up = sb.writes.find((w) => w.table === "seo_mentions");
  assert.equal(up.data[0].source, "The Tribune");
  assert.equal(up.data[0].published_at, "2026-10-07T10:00:00.000Z");
  assert.equal(up.opts.onConflict, "url");
});

test("cron: the seo group holds the three steps and runDaily reports them", async () => {
  assert.deepEqual(STEP_GROUPS.seo, ["seo", "vitals", "mentions", "geo", "gsc", "bing", "topics"]);
  assert.deepEqual([...new Set([...STEP_GROUPS.fetch, ...STEP_GROUPS.analyse, ...STEP_GROUPS.seo, ...STEP_GROUPS.agent])].sort(), [...STEP_NAMES].sort());
  const r = await runDaily(fakeSb(), {}, {}, { only: ["seo", "vitals", "mentions"] });
  assert.equal(r.ok, true);
  assert.equal(r.seo.skipped, "no_fetch");
  assert.equal(r.vitals.skipped, "no_fetch");
  assert.equal(r.mentions.skipped, "no_fetch");
  assert.equal(r.news.skipped, "not_in_run");
});

test("summarise and activityOf turn rows and cron results into the desk's words", () => {
  const s = summarise([{ url: "a", status: 200, score: 80, issues: [{ code: "thin" }], checked_at: "2026-10-08T00:00:00Z" }, { url: "b", status: 200, score: 100, issues: [], checked_at: "2026-10-07T00:00:00Z" }, { url: "c", status: 500, score: 0, issues: [{ code: "status" }] }], new Map());
  assert.deepEqual(s, { pages: 3, audited: 2, avg_score: 90, errors: 1, issues: [{ code: "thin", count: 1, label: "Thin content" }, { code: "status", count: 1, label: "The page did not answer 200" }], last_audit: "2026-10-08T00:00:00Z" });
  const a = activityOf([{ started_at: "s", finished_at: "f", result: { seo: { checked: 40, total: 131, avg_score: 97, errors: 0 }, vitals: { checked: 1, failed: 0 }, mentions: { found: 2, new: 1 }, indexnow: { pinged: true, urls: 6 }, autopost: { drafted: true, slug: "w41", published: 0 }, links: { checked: 36, broken: 1 }, news: { new_items: 3 }, errors: ["vitals: boom"] } }], SITE);
  assert.deepEqual(a.map((x) => x.step), ["seo", "vitals", "mentions", "indexnow", "autopost", "links", "news"]);
  assert.equal(a[0].text, "Audited 40 of 131 pages, average score 97");
  assert.equal(a[1].ok, false, "a step named in errors is marked");
  assert.ok(a[4].text.includes(`${SITE}/blog/w41`));
  assert.equal(a[5].text, "Checked 36 official links, 1 broken");
});

test("GET /api/triage/seo: content team and coordinators allowed, ward volunteers refused; the shape the desk reads", async () => {
  assert.deepEqual(ROLES, CONTENT_ROLES);
  const authAs = (role) => async (req, roles) => { if (!roles.includes(role)) throw new HttpError(403, "forbidden"); return { staff: { role } }; };
  const res = () => { const r = { statusCode: 0, headers: {}, body: null, status(s) { r.statusCode = s; return r; }, setHeader(k, v) { r.headers[k] = v; }, end(b) { r.body = JSON.parse(b); } }; return r; };
  const denied = res();
  await makeHandler({ auth: authAs("triage"), sb: fakeSb(), env: {} })({ method: "GET", query: {} }, denied);
  assert.equal(denied.statusCode, 403);
  const sb = fakeSb({
    seo_pages: [{ url: `${SITE}/guide/roads`, kind: "guide", status: 200, score: 92, title: "T", description: "D", issues: [{ code: "title_long", level: "warn", detail: "x" }], checked_at: "2026-10-08T00:00:00Z" }, { url: `${SITE}/guide/waste`, kind: "guide", status: 200, score: 100, title: "T", description: "E", issues: [], checked_at: "2026-10-08T00:00:00Z" }],
    seo_vitals: [{ url: `${SITE}/`, performance: 90, lcp_ms: 1500, checked_at: "2026-10-08T00:00:00Z" }, { url: `${SITE}/`, performance: 70, lcp_ms: 2500, checked_at: "2026-10-01T00:00:00Z" }],
    seo_mentions: [{ url: "https://news/x", title: "Forum", source: "HT", published_at: "2026-10-07T00:00:00Z" }],
    cron_runs: [{ started_at: "2026-10-08T00:00:00Z", finished_at: "2026-10-08T00:01:00Z", ok: true, result: { seo: { checked: 2, total: 2, avg_score: 96, errors: 0 } } }],
    link_status: [{ ok: true, checked_at: "2026-10-08T00:00:00Z" }, { ok: false, checked_at: "2026-10-08T00:00:00Z" }],
    site_settings: [{ key: "seo", value: { indexnow: true, gsc_verified: true } }]
  });
  const ok = res();
  await makeHandler({ auth: authAs("content"), sb, env: { SITE_URL: SITE, INDEXNOW_KEY: "k" } })({ method: "GET", query: {} }, ok);
  assert.equal(ok.statusCode, 200);
  const j = ok.body;
  assert.equal(j.summary.pages, 2);
  assert.equal(j.summary.avg_score, 96);
  assert.deepEqual(j.summary.issues.map((i) => i.code), ["duplicate_title", "title_long"], "the duplicate title across the two pages is added on read");
  assert.equal(j.pages[0].issues.length, 2);
  assert.equal(j.vitals.latest.length, 1, "one latest row per page");
  assert.equal(j.vitals.latest[0].performance, 90);
  assert.equal(j.vitals.history.length, 2);
  assert.equal(j.mentions.length, 1);
  assert.equal(j.activity[0].text, "Audited 2 of 2 pages, average score 96");
  const by = Object.fromEntries(j.checklist.map((i) => [i.key, i]));
  assert.equal(by.gsc.ok, true); assert.equal(by.bing.ok, false); assert.equal(by.indexnow.ok, true); assert.equal(by.links.ok, false); assert.equal(by.titles.ok, false);
  assert.equal(by.vitals.ok, true);
  assert.deepEqual(j.settings, { indexnow: true, gsc_verified: true, bing_verified: false });
  assert.equal(ok.headers["Cache-Control"], "no-store");
  const coord = res();
  await makeHandler({ auth: authAs("coordinator"), sb: fakeSb(), env: {} })({ method: "GET", query: {} }, coord);
  assert.equal(coord.statusCode, 200);
});

test("a refused PageSpeed call reaches the desk: activity line and checklist say to add the key", () => {
  const runs = [{ started_at: "s", finished_at: "f", result: { vitals: { checked: 0, failed: 1, reason: "no_key_quota" } } }, { result: { vitals: { checked: 1, failed: 0 } } }];
  const a = activityOf(runs, SITE);
  assert.equal(a[0].ok, false);
  assert.match(a[0].text, /add the free PAGESPEED_API_KEY in Vercel/);
  assert.equal(lastVitalsReason(runs), "no_key_quota");
  assert.equal(lastVitalsReason([{ result: { vitals: { skipped: "not_in_run" } } }, ...runs.slice(1)]), null, "a run that skipped the step is passed over, and a success clears it");
  const item = (r, env = {}) => checklist({ env, vitalsReason: r }).find((i) => i.key === "vitals");
  assert.match(item("no_key_quota").detail, /add the free PAGESPEED_API_KEY/);
  assert.match(item("quota", { PAGESPEED_API_KEY: "K" }).detail, /quota spent/);
  assert.match(item(null).detail, /add the free PAGESPEED_API_KEY/);
  assert.equal(item(null, { PAGESPEED_API_KEY: "K" }).detail, "Waiting for the first PageSpeed run");
  assert.equal(item("no_key_quota").ok, null);
});
