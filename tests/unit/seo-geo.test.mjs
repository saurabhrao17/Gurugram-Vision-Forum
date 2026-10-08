import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { buildLlms, buildLlmsFull, geoQuestions, parseGrounded, askGemini, geoStep, AI_BOTS } from "../../lib/seo/geo.js";
import { handle as llmsHandle } from "../../lib/handlers/llms.js";
import { clustersOf, relatedFor, clusterHealth, membersOf } from "../../lib/seo/clusters.js";
import { geoChecks, schemaProblems, internalPaths, unknownTargets, linkGraph, judgeSite, checklist, auditHtml } from "../../lib/seo/audit.js";
import { readServiceAccount, signJwt, windowOf, searchRows, indexRow, sitemapRow, gscStep, gscSite } from "../../lib/seo/gsc.js";
import { bingDate, pickSite, sumStats, crawlRow, bingStep } from "../../lib/seo/bing.js";
import { searchView, geoView, indexView, makeHandler } from "../../lib/handlers/triage/seo.js";
import { renderBlogPost } from "../../lib/seo/blog.js";
import { renderGuide } from "../../lib/seo/guides.js";
import { renderWard, wardById } from "../../lib/seo/wards.js";
import { staticPosts } from "../../lib/seo/data.js";
import { gvf } from "../../lib/site-data.js";
import { HttpError } from "../../lib/auth.js";
import { aiComplete, bestGeminiModel, resetGeminiDiscovery } from "../../lib/ai.js";

const SITE = "https://gurugramvisionforum.org";
const ENV = { SITE_URL: SITE };
const CATS = gvf().CATS;
const DAY = 86400000;

function fakeSb(tables = {}) {
  const writes = [];
  const chain = (table) => {
    const c = { _rows: tables[table] || [], then(r) { r({ data: c._rows, error: null }); } };
    for (const m of ["select", "eq", "in", "gte", "lt", "order", "limit", "is", "not", "contains"]) c[m] = () => c;
    c.upsert = (data, opts) => { writes.push({ table, op: "upsert", data, opts }); return c; };
    c.insert = (data) => { writes.push({ table, op: "insert", data }); return c; };
    c.delete = () => { writes.push({ table, op: "delete" }); return c; };
    c.maybeSingle = async () => ({ data: null, error: null });
    return c;
  };
  return { from: chain, writes };
}
const resOf = () => { const r = { statusCode: 0, headers: {}, body: null, status(s) { r.statusCode = s; return r; }, setHeader(k, v) { r.headers[k.toLowerCase()] = v; }, end(b) { r.body = b; } }; return r; };

// ---------------------------------------------------------------- GEO files
test("llms.txt: title, summary, every guide and ward, recent posts with their topic, no party or contact details", () => {
  const posts = [{ slug: "drains-sector-45", title: "Drains in Sector 45 before the monsoon", summary: "What MCG cleared and what is left.", tags: ["drains"] }];
  const t = buildLlms({ posts, env: ENV });
  assert.match(t, /^# Gurugram Vision Forum\n\n> /);
  for (const c of CATS) assert.ok(t.includes(`(${SITE}/guide/${c.id})`), c.id);
  assert.equal((t.match(/\]\(https:\/\/gurugramvisionforum\.org\/ward\/\d+\)/g) || []).length, 36);
  assert.ok(t.includes(`[Drains in Sector 45 before the monsoon](${SITE}/blog/drains-sector-45)`) && t.includes("(topic: Drains, flooding)"));
  assert.ok(t.includes("## Optional") && t.includes(`${SITE}/llms-full.txt`));
  assert.ok(!/\b(BJP|Congress|JJP)\b/.test(t), "no party framing");
  assert.ok(!/@[a-z]+\.(org|com|in)\b/i.test(t), "no email address");
});

test("llms-full.txt carries every guide with who is responsible, the ladder and the FAQ", () => {
  const t = buildLlmsFull({ env: ENV });
  for (const c of CATS) assert.ok(t.includes(`## ${c.label}\n`), c.id);
  assert.ok((t.match(/^Q: /gm) || []).length >= CATS.length * 3);
  assert.ok(/\*\*Who is responsible:\*\* GMDA for master roads, MCG for internal roads\. GMDA owns/.test(t), "agency line ends with a full stop");
});

test("llms handler answers plain text with an edge cache, HEAD too; POST refused", async () => {
  const r = resOf();
  await llmsHandle({ method: "GET" }, r, null, ENV);
  assert.equal(r.statusCode, 200);
  assert.match(r.headers["content-type"], /text\/plain/);
  assert.match(r.headers["cache-control"], /s-maxage=3600/);
  assert.match(r.body, /^# Gurugram Vision Forum/);
  const f = resOf();
  await llmsHandle({ method: "HEAD" }, f, null, ENV, true);
  assert.match(f.body, /civic issue guides/);
  const p = resOf();
  await llmsHandle({ method: "POST" }, p, null, ENV);
  assert.equal(p.statusCode, 405);
});

test("robots.txt welcomes every AI crawler by name and keeps /api and the desk closed in each group", () => {
  const r = readFileSync("site/robots.txt", "utf8");
  for (const b of AI_BOTS) assert.ok(r.includes(`User-agent: ${b}\n`), b);
  const groups = r.split(/\n\s*\n/).filter((g) => /User-agent:/.test(g));
  assert.equal(groups.length, 2);
  for (const g of groups) assert.ok(/Allow: \/\n/.test(g) && /Disallow: \/api\//.test(g) && /Disallow: \/desk/.test(g));
  assert.match(r, /Sitemap: https:\/\/gurugramvisionforum\.org\/sitemap\.xml/);
});

// ---------------------------------------------------------------- GEO checks
test("geoChecks: each readiness check passes and fails on its own", () => {
  const org = { "@type": "Organization", name: "GVF", url: SITE };
  const faq = { "@type": "FAQPage", dateModified: "2026-10-08", mainEntity: [] };
  const b = `<h1>Who fixes roads?</h1><p class="lead">GMDA fixes master roads; MCG fixes internal roads and footpaths.</p><h2>How do I complain?</h2><a href="https://www.mcg.gov.in/">MCG</a><a href="https://services.gmda.gov.in/">GMDA</a>`;
  const ok = geoChecks({ b, objs: [org, faq], words: 400, kind: "guide", official: 2 });
  assert.deepEqual(ok, { score: 100, missing: [] });
  const bad = geoChecks({ b: "<h1>Roads</h1><p>Short.</p><h2>Details</h2>", objs: [], words: 50, kind: "guide", official: 0 });
  assert.deepEqual(bad.missing.sort(), ["answer", "dated", "depth", "publisher", "questions", "sources", "structured"]);
  assert.equal(bad.score, 0);
  assert.equal(geoChecks({ b, objs: [org, faq], words: 130, kind: "ward", official: 1 }).score, 100, "wards need fewer words and one source");
});

test("the rendered guide, ward and blog pages score full GEO readiness except where the content itself is short", () => {
  for (const lang of ["en", "hi"]) {
    const g = auditHtml(renderGuide(CATS[0], { lang }), { url: `${SITE}/${lang === "hi" ? "hi/" : ""}guide/${CATS[0].id}`, lang, kind: "guide" });
    assert.deepEqual(g.facts.geo, { score: 100, missing: [] }, "guide " + lang);
    const w = auditHtml(renderWard(wardById(5), { lang }), { url: `${SITE}/${lang === "hi" ? "hi/" : ""}ward/5`, lang, kind: "ward" });
    assert.deepEqual(w.facts.geo, { score: 100, missing: [] }, "ward " + lang);
  }
  const html = renderGuide(CATS[0], { lang: "en" });
  assert.match(html, /<time datetime="2026-10-08">Facts and official links last checked on 8 Oct 2026\.<\/time>/);
  assert.match(html, /"dateModified":"2026-10-08"/);
  const ward = renderWard(wardById(5), { lang: "en" });
  assert.match(ward, /<p class="lead">Ward 5 of the Municipal Corporation of Gurugram is represented by councillor /);
  assert.ok(ward.includes('href="https://www.mcg.gov.in/"') && ward.includes('href="https://gurugram.gov.in/public-representative/"'));
});

test("schemaProblems names what each type is missing", () => {
  assert.deepEqual(schemaProblems([{ "@type": "FAQPage", mainEntity: [] }, { "@type": "BlogPosting", headline: "x" }, { "@type": "Organization", name: "a", url: "b" }, { "@type": "Thing" }]),
    ["FAQPage needs questions with answers", "BlogPosting needs headline, datePublished, author and publisher"]);
  assert.deepEqual(schemaProblems([{ "@type": "BreadcrumbList", itemListElement: [{ position: 1, name: "Home", item: SITE }] }]), []);
});

// ---------------------------------------------------------------- link crawl
test("internalPaths keeps the site's own paths only, normalised", () => {
  assert.deepEqual(internalPaths(["/guide/roads", "/guide/roads?x=1#a", `${SITE}/ward/2/`, "#top", "//cdn.x/y", "https://www.mcg.gov.in/", "mailto:a@b", "/api/dashboard", "/"], SITE), ["/guide/roads", "/ward/2", "/"]);
});

test("unknownTargets skips sitemap pages, app views and static files; linkGraph finds orphans and broken links", () => {
  const pages = [
    { path: "/guide/roads", kind: "guide", status: 200, facts: { out: ["/guide/waste", "/report", "/styles.css", "/guide/old", "/hi/guide/roads"] } },
    { path: "/guide/waste", kind: "guide", status: 200, facts: { out: ["/guide/roads"] } },
    { path: "/ward/9", kind: "ward", status: 200, facts: { out: ["/guide/roads"] } },
    { path: "/hi/guide/roads", kind: "guide", status: 200, facts: { out: [] } }
  ];
  assert.deepEqual(unknownTargets(pages, ["/guide/roads", "/guide/waste", "/ward/9", "/hi/guide/roads"]), ["/guide/old"]);
  const g = linkGraph(pages, [{ url: "/guide/old", status: 404, ok: false }, { url: "/x", status: 200, ok: true }], { complete: true });
  assert.deepEqual(g.orphans, ["/ward/9"]);
  assert.deepEqual(g.broken, [{ url: "/guide/old", status: 404, sources: ["/guide/roads"] }]);
  assert.deepEqual(linkGraph(pages, [], { complete: false }).orphans, [], "no orphans until the whole sitemap is crawled");
});

test("judgeSite reads robots, sitemap, llms.txt, headers and both redirects", () => {
  const h = (o) => ({ status: o.status ?? 200, text: o.text || "", get: (k) => (o.headers || {})[k] || null });
  const good = judgeSite({
    robots: h({ text: readFileSync("site/robots.txt", "utf8") }), sitemap: h({ text: "<urlset><url></url><url></url></urlset>" }), llms: h({ text: "# GVF\n[a](b)" }),
    home: h({ headers: { "strict-transport-security": "max-age=1", "content-security-policy": "frame-ancestors 'none'", "x-content-type-options": "nosniff" } }),
    www: h({ status: 308, headers: { location: `${SITE}/` } }), http: h({ status: 308, headers: { location: `${SITE}/` } }), host: "gurugramvisionforum.org"
  });
  assert.deepEqual(good.map((r) => [r.key, r.ok]), [["robots", true], ["sitemap", true], ["llms", true], ["headers", true], ["www", true], ["https", true]]);
  assert.ok(good[0].data.ai_bots.length >= 5);
  assert.equal(good[1].detail, "2 URLs listed");
  const bad = judgeSite({ robots: h({ text: "User-agent: *\nDisallow: /\n" }), sitemap: h({ status: 500 }), llms: h({ status: 404 }), home: h({}), www: h({ status: 200 }), http: h({ status: 200 }), host: "gurugramvisionforum.org" });
  assert.ok(bad.every((r) => r.ok === false));
  assert.equal(bad[0].detail, "robots.txt blocks the whole site");
});

// ---------------------------------------------------------------- AI answers
test("parseGrounded finds the Forum among the grounding sources, by domain title or URI", () => {
  const j = { candidates: [{ content: { parts: [{ text: "Potholes on internal roads are MCG's job. The Gurugram Vision Forum guide explains it." }] }, groundingMetadata: { groundingChunks: [{ web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/x", title: "mcg.gov.in" } }, { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/y", title: "gurugramvisionforum.org" } }] } }] };
  const p = parseGrounded(j, "gurugramvisionforum.org");
  assert.equal(p.cited, true); assert.equal(p.position, 2); assert.equal(p.mentioned, true); assert.equal(p.sources.length, 2);
  const q = parseGrounded({ candidates: [{ content: { parts: [{ text: "Ask MCG." }] }, groundingMetadata: { groundingChunks: [{ web: { uri: "https://x", title: "hindustantimes.com" } }] } }] }, "gurugramvisionforum.org");
  assert.deepEqual([q.cited, q.position, q.mentioned], [false, null, false]);
  assert.equal(parseGrounded({}, "x"), null);
});

test("askGemini asks with the Google Search tool and, when the model is retired, uses the newest Flash model the key can list", async () => {
  resetGeminiDiscovery();
  const calls = [];
  const ok = { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "ok" }] }, groundingMetadata: { groundingChunks: [] } }] }) };
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
    if (/\/models\?/.test(url)) return { ok: true, status: 200, json: async () => ({ models: [{ name: "models/gemini-3-flash", supportedGenerationMethods: ["generateContent"] }] }) };
    if (/gemini-flash-latest/.test(url)) return { ok: false, status: 404, json: async () => ({}) };
    return ok;
  };
  const r = await askGemini({ GEMINI_API_KEY: "K" }, "Who fixes roads?", fetchImpl, "gurugramvisionforum.org");
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /gemini-flash-latest:generateContent\?key=K/);
  assert.deepEqual(calls[0].body.tools, [{ google_search: {} }]);
  assert.match(calls[1].url, /\/v1beta\/models\?pageSize=200&key=K$/);
  assert.match(calls[2].url, /gemini-3-flash:generateContent/);
  assert.equal(r.cited, false); assert.equal(r.model, "gemini-3-flash");
  const q = await askGemini({ GEMINI_API_KEY: "K" }, "x", async () => ({ ok: false, status: 429, json: async () => ({ error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for metric: search_grounding_free_tier, limit: 0 (key=abc)" } }) }), "h");
  assert.equal(q.error, "http_429_RESOURCE_EXHAUSTED: Quota exceeded for metric: search_grounding_free_tier, limit: 0 (key=…)");
  assert.equal(q.status, 429);
  resetGeminiDiscovery();
});

test("bestGeminiModel prefers the -latest alias, then the newest stable Flash, never lite or image variants", () => {
  const list = (...n) => ({ models: n.map((x) => ({ name: "models/" + x, supportedGenerationMethods: ["generateContent"] })) });
  assert.equal(bestGeminiModel(list("gemini-2.5-flash", "gemini-flash-latest")), "gemini-flash-latest");
  assert.equal(bestGeminiModel(list("gemini-2.5-flash", "gemini-3-flash-preview", "gemini-3-flash-lite", "gemini-2.5-flash-image")), "gemini-3-flash-preview");
  assert.equal(bestGeminiModel(list("gemini-3-flash-preview", "gemini-3-flash")), "gemini-3-flash");
  assert.equal(bestGeminiModel({ models: [{ name: "models/gemini-3-flash", supportedGenerationMethods: ["embedContent"] }] }), null);
  assert.equal(bestGeminiModel(null), null);
});

test("aiComplete retries a retired Gemini model once with the discovered one", async () => {
  resetGeminiDiscovery();
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (/\/models\?/.test(url)) return { ok: true, status: 200, json: async () => ({ models: [{ name: "models/gemini-3-flash", supportedGenerationMethods: ["generateContent"] }] }) };
    if (/gemini-flash-latest/.test(url)) return { ok: false, status: 404, json: async () => ({ error: { status: "NOT_FOUND" } }) };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{}" }] } }] }) };
  };
  const r = await aiComplete({ GEMINI_API_KEY: "K" }, { system: "s", user: "u" }, fetchImpl);
  assert.equal(r.ok, true); assert.equal(r.model, "gemini-3-flash"); assert.equal(urls.length, 3);
  resetGeminiDiscovery();
});

test("geoStep asks the questions not asked longest, stores each answer, and skips without a key", async () => {
  const qs = geoQuestions();
  assert.equal(qs.length, CATS.length + 3);
  const asked = qs.slice(1).map((q, i) => ({ question_key: q.key, checked_at: new Date(Date.UTC(2026, 9, 1 + (i % 5))).toISOString() }));
  const sb = fakeSb({ seo_geo: asked });
  const texts = [];
  const fetchImpl = async (url, init) => { texts.push(JSON.parse(init.body).contents[0].parts[0].text); return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "See gurugramvisionforum.org" }] }, groundingMetadata: { groundingChunks: [{ web: { uri: "u", title: "gurugramvisionforum.org" } }] } }] }) }; };
  const out = await geoStep(sb, { ...ENV, GEMINI_API_KEY: "K" }, { fetch: fetchImpl, now: Date.UTC(2026, 9, 8), limit: 2 });
  assert.deepEqual(out, { asked: 2, cited: 2, failed: 0 });
  assert.equal(texts[0], qs[0].text, "the never-asked question goes first");
  const ins = sb.writes.filter((w) => w.op === "insert");
  assert.equal(ins.length, 2);
  assert.equal(ins[0].data.cited, true); assert.equal(ins[0].data.position, 1); assert.equal(ins[0].data.engine, "gemini-search");
  assert.equal((await geoStep(fakeSb(), ENV, { fetch: fetchImpl })).skipped, "no_key");
  // Out of quota: one failed row, the rest wait for the next night.
  let n = 0;
  const sb2 = fakeSb();
  const out2 = await geoStep(sb2, { ...ENV, GEMINI_API_KEY: "K" }, { fetch: async () => { n++; return { ok: false, status: 429, json: async () => ({ error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } }) }; }, now: Date.UTC(2026, 9, 8), limit: 3 });
  assert.deepEqual([out2.failed, out2.stopped, n], [1, "quota", 1]);
  assert.match(sb2.writes.find((w) => w.op === "insert").data.error, /^http_429_RESOURCE_EXHAUSTED: Quota exceeded$/);
});

// ---------------------------------------------------------------- clusters
test("clusters: tags decide, the classifier needs two keywords, general explainers stay out", () => {
  assert.deepEqual(clustersOf({ title: "x", tags: ["Roads", "sewa", "waste", "drains"] }), ["roads", "waste"]);
  assert.deepEqual(clustersOf({ title: "Garbage dumping near the market", summary: "No sweeper for a week", tags: [] }), ["waste"]);
  assert.deepEqual(clustersOf({ title: "Garbage", summary: "", tags: [] }), [], "one keyword is not enough");
  const posts = staticPosts();
  assert.equal(JSON.stringify(posts.map((p) => clustersOf(p))), JSON.stringify([[], [], [], ["waste"]]));
  const rel = relatedFor(posts[3], [...posts, { slug: "waste-camp", title: "Waste camp", tags: ["waste"] }]);
  assert.deepEqual(rel.pillars.map((c) => c.id), ["waste"]);
  assert.deepEqual(rel.siblings.map((p) => p.slug), ["waste-camp"]);
  assert.equal(membersOf("waste", posts).length, 1);
});

test("clusterHealth: gap where people talk and nothing is published, stale when old, thin when only the guide", () => {
  const now = Date.UTC(2026, 9, 8);
  const sig = (issue, d) => ({ issue_type: issue, posted_at: new Date(now - d * DAY).toISOString() });
  const posts = [{ slug: "a", title: "A", tags: ["waste"], date: new Date(now - 10 * DAY) }, { slug: "b", title: "B", tags: ["water"], date: new Date(now - 200 * DAY) }];
  const h = clusterHealth({ posts, signals: [sig("roads", 1), sig("roads", 2), sig("water", 3), sig("roads", 40)], now });
  const by = Object.fromEntries(h.map((c) => [c.id, c]));
  assert.equal(h.length, CATS.length);
  assert.deepEqual([by.roads.status, by.roads.demand, by.roads.members], ["gap", 2, 0]);
  assert.equal(by.water.status, "stale"); assert.match(by.water.action, /200 days old/);
  assert.equal(by.waste.status, "ok");
  assert.equal(by.parks.status, "thin");
  assert.equal(h[0].status, "gap", "gaps sort first");
});

test("a blog post links to its pillar guide and siblings, and names its topic in the structured data", () => {
  const post = staticPosts()[3];
  const html = renderBlogPost(post, { lang: "en", related: { pillars: [CATS.find((c) => c.id === "waste")], siblings: [{ slug: "waste-camp", title: "Waste camp" }] } });
  assert.ok(html.includes('href="/guide/waste"') && html.includes("Read the guide") && html.includes('href="/blog/waste-camp"') && html.includes("More on this topic"));
  assert.match(html, /"about":\[\{"@type":"Thing","name":"Garbage"\}\]/);
  const hi = renderBlogPost(post, { lang: "hi", related: { pillars: [CATS.find((c) => c.id === "waste")], siblings: [] } });
  assert.ok(hi.includes('href="/hi/guide/waste"') && hi.includes("पूरी मार्गदर्शिका पढ़ें"));
  assert.ok(!renderBlogPost(post, { lang: "en" }).includes("Read the guide"), "no section without related links");
});

// ---------------------------------------------------------------- Search Console
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const SA = JSON.stringify({ client_email: "gvf@gvf-seo.iam.gserviceaccount.com", private_key: privateKey.replace(/\n/g, "\\n") });

test("Search Console: service account read, JWT signed RS256 and verifiable, window trails two days", () => {
  const sa = readServiceAccount({ GSC_SERVICE_ACCOUNT: SA });
  assert.equal(sa.email, "gvf@gvf-seo.iam.gserviceaccount.com");
  assert.ok(sa.key.includes("\n-----END PRIVATE KEY-----") || sa.key.includes("PRIVATE KEY"));
  assert.equal(readServiceAccount({ GSC_SERVICE_ACCOUNT: "{bad" }), null);
  assert.equal(readServiceAccount({}), null);
  const jwt = signJwt(sa, Date.UTC(2026, 9, 8));
  const [h, c, s] = jwt.split(".");
  const v = createVerify("RSA-SHA256"); v.update(`${h}.${c}`);
  assert.ok(v.verify(publicKey, Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64")));
  const claims = JSON.parse(Buffer.from(c.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  assert.equal(claims.scope, "https://www.googleapis.com/auth/webmasters.readonly");
  assert.equal(claims.exp - claims.iat, 3600);
  assert.deepEqual(windowOf(Date.UTC(2026, 9, 8)), { start: "2026-09-09", end: "2026-10-06" });
  assert.equal(gscSite(ENV), "sc-domain:gurugramvisionforum.org");
});

test("Search Console rows: analytics, inspection and sitemap shapes", () => {
  const rows = searchRows({ rows: [{ keys: [`${SITE}/guide/roads`], clicks: 3, impressions: 120, ctr: 0.025, position: 8.4 }] }, "page", { start: "a", end: "b" }, SITE);
  assert.deepEqual(rows[0], { source: "google", dim: "page", key: "/guide/roads", clicks: 3, impressions: 120, ctr: 0.025, position: 8.4, period_start: "a", period_end: "b" });
  const ix = indexRow(`${SITE}/`, { inspectionResult: { indexStatusResult: { verdict: "PASS", coverageState: "Submitted and indexed", lastCrawlTime: "2026-10-07T01:00:00Z", googleCanonical: `${SITE}/` } } });
  assert.deepEqual([ix.verdict, ix.coverage, ix.last_crawl], ["PASS", "Submitted and indexed", "2026-10-07T01:00:00Z"]);
  const sm = sitemapRow({ sitemap: [{ path: `${SITE}/sitemap.xml`, lastDownloaded: "2026-10-08T05:00:00Z", errors: "0", contents: [{ type: "web", submitted: "131", indexed: "40" }] }] });
  assert.equal(sm.ok, true); assert.equal(sm.detail, "131 URLs submitted, 40 indexed; read by Google 2026-10-08");
  assert.equal(sitemapRow({}).ok, false);
});

test("gscStep: token, two analytics queries, sitemaps and the inspections, each stored", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push(url);
    const ok = (j) => ({ ok: true, status: 200, json: async () => j });
    if (url.startsWith("https://oauth2.googleapis.com/token")) { assert.match(init.body, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=/); return ok({ access_token: "T" }); }
    assert.equal(init.headers.authorization, "Bearer T");
    if (url.includes("searchAnalytics")) { const dim = JSON.parse(init.body).dimensions[0]; return ok({ rows: [{ keys: [dim === "page" ? `${SITE}/` : "who fixes potholes gurugram"], clicks: 1, impressions: 10, ctr: 0.1, position: 5 }] }); }
    if (url.endsWith("/sitemaps")) return ok({ sitemap: [{ path: "x", errors: "0", contents: [{ type: "web", submitted: "131" }] }] });
    if (url.includes("urlInspection")) return ok({ inspectionResult: { indexStatusResult: { verdict: "PASS" } } });
    throw new Error("unexpected " + url);
  };
  const sb = fakeSb();
  const out = await gscStep(sb, { ...ENV, GSC_SERVICE_ACCOUNT: SA }, { fetch: fetchImpl, now: Date.UTC(2026, 9, 8), urls: [`${SITE}/`, `${SITE}/guide/roads`] });
  assert.deepEqual([out.queries, out.pages, out.inspected], [1, 1, 2]);
  assert.ok(calls.some((u) => u.includes("sites/sc-domain%3Agurugramvisionforum.org/searchAnalytics/query")));
  assert.deepEqual(sb.writes.map((w) => w.table), ["seo_search", "seo_search", "seo_site", "seo_index", "seo_index"]);
  assert.equal((await gscStep(fakeSb(), ENV, { fetch: fetchImpl })).skipped, "no_key");
  assert.equal((await gscStep(fakeSb(), { GSC_SERVICE_ACCOUNT: "{" }, { fetch: fetchImpl })).skipped, "bad_key");
  // Out of time: no new inspection starts; the rest wait for the next night.
  let t = 0;
  const late = await gscStep(fakeSb(), { ...ENV, GSC_SERVICE_ACCOUNT: SA }, { fetch: fetchImpl, now: Date.UTC(2026, 9, 8), urls: [`${SITE}/`, `${SITE}/guide/roads`], budgetMs: 1000, clock: () => (t++ ? 5000 : 0) });
  assert.deepEqual([late.queries, late.inspected, late.deferred], [1, 0, 2]);
});

test("ward pages link to the app's /wards in both languages, never a /hi/wards that does not exist", () => {
  const hi = renderWard(wardById(5), { lang: "hi" });
  assert.ok(!hi.includes('href="/hi/wards"'), "no /hi/wards link");
  assert.ok(hi.includes('href="/wards"'));
  assert.ok(hi.includes('href="/hi/guides"'), "pages the server renders in Hindi keep the prefix");
});

// ---------------------------------------------------------------- Bing
test("Bing: dates, the registered site, 28-day sums with weighted position, crawl stats", () => {
  assert.equal(bingDate("/Date(1316156400000-0700)/"), 1316156400000);
  assert.equal(pickSite([{ Url: "https://other.org/" }, { Url: "http://gurugramvisionforum.org/", IsVerified: true }, { Url: "https://gurugramvisionforum.org/", IsVerified: true }], "gurugramvisionforum.org"), "https://gurugramvisionforum.org/");
  assert.equal(pickSite([{ Url: "https://other.org/" }], "gurugramvisionforum.org"), null);
  const now = Date.UTC(2026, 9, 8);
  const d = (days) => `/Date(${now - days * DAY}+0000)/`;
  const rows = sumStats([
    { Date: d(1), Query: "gurugram potholes", Clicks: 2, Impressions: 10, AvgImpressionPosition: 4 },
    { Date: d(2), Query: "gurugram potholes", Clicks: 0, Impressions: 30, AvgImpressionPosition: 8 },
    { Date: d(40), Query: "old query", Clicks: 9, Impressions: 99, AvgImpressionPosition: 1 }
  ], "query", { now });
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].key, rows[0].clicks, rows[0].impressions, rows[0].position, rows[0].ctr], ["gurugram potholes", 2, 40, 7, 0.05]);
  const pages = sumStats([{ Date: d(1), Query: "https://gurugramvisionforum.org/guide/roads", Clicks: 1, Impressions: 5, AvgImpressionPosition: 3 }], "page", { now, site: "https://gurugramvisionforum.org/" });
  assert.equal(pages[0].key, "/guide/roads");
  const cr = crawlRow([{ Date: d(2), CrawledPages: 5 }, { Date: d(1), CrawledPages: 20, InIndex: 15, CrawlErrors: 0, Code4xx: 1 }], now);
  assert.equal(cr.ok, false); assert.match(cr.detail, /^15 pages in Bing's index, 20 crawled on 2026-10-07, 1 errors$/);
});

test("bingStep finds the site, stores queries, pages and crawl stats; says so when the site is not in the account", async () => {
  const fetchImpl = async (url) => {
    const ok = (d) => ({ ok: true, status: 200, json: async () => ({ d }) });
    assert.match(url, /apikey=BK/);
    if (url.includes("GetUserSites")) return ok([{ Url: "https://gurugramvisionforum.org/", IsVerified: true }]);
    if (url.includes("GetQueryStats")) return ok([{ Date: `/Date(${Date.UTC(2026, 9, 7)})/`, Query: "q", Clicks: 1, Impressions: 2, AvgImpressionPosition: 3 }]);
    if (url.includes("GetPageStats")) return ok([]);
    if (url.includes("GetCrawlStats")) return ok([{ Date: `/Date(${Date.UTC(2026, 9, 7)})/`, CrawledPages: 3, InIndex: 3 }]);
    throw new Error(url);
  };
  const sb = fakeSb();
  const out = await bingStep(sb, { ...ENV, BING_WEBMASTER_API_KEY: "BK" }, { fetch: fetchImpl, now: Date.UTC(2026, 9, 8) });
  assert.deepEqual([out.site, out.queries, out.pages], ["https://gurugramvisionforum.org/", 1, 0]);
  assert.deepEqual(sb.writes.map((w) => w.table), ["seo_search", "seo_site"]);
  const none = await bingStep(fakeSb(), { ...ENV, BING_WEBMASTER_API_KEY: "BK" }, { fetch: async () => ({ ok: true, status: 200, json: async () => ({ d: [] }) }) });
  assert.equal(none.skipped, "site_not_in_account");
  assert.equal((await bingStep(fakeSb(), ENV, { fetch: fetchImpl })).skipped, "no_key");
});

// ---------------------------------------------------------------- desk view
test("searchView, geoView and indexView shape the desk's data", () => {
  const sv = searchView([
    { source: "google", dim: "query", key: "old", impressions: 999, period_start: "2026-09-01", period_end: "2026-09-28" },
    { source: "google", dim: "query", key: "a", clicks: 1, impressions: 5, period_start: "2026-09-09", period_end: "2026-10-06" },
    { source: "google", dim: "query", key: "b", clicks: 0, impressions: 9, period_start: "2026-09-09", period_end: "2026-10-06" },
    { source: "google", dim: "page", key: "/", clicks: 2, impressions: 20, period_start: "2026-09-09", period_end: "2026-10-06" }
  ]);
  assert.deepEqual(sv.google.queries.map((q) => q.key), ["b", "a"], "newest period only, by impressions");
  assert.deepEqual(sv.google.period, { start: "2026-09-09", end: "2026-10-06" });
  assert.deepEqual(sv.google.totals, { clicks: 2, impressions: 20 });
  assert.equal(sv.bing, null);
  const now = Date.UTC(2026, 9, 8);
  const gv = geoView([{ status: 200, facts: { geo: { score: 100, missing: [] } } }, { status: 200, facts: { geo: { score: 60, missing: ["dated", "sources"] } } }],
    [{ question_key: "issue:roads", cited: true, checked_at: new Date(now - DAY).toISOString() }, { question_key: "issue:roads", cited: false, checked_at: new Date(now - 2 * DAY).toISOString() }, { question_key: "issue:waste", cited: false, checked_at: new Date(now - DAY).toISOString() }], { now });
  assert.deepEqual([gv.pages, gv.avg, gv.asked, gv.cited], [2, 80, 2, 1]);
  assert.equal(gv.missing[0].label, "Dated, so freshness is visible");
  assert.equal(gv.questions.find((q) => q.key === "issue:roads").cited, true, "the newest answer per question counts");
  const iv = indexView([{ url: "a", verdict: "PASS" }, { url: "b", verdict: "NEUTRAL", coverage: "Discovered - currently not indexed" }]);
  assert.deepEqual([iv.total, iv.indexed, iv.rows[0].url], [2, 1, "b"]);
});

test("checklist: the GEO, crawl and search rows follow their data and name the missing connection", () => {
  const site = { robots: { ok: true, detail: "ok", data: { ai_bots: AI_BOTS.slice(0, 5) } }, llms: { ok: true, detail: "60 links" }, headers: { ok: true, detail: "set", data: { hsts: true } }, www: { ok: true, detail: "308" }, https: { ok: true, detail: "308" }, sitemap: { ok: true, detail: "131 URLs listed" } };
  const by = (o) => Object.fromEntries(checklist(o).map((i) => [i.key, i]));
  const a = by({ env: { GEMINI_API_KEY: "k" }, site, crawl: { broken: [], orphans: [], complete: true }, geo: { pages: 10, avg: 92, asked: 4, cited: 1 }, clusters: [{ status: "ok", members: 2 }], search: { google: { queries: [{}], pages: [], period: { start: "a", end: "b" } } }, index: { total: 10, indexed: 9 }, connections: { gsc: true, bing: false } });
  assert.ok(a.llms.ok && a.ai_bots.ok && a.geo_ready.ok && a.ai_cited.ok && a.internal_links.ok && a.orphans.ok && a.clusters.ok && a.headers.ok && a.one_address.ok && a.gsc_data.ok && a.indexed.ok);
  assert.equal(a.bing_data.ok, false); assert.match(a.bing_data.detail, /BING_WEBMASTER_API_KEY/);
  const b = by({ env: {}, crawl: { broken: [{}], orphans: [], complete: false }, clusters: [{ status: "gap", members: 0 }], connections: {} });
  assert.equal(b.internal_links.ok, false); assert.equal(b.orphans.ok, null); assert.equal(b.clusters.ok, false);
  assert.match(b.ai_cited.detail, /GEMINI_API_KEY/); assert.match(b.gsc_data.detail, /GSC_SERVICE_ACCOUNT/);
});

test("GET /api/triage/seo carries clusters, GEO, search, index, crawl, site checks and connections, never a key", async () => {
  const authAs = (role) => async (req, roles) => { if (!roles.includes(role)) throw new HttpError(403, "forbidden"); return { staff: { role } }; };
  const sb = fakeSb({
    posts: [{ slug: "drains-45", title: "Drains in Sector 45", summary: "", tags: ["drains"], published_at: "2026-10-01T00:00:00Z" }],
    signals: [{ issue_type: "roads", posted_at: new Date().toISOString() }, { issue_type: "roads", posted_at: new Date().toISOString() }],
    seo_site: [{ key: "llms", ok: true, detail: "60 links", data: {} }],
    seo_search: [{ source: "bing", dim: "query", key: "q", clicks: 1, impressions: 3, period_start: "2026-09-10", period_end: "2026-10-07" }],
    seo_links: [{ url: "/gone", status: 404, ok: false }]
  });
  const r = resOf();
  await makeHandler({ auth: authAs("content"), sb, env: { ...ENV, GSC_SERVICE_ACCOUNT: SA, BING_WEBMASTER_API_KEY: "BK", GEMINI_API_KEY: "G" } })({ method: "GET", query: {} }, r);
  assert.equal(r.statusCode, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.clusters.length, CATS.length);
  assert.equal(j.clusters.find((c) => c.id === "drains").members, 1);
  assert.equal(j.clusters[0].id, "roads", "the roads gap comes first");
  assert.equal(j.geo.questions.length, CATS.length + 3);
  assert.equal(j.search.bing.queries[0].key, "q");
  assert.deepEqual(j.crawl.broken, [{ url: "/gone", status: 404, sources: [] }]);
  assert.deepEqual(j.connections, { gsc: true, bing: true, gemini: true, pagespeed: false });
  assert.equal(j.sitechecks[0].key, "llms");
  assert.equal(j.site, SITE, "the origin is not overwritten by the checks");
  assert.ok(!r.body.includes("PRIVATE KEY") && !r.body.includes("BK\"") && !r.body.includes('"G"'), "no secret reaches the desk");
});
