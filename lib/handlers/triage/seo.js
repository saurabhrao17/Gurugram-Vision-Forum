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
import { supabase } from "../../supabase.js";
import { requireStaff, handleError, CONTENT_ROLES } from "../../auth.js";
import { send, methodNotAllowed } from "../../http.js";
import { duplicates, opportunities, checklist, ISSUE_TEXT, OPPORTUNITY_DAYS, VITALS_PAGES } from "../../seo/audit.js";
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

export function makeHandler({ auth, sb: sbIn, env: envIn } = {}) {
  const requireAuth = auth || requireStaff;
  return async function handler(req, res) {
    if (req.method !== "GET") return methodNotAllowed(res, "GET");
    try {
      await requireAuth(req, ROLES);
      const env = envIn || process.env;
      const sb = sbIn || supabase();
      const site = siteUrl(env);
      const since = new Date(Date.now() - OPPORTUNITY_DAYS * 86400000).toISOString();
      const [pages, vitals, mentions, signals, posts, runs, links, settings] = await Promise.all([
        sb.from("seo_pages").select(PAGE_COLS).order("score", { ascending: true }).limit(500),
        sb.from("seo_vitals").select("url, strategy, performance, seo, accessibility, best_practices, lcp_ms, cls, tbt_ms, fcp_ms, speed_index_ms, checked_at").order("checked_at", { ascending: false }).limit(60),
        sb.from("seo_mentions").select("url, title, source, published_at, fetched_at").order("published_at", { ascending: false, nullsFirst: false }).limit(50),
        sb.from("signals").select("title, url, posted_at, issue_type, area").gte("posted_at", since).order("posted_at", { ascending: false }).limit(2000),
        sb.from("posts").select("title, summary, tags, published_at, created_at").eq("published", true).order("published_at", { ascending: false }).limit(50),
        sb.from("cron_runs").select("started_at, finished_at, ok, result").order("started_at", { ascending: false }).limit(RUNS),
        sb.from("link_status").select("ok, checked_at").limit(500),
        loadSettings(sb)
      ]);
      for (const r of [pages, vitals, mentions, signals, posts, runs, links]) if (r.error) throw r.error;
      const rows = pages.data || [];
      const dups = duplicates(rows);
      const pageRows = rows.map((p) => ({ ...p, issues: (p.issues || []).concat(dups.get(p.url) || []) }));
      const latestVitals = [];
      const seen = new Set();
      for (const v of vitals.data || []) if (!seen.has(v.url)) { seen.add(v.url); latestVitals.push(v); }
      const linkRows = links.data || [];
      const linkState = linkRows.length ? { total: linkRows.length, broken: linkRows.filter((l) => l.ok === false).length, checked_at: linkRows.map((l) => l.checked_at).filter(Boolean).sort().pop() || null } : null;
      const home = latestVitals.find((v) => v.url === site + "/") || latestVitals[0] || null;
      res.setHeader("Cache-Control", "no-store");
      return send(res, 200, {
        ok: true,
        site,
        summary: summarise(pageRows, new Map()),
        checklist: checklist({ env, settings, pages: pageRows, vitals: home, vitalsReason: home ? null : lastVitalsReason(runs.data || []), links: linkState, autopost: settings.autopost, mentions: (mentions.data || []).length }),
        pages: pageRows,
        vitals: { latest: latestVitals, history: vitals.data || [], tracked: VITALS_PAGES.map((p) => site + p) },
        mentions: mentions.data || [],
        opportunities: opportunities(signals.data || [], posts.data || []),
        activity: activityOf(runs.data || [], site),
        settings: settings.seo,
        labels: ISSUE_TEXT
      });
    } catch (e) { return handleError(res, e); }
  };
}

export default makeHandler();
