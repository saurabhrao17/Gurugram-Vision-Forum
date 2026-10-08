// GET /api/triage/seo -> the automated SEO desk (owner, coordinator, content team).
// Everything on it is produced by the cron (seo, vitals, mentions, indexnow,
// autopost, links steps); the handler only reads and summarises:
//   summary     pages audited, average score, open issues by code, last audit
//   checklist   the consultant's standing list with what is proved in place
//   pages       every audited page, worst first, with its issues (duplicates
//               across pages added on read)
//   vitals      the latest PageSpeed row per key page, plus the last 30 runs
//   mentions    the Forum in the news (Google News), newest first
//   opportunities  content gaps from the public pulse against recent posts
//   activity    the last cron runs' SEO-relevant results (what was done when)
//   clusters    one per issue: pillar guide, posts, freshness, demand, action
//   geo         GEO readiness across pages and the latest AI answer checks
//   search      Search Console and Bing queries and pages (28 days)
//   index       Google's index status for the pages inspected so far
//   crawl       broken internal links and orphan pages
//   sitechecks  robots.txt, sitemap, llms.txt, headers, redirects, crawl stats
//   connections which data sources are set up (never the keys themselves)
import { supabase } from "../../supabase.js";
import { requireStaff, handleError, CONTENT_ROLES } from "../../auth.js";
import { send, methodNotAllowed } from "../../http.js";
import { duplicates, opportunities, checklist, linkGraph, ISSUE_TEXT, GEO_CHECKS, OPPORTUNITY_DAYS, VITALS_PAGES } from "../../seo/audit.js";
import { clusterHealth } from "../../seo/clusters.js";
import { pipelineState, isTopicPost } from "../../seo/topics.js";
import { agentView } from "../../seo/agent.js";
import { geoQuestions } from "../../seo/geo.js";
import { readServiceAccount } from "../../seo/gsc.js";
import { staticPosts } from "../../seo/data.js";
import { loadSettings } from "../cron.js";
import { siteUrl } from "../../seo/site.js";

export const ROLES = CONTENT_ROLES;
const PAGE_COLS = "url, path, lang, kind, status, ms, title, description, words, score, issues, facts, checked_at";
const RUNS = 14;

export function summarise(pages, dups) {
  const byCode = {};
  let sum = 0, n = 0, errors = 0, last = null;
  for (const p of pages) {
    const issues = (p.issues || []).concat(dups.get(p.url) || []);
    for (const i of issues) byCode[i.code] = (byCode[i.code] || 0) + 1;
    if (p.status === 200 && Number.isFinite(p.score)) { sum += p.score; n++; } else errors++;
    if (p.checked_at && (!last || p.checked_at > last)) last = p.checked_at;
  }
  const issues = Object.entries(byCode).map(([code, count]) => ({ code, count, label: ISSUE_TEXT[code] || code })).sort((a, b) => b.count - a.count);
  return { pages: pages.length, audited: n, avg_score: n ? Math.round(sum / n) : null, errors, issues, last_audit: last };
}

// The SEO-relevant parts of each cron run, newest first, in plain words.
export function activityOf(runs, site) {
  const out = [];
  for (const r of runs || []) {
    const x = r.result || {};
    const at = r.finished_at || r.started_at;
    const line = (step, text) => out.push({ at, step, text, ok: !x.errors || !x.errors.some((e) => String(e).startsWith(step + ":")) });
    if (x.seo && !x.seo.skipped) line("seo", `Audited ${x.seo.checked} of ${x.seo.total} pages${x.seo.avg_score != null ? `, average score ${x.seo.avg_score}` : ""}${x.seo.errors ? `, ${x.seo.errors} not answering` : ""}`);
    if (x.vitals && !x.vitals.skipped && (x.vitals.checked || x.vitals.failed)) {
      const why = x.vitals.reason === "no_key_quota" ? "; Google refused the call, add the free PAGESPEED_API_KEY in Vercel" : x.vitals.reason === "quota" ? "; today's PageSpeed quota is spent" : "";
      out.push({ at, step: "vitals", text: `PageSpeed run on ${x.vitals.checked} page${x.vitals.checked === 1 ? "" : "s"}${x.vitals.failed ? ` (${x.vitals.failed} failed${why})` : ""}`, ok: !x.vitals.failed && !(x.errors || []).some((e) => String(e).startsWith("vitals:")) });
    }
    if (x.mentions && !x.mentions.skipped) line("mentions", `Searched the news for the Forum: ${x.mentions.found} found, ${x.mentions.new} new`);
    if (x.indexnow && !x.indexnow.skipped) line("indexnow", x.indexnow.pinged ? `Pinged IndexNow with ${x.indexnow.urls} URLs` : `IndexNow ping failed (${x.indexnow.skipped || x.indexnow.status})`);
    else if (x.indexnow && x.indexnow.skipped && x.indexnow.skipped !== "not_in_run" && x.indexnow.skipped !== "no_fetch") line("indexnow", `IndexNow skipped: ${x.indexnow.skipped}`);
    if (x.autopost && (x.autopost.drafted || x.autopost.published)) line("autopost", `${x.autopost.drafted ? `Drafted the weekly round-up${x.autopost.slug ? ` (${site}/blog/${x.autopost.slug})` : ""}` : ""}${x.autopost.drafted && x.autopost.published ? "; " : ""}${x.autopost.published ? `published ${x.autopost.published} post${x.autopost.published === 1 ? "" : "s"}` : ""}`);
    if (x.links && !x.links.skipped && x.links.checked) line("links", `Checked ${x.links.checked} official links${x.links.broken ? `, ${x.links.broken} broken` : ", all fine"}`);
    if (x.news && !x.news.skipped && x.news.new_items) line("news", `${x.news.new_items} new official notices collected`);
    if (x.seo && x.seo.links && x.seo.links.checked) line("seo", `Crawled ${x.seo.links.checked} internal link${x.seo.links.checked === 1 ? "" : "s"} outside the sitemap${x.seo.links.broken ? `, ${x.seo.links.broken} broken` : ", all answer"}`);
    if (x.seo && x.seo.site && x.seo.site.checked) line("seo", `Site checks: ${x.seo.site.failing && x.seo.site.failing.length ? `attention on ${x.seo.site.failing.join(", ")}` : "robots.txt, sitemap, llms.txt, headers and redirects all fine"}`);
    if (x.geo && !x.geo.skipped && (x.geo.asked || x.geo.failed)) out.push({ at, step: "geo", text: `Asked an AI engine ${x.geo.asked} resident question${x.geo.asked === 1 ? "" : "s"}: the Forum was cited in ${x.geo.cited}${x.geo.failed ? ` (${x.geo.failed} failed: ${x.geo.reason || "error"})` : ""}`, ok: !x.geo.failed });
    if (x.gsc && !x.gsc.skipped && (x.gsc.queries || x.gsc.pages || x.gsc.inspected || x.gsc.sitemap)) line("gsc", `Search Console: ${x.gsc.queries} queries, ${x.gsc.pages} pages, ${x.gsc.inspected} URLs inspected${x.gsc.sitemap ? `; sitemap ${x.gsc.sitemap}` : ""}`);
    if (x.bing && !x.bing.skipped && (x.bing.queries || x.bing.pages || x.bing.crawl)) line("bing", `Bing: ${x.bing.queries} queries, ${x.bing.pages} pages${x.bing.crawl ? `; ${x.bing.crawl}` : ""}`);
    else if (x.bing && x.bing.skipped === "site_not_in_account") line("bing", "Bing: the site is not in the Bing Webmaster account the key belongs to");
    if (x.topics && x.topics.drafted) line("topics", `Drafted a topic post on ${x.topics.topic} (${x.topics.mentions} public posts)${x.topics.slug ? `: ${site}/blog/${x.topics.slug}` : ""}${x.topics.published ? ", published at once" : ", publishes after the review window unless held"}`);
    else if (x.topics && x.topics.skipped === "weekly_limit") line("topics", "Topic pipeline: this week's posts are drafted; the next waits for next week");
  }
  return out;
}

// The reason the newest PageSpeed attempt failed, if it did.
export function lastVitalsReason(runs) {
  for (const r of runs || []) {
    const v = r && r.result && r.result.vitals;
    if (!v || v.skipped) continue;
    return v.checked ? null : v.reason || null;
  }
  return null;
}

// The newest period per source and dimension, top rows by impressions.
export function searchView(rows, top = 25) {
  const out = {};
  for (const src of ["google", "bing"]) {
    const mine = (rows || []).filter((r) => r.source === src);
    if (!mine.length) { out[src] = null; continue; }
    const view = { queries: [], pages: [], period: null };
    for (const dim of ["query", "page"]) {
      const d = mine.filter((r) => r.dim === dim);
      const end = d.map((r) => String(r.period_end)).sort().pop();
      const latest = d.filter((r) => String(r.period_end) === end).sort((a, b) => (b.impressions || 0) - (a.impressions || 0)).slice(0, top);
      view[dim === "query" ? "queries" : "pages"] = latest.map((r) => ({ key: r.key, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr != null ? Number(r.ctr) : null, position: r.position != null ? Number(r.position) : null }));
      if (end && latest[0]) view.period = { start: String(latest[0].period_start || ""), end };
    }
    view.totals = { clicks: view.pages.reduce((s, r) => s + (r.clicks || 0), 0), impressions: view.pages.reduce((s, r) => s + (r.impressions || 0), 0) };
    out[src] = view;
  }
  return out;
}

// GEO: readiness across audited pages, and the newest answer per question.
export function geoView(pages, rows, { days = 30, now = Date.now() } = {}) {
  const scored = (pages || []).filter((p) => p.facts && p.facts.geo && p.status === 200);
  const missing = {};
  for (const p of scored) for (const k of p.facts.geo.missing || []) missing[k] = (missing[k] || 0) + 1;
  const latest = new Map();
  for (const r of rows || []) if (!latest.has(r.question_key)) latest.set(r.question_key, r);
  const since = now - days * 86400000;
  const recent = [...latest.values()].filter((r) => r.cited != null && Date.parse(r.checked_at) >= since);
  const questions = geoQuestions().map((q) => { const r = latest.get(q.key); return { key: q.key, issue: q.issue, question: q.text, cited: r ? r.cited : null, mentioned: r ? !!r.mentioned : null, position: r ? r.position : null, sources: r ? (r.sources || []).slice(0, 6) : [], answer: r ? r.answer : null, error: r ? r.error : null, checked_at: r ? r.checked_at : null }; });
  return {
    pages: scored.length,
    avg: scored.length ? Math.round(scored.reduce((s, p) => s + p.facts.geo.score, 0) / scored.length) : null,
    missing: Object.entries(missing).map(([key, count]) => ({ key, count, label: GEO_CHECKS[key] || key })).sort((a, b) => b.count - a.count),
    asked: recent.length, cited: recent.filter((r) => r.cited).length,
    questions
  };
}

export function indexView(rows) {
  const list = (rows || []).map((r) => ({ url: r.url, verdict: r.verdict, coverage: r.coverage, last_crawl: r.last_crawl, checked_at: r.checked_at }));
  return { total: list.length, indexed: list.filter((r) => r.verdict === "PASS").length, rows: list.sort((a, b) => (a.verdict === "PASS") - (b.verdict === "PASS")) };
}

// The newest outcome per cron step: a step whose latest run failed, with
// the error; a later clean run of the step clears an older failure.
export function stepErrors(runs) {
  const out = {};
  const seen = new Set();
  for (const r of runs || []) {
    const res = (r && r.result) || {};
    const errs = new Map(((res.errors) || []).map((e) => [String(e).split(":")[0], String(e)]));
    const steps = Array.isArray(res.steps) ? res.steps : Object.keys(res).filter((k) => res[k] && typeof res[k] === "object" && !Array.isArray(res[k]) && res[k].skipped !== "not_in_run");
    for (const st of steps) {
      if (seen.has(st)) continue;
      seen.add(st);
      if (errs.has(st)) out[st] = { at: r.finished_at || r.started_at, error: errs.get(st).slice(st.length + 1).trim().slice(0, 200) };
    }
  }
  return out;
}

// Everything the SEO tab shows, computed from the cron's tables. The desk
// handler and the SEO agent (lib/seo/agent.js) both read this.
export async function loadSeoState(sb, env = process.env) {
  const site = siteUrl(env);
  const since = new Date(Date.now() - OPPORTUNITY_DAYS * 86400000).toISOString();
  const [pages, vitals, mentions, signals, posts, runs, links, settings, geoRows, searchRows, indexRows, crawlRows, siteRows, topicRows] = await Promise.all([
    sb.from("seo_pages").select(PAGE_COLS).order("score", { ascending: true }).limit(500),
    sb.from("seo_vitals").select("url, strategy, performance, seo, accessibility, best_practices, lcp_ms, cls, tbt_ms, fcp_ms, speed_index_ms, checked_at").order("checked_at", { ascending: false }).limit(60),
    sb.from("seo_mentions").select("url, title, source, published_at, fetched_at").order("published_at", { ascending: false, nullsFirst: false }).limit(50),
    sb.from("signals").select("title, url, posted_at, issue_type, area").gte("posted_at", since).order("posted_at", { ascending: false }).limit(2000),
    sb.from("posts").select("slug, title, summary, tags, published_at, created_at").eq("published", true).order("published_at", { ascending: false }).limit(300),
    sb.from("cron_runs").select("started_at, finished_at, ok, result").order("started_at", { ascending: false }).limit(RUNS),
    sb.from("link_status").select("ok, checked_at").limit(500),
    loadSettings(sb),
    sb.from("seo_geo").select("question_key, cited, mentioned, position, sources, answer, error, checked_at").order("checked_at", { ascending: false }).limit(300),
    sb.from("seo_search").select("source, dim, key, clicks, impressions, ctr, position, period_start, period_end").order("period_end", { ascending: false }).limit(1000),
    sb.from("seo_index").select("url, verdict, coverage, last_crawl, checked_at").limit(500),
    sb.from("seo_links").select("url, status, ok, checked_at").limit(1000),
    sb.from("seo_site").select("key, ok, detail, data, checked_at").limit(50),
    sb.from("posts").select("slug, title, source, tags, published, published_at, created_at").order("created_at", { ascending: false }).limit(500)
  ]);
  for (const r of [pages, vitals, mentions, signals, posts, runs, links, geoRows, searchRows, indexRows, crawlRows, siteRows, topicRows]) if (r.error) throw r.error;
  const rows = pages.data || [];
  const dups = duplicates(rows);
  const pageRows = rows.map((p) => ({ ...p, issues: (p.issues || []).concat(dups.get(p.url) || []) }));
  const latestVitals = [];
  const seen = new Set();
  for (const v of vitals.data || []) if (!seen.has(v.url)) { seen.add(v.url); latestVitals.push(v); }
  const linkRows = links.data || [];
  const linkState = linkRows.length ? { total: linkRows.length, broken: linkRows.filter((l) => l.ok === false).length, checked_at: linkRows.map((l) => l.checked_at).filter(Boolean).sort().pop() || null } : null;
  const home = latestVitals.find((v) => v.url === site + "/") || latestVitals[0] || null;
  // Clusters read the static explainers plus the published posts.
  const dbPosts = (posts.data || []).filter((p) => p.slug).map((p) => ({ slug: p.slug, title: p.title, summary: p.summary, tags: p.tags || [], date: p.published_at ? new Date(p.published_at) : null }));
  const seenSlug = new Set(dbPosts.map((p) => p.slug));
  const clusterPosts = dbPosts.concat(staticPosts().filter((p) => !seenSlug.has(p.slug)));
  const health = clusterHealth({ posts: clusterPosts, signals: signals.data || [], pages: pageRows });
  // What the topic pipeline does with each cluster (and each Write next
  // item, by its issue): queued, drafted, held, published or guide only.
  const topicCfg = { enabled: settings.topics.enabled, per_week: settings.topics.per_week, review_hours: settings.autopost.review_hours };
  const topicPosts = (topicRows.data || []).filter(isTopicPost);
  const pipe = pipelineState(health, topicPosts, { perWeek: topicCfg.per_week, reviewHours: topicCfg.review_hours, enabled: topicCfg.enabled });
  const clusters = health.map((c) => ({ ...c, auto: pipe[c.id] || null }));
  const seoRun = (runs.data || []).map((r) => r.result && r.result.seo).find((x) => x && Number.isFinite(x.total));
  const graph = linkGraph(pageRows, crawlRows.data || [], { complete: !!seoRun && pageRows.length >= seoRun.total });
  const crawl = { ...graph, complete: !!seoRun && pageRows.length >= seoRun.total };
  delete crawl.inbound;
  const geo = geoView(pageRows, geoRows.data || []);
  const search = searchView(searchRows.data || []);
  const index = indexView(indexRows.data || []);
  const siteMap = Object.fromEntries((siteRows.data || []).map((r) => [r.key, r]));
  const connections = { gsc: !!readServiceAccount(env), bing: !!env.BING_WEBMASTER_API_KEY, gemini: !!env.GEMINI_API_KEY, pagespeed: !!env.PAGESPEED_API_KEY };
  const runErrors = stepErrors(runs.data || []);
  return {
    run_errors: runErrors,
    runs: (runs.data || []).map((r) => ({ started_at: r.started_at, finished_at: r.finished_at, ok: r.ok, steps: (r.result && r.result.steps) || null })),
    site,
    summary: summarise(pageRows, new Map()),
    checklist: checklist({ env, settings, pages: pageRows, vitals: home, vitalsReason: home ? null : lastVitalsReason(runs.data || []), links: linkState, autopost: settings.autopost, mentions: (mentions.data || []).length, site: siteMap, crawl, geo, clusters, search, index, connections }),
    pages: pageRows,
    vitals: { latest: latestVitals, history: vitals.data || [], tracked: VITALS_PAGES.map((p) => site + p) },
    mentions: mentions.data || [],
    opportunities: opportunities(signals.data || [], posts.data || []).map((o) => ({ ...o, auto: pipe[o.issue_type] || null })),
    topics: { ...topicCfg, posts: topicPosts.map((p) => ({ slug: p.slug, title: p.title, published: !!p.published, published_at: p.published_at, created_at: p.created_at, held: Array.isArray(p.tags) && p.tags.includes("hold") })) },
    activity: activityOf(runs.data || [], site),
    clusters, geo, search, index, crawl,
    sitechecks: siteRows.data || [],
    connections,
    settings: settings.seo,
    labels: ISSUE_TEXT
  };
}

export function makeHandler({ auth, sb: sbIn, env: envIn } = {}) {
  const requireAuth = auth || requireStaff;
  return async function handler(req, res) {
    if (req.method !== "GET") return methodNotAllowed(res, "GET");
    try {
      await requireAuth(req, ROLES);
      const env = envIn || process.env;
      const sb = sbIn || supabase();
      const state = await loadSeoState(sb, env);
      const agent = await agentView(sb).catch((e) => { console.error("seo agent view failed", e); return null; });
      res.setHeader("Cache-Control", "no-store");
      return send(res, 200, { ok: true, ...state, agent });
    } catch (e) { return handleError(res, e); }
  };
}

export default makeHandler();
