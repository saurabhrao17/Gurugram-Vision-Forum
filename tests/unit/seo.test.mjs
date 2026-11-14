import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handle as pageHandle, route, subParts } from "../../lib/handlers/page.js";
import { handle as sitemapHandle, buildSitemap } from "../../lib/handlers/sitemap.js";
import { handle as indexnow } from "../../lib/handlers/indexnow-key.js";
import { handle as gsc } from "../../lib/handlers/gsc.js";
import { gvf, hs } from "../../lib/site-data.js";
import { siteUrl, BUILD_DATE } from "../../lib/seo/site.js";
import { describe, esc, jsonLd } from "../../lib/seo/layout.js";
import { parseDate, mergePosts, normalisePost } from "../../lib/seo/data.js";
import { chartersFor, faqFor } from "../../lib/seo/guides.js";
import { renderWard, wardById, wardMeta, orderAreas } from "../../lib/seo/wards.js";
import { auditHtml } from "../../lib/seo/audit.js";

const ENV = { SUPABASE_URL: "https://proj.supabase.co" };

function fakeRes() {
  const r = { statusCode: null, headers: {}, body: "" };
  r.status = (s) => { r.statusCode = s; return r; };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; return r; };
  r.end = (b) => { r.body = b == null ? "" : String(b); return r; };
  return r;
}

// Supabase double: tables[name] is an array or (q) => array; counts[name] a
// number for head:true counts; errors[name] makes every query on it fail.
function fakeSb({ tables = {}, counts = {}, errors = {}, rpc = {} } = {}) {
  const calls = [];
  const rpcFn = async (name, args) => {
    calls.push({ table: "rpc:" + name, args });
    if (errors[name]) return { data: null, error: { message: errors[name] } };
    const v = rpc[name];
    return { data: typeof v === "function" ? v(args) : (v ?? null), error: null };
  };
  const from = (table) => {
    const q = { table, filters: [], cols: null, opts: null, single: false, limit: null, order: null };
    const chain = {
      select(cols, opts) { q.cols = cols; q.opts = opts || null; return chain; },
      eq(k, v) { q.filters.push(["eq", k, v]); return chain; },
      in(k, v) { q.filters.push(["in", k, v]); return chain; },
      not(k, op, v) { q.filters.push(["not", k, op, v]); return chain; },
      contains(k, v) { q.filters.push(["contains", k, v]); return chain; },
      order(k, o) { q.order = [k, o]; return chain; },
      limit(n) { q.limit = n; return chain; },
      maybeSingle() { q.single = true; return chain; },
      then(resolve, reject) {
        calls.push(q);
        if (errors[table]) return Promise.resolve({ data: null, error: { message: errors[table] } }).then(resolve, reject);
        let rows = typeof tables[table] === "function" ? tables[table](q) : (tables[table] || []);
        for (const f of q.filters) {
          if (f[0] === "eq") rows = rows.filter((r) => r[f[1]] === f[2]);
          if (f[0] === "in") rows = rows.filter((r) => f[2].includes(r[f[1]]));
          if (f[0] === "contains") rows = rows.filter((r) => Array.isArray(r[f[1]]) && f[2].every((x) => r[f[1]].includes(x)));
          if (f[0] === "not" && f[2] === "is" && f[3] === null) rows = rows.filter((r) => r[f[1]] != null);
        }
        if (q.limit != null) rows = rows.slice(0, q.limit);
        const out = { data: q.opts?.head ? null : (q.single ? (rows[0] || null) : rows), error: null };
        if (q.opts?.head) out.count = typeof counts[table] === "function" ? counts[table](q) : (counts[table] ?? rows.length);
        return Promise.resolve(out).then(resolve, reject);
      }
    };
    return chain;
  };
  return { from, calls, rpc: rpcFn };
}

async function render(path, sb, env = ENV) {
  const res = fakeRes();
  await pageHandle({ method: "GET", query: { page: path } }, res, sb, env);
  return res;
}

const lds = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const titleOf = (html) => /<title>([^<]*)<\/title>/.exec(html)[1];
const unesc = (x) => x.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const descOf = (html) => unesc(/<meta name="description" content="([^"]*)">/.exec(html)[1]);
const h1Of = (html) => unesc(/<h1>([^<]*)<\/h1>/.exec(html)[1]);
const ogTitleOf = (html) => unesc(/<meta property="og:title" content="([^"]*)">/.exec(html)[1]);
const canonicalOf = (html) => /<link rel="canonical" href="([^"]+)">/.exec(html)[1];
const alternates = (html) => Object.fromEntries([...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map((m) => [m[1], m[2]]));
const DEVANAGARI = /[ऀ-ॿ]/;

function cleanOutput(html, label) {
  assert.ok(!/undefined|\[object Object\]|NaN\b/.test(html), `${label}: stray token in output`);
  assert.ok(!/\$\{/.test(html), `${label}: unrendered template`);
}

const POSTS = [
  { slug: "monsoon-drains-2026", kind: "news", title: "Drains cleared before the monsoon", title_hi: "मानसून से पहले नाले साफ़", summary: "What MCG said it did, ward by ward.", summary_hi: "", body: "<p>Body <script>alert(1)</script>text</p>", body_hi: "", media_path: "news/drains.jpg", tags: ["drains", "roads"], published: true, published_at: "2026-10-01T05:00:00Z", created_at: "2026-09-30T00:00:00Z", author: "team", source: "auto:pulse" },
  { slug: "draft-only", kind: "story", title: "Unpublished", published: false, tags: ["roads"], created_at: "2026-10-02T00:00:00Z" },
  { slug: null, kind: "story", title: "No slug", published: true, tags: ["roads"], created_at: "2026-10-02T00:00:00Z" }
];
const INSIGHT = [{ generated_at: "2026-10-07T03:30:00Z", period_start: "2026-09-30", period_end: "2026-10-07", published: true, data: { topics: [{ issue_type: "roads", count: 14, trend: "up", areas: [{ area: "Sector 45", n: 4 }, { area: "DLF Phase 3", n: 2 }] }] } }];

test("site url resolution order", () => {
  assert.equal(siteUrl({ SITE_URL: "https://example.org/" }), "https://example.org");
  assert.equal(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "gvf.vercel.app" }), "https://gvf.vercel.app");
  assert.equal(siteUrl({}), "https://gurugramvisionforum.org");
  assert.match(BUILD_DATE, /^\d{4}-\d{2}-\d{2}$/);
});

test("helpers: esc, describe, jsonLd, parseDate, hs", () => {
  assert.equal(esc('<a href="x">&\'</a>'), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  assert.ok(describe("word ".repeat(60)).length <= 160);
  assert.equal(describe("short"), "short");
  assert.ok(jsonLd({ a: "</script><b>" }).includes("<\\/script>"));
  assert.equal(parseDate("25 Sep 2026").toISOString().slice(0, 10), "2026-09-25");
  assert.equal(parseDate("2026-10-01T05:00:00Z").toISOString(), "2026-10-01T05:00:00.000Z");
  assert.equal(parseDate("nonsense"), null);
  assert.equal(hs("Guide", "hi"), "मार्गदर्शिका");
  assert.equal(hs("Guide", "en"), "Guide");
  assert.equal(hs("No such string here", "hi"), "No such string here");
  assert.ok(Array.isArray(gvf().CATS) && gvf().CATS.length >= 17);
});

test("route and subParts", () => {
  assert.deepEqual(route(["guides"]), { lang: "en", kind: "guides" });
  assert.deepEqual(route(["hi", "guide", "roads"]), { lang: "hi", kind: "guide", arg: "roads" });
  assert.deepEqual(route(["ward", "12"]), { lang: "en", kind: "ward", arg: 12 });
  assert.deepEqual(route(["hi", "blog", "a-slug"]), { lang: "hi", kind: "post", arg: "a-slug" });
  assert.equal(route(["guide", "Roads"]), null);
  assert.equal(route(["guide", "roads", "x"]), null);
  assert.equal(route(["ward", "abc"]), null);
  assert.equal(route([]), null);
  assert.deepEqual(subParts({ query: { page: "hi/guide/roads" } }), ["hi", "guide", "roads"]);
  assert.deepEqual(subParts({ query: { path: "page/ward/3" } }), ["ward", "3"]);
  assert.deepEqual(subParts({ query: {}, url: "/api/index?path=page/blog" }), ["blog"]);
});

test("guides index: both languages, every category linked", async () => {
  const sb = fakeSb({ tables: { posts: POSTS } });
  const en = await render("guides", sb);
  assert.equal(en.statusCode, 200);
  assert.equal(en.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(en.headers["cache-control"], "public, s-maxage=600, stale-while-revalidate=86400");
  cleanOutput(en.body, "guides");
  assert.equal(canonicalOf(en.body), "https://gurugramvisionforum.org/guides");
  for (const c of gvf().CATS) assert.ok(en.body.includes(`href="/guide/${c.id}"`), c.id);
  assert.ok(en.body.includes('href="/ward/36"'));
  assert.ok(en.body.includes('href="/blog/monsoon-drains-2026"'));
  const hi = await render("hi/guides", sb);
  assert.equal(hi.statusCode, 200);
  assert.ok(hi.body.includes('<html lang="hi">'));
  assert.ok(DEVANAGARI.test(titleOf(hi.body)));
  assert.ok(hi.body.includes('href="/hi/guide/roads"'));
  assert.ok(hi.body.includes("मानसून से पहले नाले साफ़"));
});

test("guide page: title, canonical, hreflang, JSON-LD, FAQ, live box, CTA", async () => {
  const sb = fakeSb({ tables: { posts: POSTS, insights: INSIGHT, site_settings: [{ key: "social", value: { x: "https://x.com/gvf", facebook: "" } }] } });
  const res = await render("guide/roads", sb);
  assert.equal(res.statusCode, 200);
  const h = res.body;
  cleanOutput(h, "guide/roads");
  assert.equal(titleOf(h), "Roads, footpaths in Gurugram: who fixes it, how to complain");
  assert.ok(h.includes("<h1>Who fixes Roads, footpaths in Gurugram (Gurgaon): how to complain, documents, deadlines</h1>"), "the H1 keeps the full question");
  assert.equal(canonicalOf(h), "https://gurugramvisionforum.org/guide/roads");
  assert.deepEqual(alternates(h), { "en-IN": "https://gurugramvisionforum.org/guide/roads", "hi-IN": "https://gurugramvisionforum.org/hi/guide/roads", "x-default": "https://gurugramvisionforum.org/guide/roads" });
  const d = /<meta name="description" content="([^"]*)">/.exec(h)[1];
  assert.ok(d.length > 20 && d.length <= 160);
  const ld = lds(h);
  const types = ld.map((x) => x["@type"]);
  assert.deepEqual(types, ["Organization", "WebSite", "BreadcrumbList", "HowTo", "FAQPage"]);
  assert.deepEqual(ld[0].sameAs, ["https://x.com/gvf"]);
  assert.ok(!("email" in ld[0]) && !("telephone" in ld[0]), "no contact email or phone in the organisation data: the forms are the only channel");
  assert.equal(ld[3].step.length, gvf().CATS.find((c) => c.id === "roads").ladder.length);
  assert.equal(ld[4].mainEntity.length, 4);
  assert.ok(ld[4].mainEntity.every((q) => q.name && q.acceptedAnswer.text));
  // sections from data
  assert.ok(h.includes("GMDA for master roads, MCG for internal roads"));
  assert.ok(h.includes('href="https://services.gmda.gov.in/"'));
  assert.ok(h.includes('href="tel:18001801817"'));
  assert.ok(h.includes("Nearest landmark or house number"));
  assert.ok(h.includes("Photo of the spot"));
  assert.ok(h.includes("CM Window and the MCG ladder"));
  assert.ok(h.includes("Right to Service, Haryana"));
  assert.ok(h.includes("Right to Information"));
  // live box
  assert.ok(h.includes("14 public mentions this week"));
  assert.ok(h.includes("Sector 45"));
  assert.ok(h.includes('href="/blog/monsoon-drains-2026"'));
  assert.ok(!h.includes("Unpublished"));
  // CTA and share
  assert.ok(h.includes('href="/report/roads"'));
  assert.ok(h.includes("https://wa.me/?text="));
  assert.ok(h.includes("https://twitter.com/intent/tweet?"));
  assert.ok(h.includes('href="/hi/guide/roads"'), "language link");
  assert.ok(h.includes('href="/styles.css"'));
  assert.ok(h.includes("fonts.googleapis.com/css2?family=Anek+Latin"));
});

test("guide page in Hindi uses the hl label and Devanagari data strings", async () => {
  const sb = fakeSb({ tables: { posts: POSTS, insights: INSIGHT } });
  const res = await render("hi/guide/roads", sb);
  assert.equal(res.statusCode, 200);
  const h = res.body;
  cleanOutput(h, "hi/guide/roads");
  assert.ok(h.includes('<html lang="hi">'));
  assert.ok(h.includes("सड़क, फ़ुटपाथ"), "hl label");
  assert.ok(DEVANAGARI.test(titleOf(h)));
  assert.equal(canonicalOf(h), "https://gurugramvisionforum.org/hi/guide/roads");
  assert.deepEqual(alternates(h)["en-IN"], "https://gurugramvisionforum.org/guide/roads");
  assert.ok(h.includes(hs("GMDA integrated grievance portal", "hi")));
  assert.ok(h.includes("मानसून से पहले नाले साफ़"), "Hindi post title in the live box");
  const faq = lds(h).find((x) => x["@type"] === "FAQPage");
  assert.equal(faq.mainEntity.length, 4);
  assert.ok(faq.mainEntity.every((q) => DEVANAGARI.test(q.name)));
  assert.ok(h.includes('href="/guide/roads"'), "link back to English");
  assert.ok(h.includes('property="og:locale" content="hi_IN"'));
});

test("every category renders in both languages without a database", async () => {
  for (const c of gvf().CATS) {
    for (const p of [`guide/${c.id}`, `hi/guide/${c.id}`]) {
      const res = await render(p, null, {});
      assert.equal(res.statusCode, 200, p);
      cleanOutput(res.body, p);
      assert.equal(lds(res.body).find((x) => x["@type"] === "FAQPage").mainEntity.length, 4, p);
    }
    assert.ok(chartersFor(c).some((x) => x.id === "rti"), c.id + " shows RTI");
    if (c.id !== "rti") assert.ok(chartersFor(c).some((x) => x.id === "cmwindow"), c.id + " shows CM Window");
    assert.equal(faqFor(c, "en").length, 4);
  }
  assert.ok(chartersFor(gvf().CATS.find((c) => c.id === "property")).some((x) => x.id === "rts"));
  assert.ok(chartersFor(gvf().CATS.find((c) => c.id === "waste")).some((x) => x.id === "swm"));
});

test("unknown guide and bad paths are 404 pages with the shell", async () => {
  for (const p of ["guide/nope", "hi/guide/nope", "nothing", "guide", "ward", "blog/x/y"]) {
    const res = await render(p, fakeSb());
    assert.equal(res.statusCode, 404, p);
    assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(res.headers["cache-control"], "no-store");
    assert.ok(res.body.includes("Page not found") || res.body.includes("पृष्ठ नहीं मिला"));
    assert.ok(res.body.includes('<meta name="robots" content="noindex">'));
    assert.ok(res.body.includes('href="/styles.css"'));
  }
  const res = fakeRes();
  await pageHandle({ method: "POST", query: { page: "guides" } }, res, fakeSb());
  assert.equal(res.statusCode, 405);
});

test("ward page: councillor name carries the 'news reports' line in English and Hindi; the flag removes it", async () => {
  const sb = fakeSb({ tables: { area_wards: [] }, rpc: { ward_counts: () => null } });
  const EN = "Name from news reports; official check pending";
  const HI = "नाम समाचार रिपोर्टों से; आधिकारिक जाँच बाकी";
  const G = gvf();
  assert.equal(G.COUNCILLOR_PENDING, true);
  assert.equal(G.HS[EN], HI, "in-app Hindi (GVF.HS)");
  const en = await render("ward/5", sb);
  const hi = await render("hi/ward/5", sb);
  assert.ok(en.body.includes(EN) && !en.body.includes(HI));
  assert.ok(hi.body.includes(HI) && !hi.body.includes(EN));
  cleanOutput(hi.body, "hi/ward/5");
  G.COUNCILLOR_PENDING = false;
  try {
    const off = await render("ward/5", sb);
    const offHi = await render("hi/ward/5", sb);
    assert.ok(!off.body.includes(EN) && !offHi.body.includes(HI));
  } finally { G.COUNCILLOR_PENDING = true; }
});

test("ward page: councillor, party, areas and report counts; never one report", async () => {
  const counts = { ward: 5, total: 3, site_total: 12, by_stage: [1, 0, 1, 0, 1],
    by_issue: [{ issue_type: "waste", label: "Garbage", total: 1, resolved: 0 }, { issue_type: "roads", label: "Roads", total: 2, resolved: 1 }, { issue_type: "water", label: "Water", total: 0, resolved: 0 }] };
  const areas = [{ area: "Sector 45", ward: 5, note: "checked" }, { area: "Sector 46", ward: 5, note: null }, { area: "Sector 10", ward: 6, note: null }];
  const w = gvf().WARDS.find((x) => x[0] === 5);

  const sb = fakeSb({ tables: { area_wards: areas }, rpc: { ward_counts: (a) => (a.p_ward === 5 ? counts : null) } });
  const res = await render("ward/5", sb);
  assert.equal(res.statusCode, 200);
  const h = res.body;
  cleanOutput(h, "ward/5");
  assert.equal(titleOf(h), "Ward 5, Gurugram: Sector 45 and Sector 46 | Gurugram Vision Forum");
  assert.equal(descOf(h), "MCG Ward 5 in Gurugram covers Sector 45 and Sector 46. See the councillor and how to report a problem there.");
  assert.equal(canonicalOf(h), "https://gurugramvisionforum.org/ward/5");
  assert.equal(alternates(h)["hi-IN"], "https://gurugramvisionforum.org/hi/ward/5");
  assert.deepEqual(lds(h).map((x) => x["@type"]), ["Organization", "WebSite", "BreadcrumbList", "WebPage"]);
  assert.ok(h.includes(esc(w[1])), "councillor name");
  assert.ok(h.includes("Party (as elected, March 2025)"));
  assert.ok(h.includes(esc(w[2])), "party");
  assert.ok(h.includes("Sector 45") && h.includes("Sector 46") && !h.includes("Sector 10"));
  assert.ok(/<b>3<\/b><span>Reports so far<\/span>/.test(h));
  assert.ok(/<b>1<\/b><span>Received<\/span>/.test(h) && /<b>1<\/b><span>Filed officially<\/span>/.test(h) && /<b>0<\/b><span>Escalated<\/span>/.test(h) && /<b>1<\/b><span>Resolved<\/span>/.test(h));
  assert.ok(h.includes("By issue") && h.includes('href="/guide/roads"'));
  assert.ok(!h.includes("Water") || !/Water<\/a><\/td><td[^>]*>0</.test(h), "issues with no reports are left out");
  assert.ok(!h.includes("GVF-20") && !h.includes("/r/") && !h.includes("/map"), "nothing that identifies one report, no feed links");
  assert.ok(!sb.calls.some((q) => q.table === "reports" || q.table === "public_reports"), "the page never reads report rows");
  assert.ok(h.includes('href="/ward/4"') && h.includes('href="/ward/6"'));
  assert.ok(h.includes('href="/report"'));
  assert.ok(!/mailto:|tel:\+|@gurugramvisionforum\.org|\+91 ?\d/.test(h), "no contact email or phone on the page: the forms are the only channel");

  const hi = await render("hi/ward/5", sb);
  assert.equal(hi.statusCode, 200);
  cleanOutput(hi.body, "hi/ward/5");
  assert.ok(hi.body.includes("दल (मार्च 2025 के चुनाव अनुसार)"));
  assert.ok(hi.body.includes("आधिकारिक रूप से दर्ज"));
  assert.ok(hi.body.includes("अब तक रिपोर्टें"));
  assert.equal(canonicalOf(hi.body), "https://gurugramvisionforum.org/hi/ward/5");
});

// Ward 9's areas as they are in area_wards (data/area-wards.csv), in table order.
const WARD9 = ["Sector 10", "Krishna Nagar", "Vikas Nagar", "Basai Enclave", "Kadipur Enclave", "Kadipur Industrial Area", "Saraswati Enclave", "Pace City 2", "Udyog Vihar Phase 6", "Khandsa"];
const BRAND = { en: " | Gurugram Vision Forum", hi: " | " + "गुरुग्राम विज़न फ़ोरम" };
// Every ward's areas from the export of area_wards.
const AREAS_BY_WARD = (() => {
  const out = {};
  for (const line of readFileSync(new URL("../../data/area-wards.csv", import.meta.url), "utf8").split("\n").slice(1)) {
    const m = /^("([^"]*)"|[^,]*),(\d+),/.exec(line);
    if (m) (out[m[3]] = out[m[3]] || []).push(m[2] || m[1]);
  }
  return out;
})();

test("ward areas are named sectors first by number, then the rest A to Z", () => {
  assert.deepEqual(orderAreas(["Khandsa", "Sector 37", "Basai Enclave", "Sector 9", "Sector 10A", "Sector 10", "", null, "Khandsa"]),
    ["Sector 9", "Sector 10", "Sector 10A", "Sector 37", "Basai Enclave", "Khandsa"]);
});

test("ward 9: the exact title and description, English and Hindi", async () => {
  const sb = fakeSb({ tables: { area_wards: WARD9.map((area) => ({ area, ward: 9, note: null })) }, rpc: { ward_counts: () => null } });
  const EN_T = "Ward 9, Gurugram: Sector 10, Basai Enclave, Kadipur Enclave and more";
  const EN_D = "MCG Ward 9 in Gurugram covers Sector 10, Basai Enclave, Kadipur Enclave and 7 more areas. See the full area list, the councillor and how to report a problem.";
  const HI_T = "वार्ड 9, गुरुग्राम: सेक्टर 10, बसई एन्क्लेव, कादीपुर एन्क्लेव और अन्य";
  const HI_D = "गुरुग्राम नगर निगम के वार्ड 9 में सेक्टर 10, बसई एन्क्लेव, कादीपुर एन्क्लेव और 7 अन्य क्षेत्र आते हैं। पूरी सूची, पार्षद और समस्या दर्ज करने का तरीका।";
  assert.deepEqual([EN_T.length, EN_D.length, HI_T.length, HI_D.length], [68, 157, 69, 150]);
  for (const [p, T, D] of [["ward/9", EN_T, EN_D], ["hi/ward/9", HI_T, HI_D]]) {
    const h = (await render(p, sb)).body;
    assert.equal(titleOf(h), T, p);
    assert.equal(descOf(h), D, p);
    assert.equal(h1Of(h), T, `${p}: H1 equals the title`);
    assert.equal(ogTitleOf(h), T, `${p}: og:title`);
    assert.equal(lds(h).find((x) => x["@type"] === "WebPage").name, T, `${p}: JSON-LD name`);
    assert.equal(lds(h).find((x) => x["@type"] === "WebPage").description, D);
  }
  assert.ok(!/[A-Za-z]/.test(HI_T + HI_D), "Hindi never mixes scripts");
});

test("a ward with no areas yet: the plain title and description", () => {
  assert.deepEqual(wardMeta(36, [], "en"), {
    title: "Ward 36, Gurugram: areas, councillor and how to report a problem",
    description: "Ward 36 of the Municipal Corporation of Gurugram: the areas it covers, its councillor, and how to report a road, water, waste or streetlight problem there." });
  assert.deepEqual(wardMeta(36, [], "hi"), {
    title: "वार्ड 36, गुरुग्राम: क्षेत्र, पार्षद और समस्या दर्ज करने का तरीका",
    description: "गुरुग्राम नगर निगम का वार्ड 36: इसमें आने वाले क्षेत्र, इसके पार्षद, और वहाँ सड़क, पानी, कचरे या स्ट्रीटलाइट की समस्या दर्ज करने का तरीका।" });
});

test("ward titles: fewer areas are named when three do not fit; 'more' only when there are more", () => {
  const long = ["Sector 1", "A very long colony name indeed", "Another very long colony name", "Zed"];
  assert.equal(wardMeta(3, long, "en").title, "Ward 3, Gurugram: Sector 1, A very long colony name indeed and more");
  assert.equal(wardMeta(3, ["A colony whose name alone is far too long for any title to hold it at all"], "en").title, "Ward 3, Gurugram: areas, councillor and how to report a problem");
  assert.equal(wardMeta(3, ["Sector 3"], "en").title, "Ward 3, Gurugram: Sector 3");
  assert.equal(wardMeta(3, ["Sector 3", "Sector 2", "Khandsa"], "en").title, "Ward 3, Gurugram: Sector 2, Sector 3 and Khandsa");
  assert.match(wardMeta(3, ["Sector 3", "Sector 2", "Khandsa", "Sector 1"], "en").description, /covers Sector 1, Sector 2, Sector 3 and 1 more area\. /);
  // Hindi names only the areas that have a Hindi name, and counts the others as "more".
  assert.equal(wardMeta(3, ["Sector 3", "No Hindi Name Colony"], "hi").title, "वार्ड 3, गुरुग्राम: सेक्टर 3 और अन्य");
  assert.match(wardMeta(3, ["Sector 3", "No Hindi Name Colony"], "hi").description, /में सेक्टर 3 और 1 अन्य क्षेत्र आते हैं।/);
  assert.equal(wardMeta(3, ["No Hindi Name Colony"], "hi").title, wardMeta(3, [], "hi").title);
});

test("all 36 wards, both languages, with and without areas: lengths, no cut text, no councillor name, no audit issue", () => {
  const seen = { en: new Map(), hi: new Map() };
  for (let n = 1; n <= 36; n++) {
    const w = wardById(n);
    for (const lang of ["en", "hi"]) {
      for (const names of [AREAS_BY_WARD[n] || [], []]) {
        const label = `ward ${n} ${lang} ${names.length ? "with" : "without"} areas`;
        const h = renderWard(w, { lang, live: { areas: names.map((area) => ({ area })), counts: null } });
        const title = titleOf(h), desc = descOf(h), h1 = h1Of(h);
        assert.ok(title.length >= 15 && title.length <= 70, `${label}: title length ${title.length}`);
        assert.ok(desc.length >= 50 && desc.length <= 160, `${label}: description length ${desc.length}`);
        assert.ok(h1.length <= 70 && (title === h1 || title === h1 + BRAND[lang]), `${label}: <title> is the H1, with the brand only when it fits`);
        assert.equal(ogTitleOf(h), h1, label);
        for (const name of [w.name, hs(w.name, "hi")]) assert.ok(!title.includes(name) && !desc.includes(name) && !h1.includes(name), `${label}: no councillor name in the title or description`);
        assert.ok(!/…|\.\.\./.test(title + desc), `${label}: nothing cut short`);
        if (lang === "hi") assert.ok(!/[A-Za-z]/.test(title + desc), `${label}: Hindi never mixes scripts`);
        assert.deepEqual(auditHtml(h, { url: `https://gurugramvisionforum.org${lang === "hi" ? "/hi" : ""}/ward/${n}`, lang, kind: "ward" }).issues, [], label);
        if (names.length) {
          assert.ok(!seen[lang].has(title), `${label}: same title as ward ${seen[lang].get(title)}`);
          seen[lang].set(title, n);
        }
      }
    }
  }
  assert.ok(Object.keys(AREAS_BY_WARD).length >= 35, "the export lists the wards' areas");
});

test("ward 99, ward 0 and a database failure", async () => {
  for (const p of ["ward/99", "ward/0", "hi/ward/99"]) {
    const res = await render(p, fakeSb());
    assert.equal(res.statusCode, 404, p);
    assert.ok(res.body.includes("<title>"));
  }
  const res = await render("ward/1", fakeSb({ errors: { ward_counts: "down", area_wards: "down", site_settings: "down" } }));
  assert.equal(res.statusCode, 200, "degrades to data-only page");
  assert.ok(res.body.includes("No reports from this ward yet."));
  assert.ok(res.body.includes("being checked by volunteers"));
  const res2 = await render("ward/36", null, {});
  assert.equal(res2.statusCode, 200);
});

test("blog index merges static and live posts, newest first", async () => {
  const sb = fakeSb({ tables: { posts: POSTS } });
  const res = await render("blog", sb);
  assert.equal(res.statusCode, 200);
  const h = res.body;
  cleanOutput(h, "blog");
  assert.equal(canonicalOf(h), "https://gurugramvisionforum.org/blog");
  const live = h.indexOf("monsoon-drains-2026"), stat = h.indexOf("complaint-that-gets-acted-on");
  assert.ok(live > 0 && stat > 0 && live < stat, "live Oct post before static Sep posts");
  assert.ok(!h.includes("draft-only"));
  assert.ok(h.includes("https://proj.supabase.co/storage/v1/object/public/media/news/drains.jpg"));
  const blog = lds(h).find((x) => x["@type"] === "Blog");
  assert.ok(blog.blogPost.some((p) => p["@type"] === "NewsArticle"));
  const hi = await render("hi/blog", sb);
  assert.ok(hi.body.includes("मानसून से पहले नाले साफ़"));
  assert.ok(hi.body.includes('href="/hi/blog/segregate-at-source"'));
  assert.equal(mergePosts([]).length, gvf().BLOG.length);
});

test("blog post: static, live news with auto disclosure, Hindi fallback, 404", async () => {
  const sb = fakeSb({ tables: { posts: POSTS } });
  let res = await render("blog/complaint-that-gets-acted-on", sb);
  assert.equal(res.statusCode, 200);
  let h = res.body;
  cleanOutput(h, "static post");
  assert.equal(titleOf(h), "How to file a civic complaint that gets acted on");
  const art = lds(h).find((x) => x["@type"] === "BlogPosting");
  assert.equal(art.author.name, "Gurugram Vision Forum");
  assert.equal(art.datePublished.slice(0, 10), "2026-09-25");
  assert.ok(!h.includes("Compiled automatically"));
  assert.ok(h.includes("Gurugram Vision Forum data desk") && !h.includes("By the Forum team"), "byline is the data desk");

  res = await render("hi/blog/complaint-that-gets-acted-on", sb);
  assert.ok(res.body.includes("WhatsApp ग्रुप"), "hb body used");
  assert.ok(res.body.includes("गुरुग्राम विज़न फ़ोरम डेटा डेस्क"), "Hindi byline");
  assert.ok(!res.body.includes("not yet available in Hindi"));

  res = await render("blog/monsoon-drains-2026", sb);
  h = res.body;
  cleanOutput(h, "live post");
  assert.ok(h.includes("Compiled automatically from public sources and official notices."));
  assert.ok(!h.includes("<script>alert"), "body sanitised");
  assert.ok(h.includes("<p>Body text</p>"));
  const news = lds(h).find((x) => x["@type"] === "NewsArticle");
  assert.equal(news.datePublished, "2026-10-01T05:00:00.000Z");
  assert.deepEqual(news.image, ["https://proj.supabase.co/storage/v1/object/public/media/news/drains.jpg"]);
  assert.ok(h.includes('property="og:type" content="article"'));
  assert.ok(h.includes('property="og:image" content="https://proj.supabase.co/storage/v1/object/public/media/news/drains.jpg"'));

  res = await render("hi/blog/monsoon-drains-2026", sb);
  assert.ok(res.body.includes("यह पोस्ट अभी हिंदी में उपलब्ध नहीं है"), "fallback note");
  assert.ok(res.body.includes("<p>Body text</p>"));
  assert.ok(res.body.includes("मानसून से पहले नाले साफ़"));

  res = await render("blog/no-such-post", sb);
  assert.equal(res.statusCode, 404);
  assert.equal(normalisePost({ slug: "Bad Slug", published: true }), null);
});

test("sitemap lists every page pair with alternates and is well formed", async () => {
  const res = fakeRes();
  await sitemapHandle({ method: "GET" }, res, fakeSb({ tables: { posts: POSTS } }), ENV);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "application/xml; charset=utf-8");
  assert.equal(res.headers["cache-control"], "public, s-maxage=3600, stale-while-revalidate=86400");
  const x = res.body;
  assert.ok(x.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(x.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"'));
  assert.ok(x.includes("<loc>https://gurugramvisionforum.org/guide/roads</loc>"));
  assert.ok(x.includes("<loc>https://gurugramvisionforum.org/hi/guide/roads</loc>"));
  assert.ok(x.includes('<xhtml:link rel="alternate" hreflang="hi-IN" href="https://gurugramvisionforum.org/hi/guide/roads"/>'));
  assert.ok(x.includes('<xhtml:link rel="alternate" hreflang="x-default" href="https://gurugramvisionforum.org/guide/roads"/>'));
  assert.ok(x.includes("<loc>https://gurugramvisionforum.org/ward/36</loc>") && x.includes("<loc>https://gurugramvisionforum.org/hi/ward/36</loc>"));
  assert.ok(x.includes("<loc>https://gurugramvisionforum.org/blog/monsoon-drains-2026</loc>"));
  assert.ok(x.includes("<lastmod>2026-10-01</lastmod>"));
  assert.ok(x.includes(`<lastmod>${BUILD_DATE}</lastmod>`));
  for (const r of ["/", "/report", "/pulse", "/privacy"]) assert.ok(x.includes(`<loc>https://gurugramvisionforum.org${r}</loc>`), r);
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|#39;)/.test(x), "no unescaped ampersand");
  assert.ok(!x.includes("draft-only"));
  const opens = (x.match(/<url>/g) || []).length, closes = (x.match(/<\/url>/g) || []).length;
  assert.equal(opens, closes);
  assert.equal(opens, 14 + 2 * (1 + gvf().CATS.length + 36 + 1 + gvf().BLOG.length + 1));
  // without a database: static posts only
  const plain = buildSitemap(mergePosts([]));
  assert.ok(plain.includes("/blog/segregate-at-source</loc>"));
});

test("robots.txt", () => {
  const txt = readFileSync(new URL("../../site/robots.txt", import.meta.url), "utf8");
  assert.ok(/User-agent: \*\nAllow: \//.test(txt));
  assert.ok(txt.includes("Disallow: /api/"));
  assert.ok(txt.includes("Disallow: /desk"));
  assert.ok(txt.includes("Sitemap: https://gurugramvisionforum.org/sitemap.xml"));
});

test("indexnow key: 404 when unset, text/plain when set", () => {
  let res = fakeRes();
  indexnow({ method: "GET" }, res, {});
  assert.equal(res.statusCode, 404);
  res = fakeRes();
  indexnow({ method: "GET" }, res, { INDEXNOW_KEY: "a1b2c3d4e5f6a7b8c9d0" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "text/plain; charset=utf-8");
  assert.equal(res.body, "a1b2c3d4e5f6a7b8c9d0");
  res = fakeRes();
  indexnow({ method: "POST" }, res, { INDEXNOW_KEY: "a1b2c3d4e5f6a7b8c9d0" });
  assert.equal(res.statusCode, 405);
});

test("google search console file: match and mismatch", () => {
  const env = { GSC_FILE: "google1234abcd.html" };
  let res = fakeRes();
  gsc({ method: "GET", query: { file: "google1234abcd.html" } }, res, env);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(res.body, "google-site-verification: google1234abcd.html");
  for (const file of ["google9999ffff.html", "", "../google1234abcd.html", "google1234abcd.html.bak"]) {
    res = fakeRes();
    gsc({ method: "GET", query: { file } }, res, env);
    assert.equal(res.statusCode, 404, JSON.stringify(file));
  }
  res = fakeRes();
  gsc({ method: "GET", query: { file: "google1234abcd.html" } }, res, {});
  assert.equal(res.statusCode, 404, "unset env");
});

test("vercel.json carries the rewrites and bundles site/data.js", () => {
  const v = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
  const map = Object.fromEntries(v.rewrites.map((r) => [r.source, r.destination]));
  assert.equal(map["/guides"], "/api/index?path=page/guides");
  assert.equal(map["/hi/guide/:slug"], "/api/index?path=page/hi/guide/:slug");
  assert.equal(map["/ward/:n"], "/api/index?path=page/ward/:n");
  assert.equal(map["/hi/blog/:slug"], "/api/index?path=page/hi/blog/:slug");
  assert.equal(map["/sitemap.xml"], "/api/index?path=sitemap");
  assert.equal(map["/indexnow-key.txt"], "/api/index?path=indexnow");
  assert.equal(map["/:file(google[0-9a-f]+.html)"], "/api/index?path=gsc&file=:file");
  assert.equal(v.functions["api/index.js"].maxDuration, 60);
  assert.equal(v.functions["api/index.js"].includeFiles, "{site,data}/**");
  assert.equal(v.rewrites[0].source, "/api/:path*", "api rewrite stays first");
});
