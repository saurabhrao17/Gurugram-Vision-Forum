// GET /api/cron/daily: called by Vercel Cron with "Authorization: Bearer <CRON_SECRET>".
// Runs, in order: the news fetch (news_sources -> news_items), the link check
// (40 of the site's external URLs per run -> link_status), the signals scan
// (Reddit public JSON, Google News RSS and the Forum's own reports ->
// signals), the insights step (the week's pulse against the week before ->
// insights), the weekly autopost (one round-up drafted on the configured
// weekday from the pulse, the notices and the Forum's own counts, published
// after the review window unless held), the subscriber digest (the published
// round-up to confirmed subscribers), the IndexNow ping, the SLA digest
// (overdue reports and broken links to the coordinator), the outbox sender
// (pending emails through Resend) and the 24-month retention sweep (reports
// plus their storage objects). Every run is logged in cron_runs.
// Env: CRON_SECRET (required), COORDINATOR_EMAIL, RESEND_API_KEY, MAIL_FROM;
// GEMINI_API_KEY / GROQ_API_KEY / ANTHROPIC_API_KEY (optional, for the brief
// and the round-up); SITE_URL, INDEXNOW_KEY (optional, search-engine ping).
import { timingSafeEqual } from "node:crypto";
import { supabase } from "../supabase.js";
import { send, methodNotAllowed } from "../http.js";
import { fetchSources, loadSourcesFile } from "../news-fetch.js";
import { collectLinks, checkLinks, storeLinkStatus } from "../link-check.js";
import { fetchReddit, fetchGoogleNews, computePulse, narrate, insightData } from "../signals.js";
import { buildWeeklyPost, isoWeek, weekTag, NEWS_MAX, PUBLIC_MIN_REPORTS } from "../autopost.js";
import { validatePost, slugFor } from "../content.js";
import { siteUrl, pingIndexNow } from "../indexnow.js";
import { loadMetrics } from "./triage/metrics.js";

const SITE = "https://gurugramvisionforum.org";
export const AUTOPOST_DEFAULTS = { enabled: true, weekday: 1, review_hours: 48 };
export const SEO_DEFAULTS = { indexnow: true };
export const AUTO_SOURCE_PREFIX = "auto:weekly:";
const RECENT_HOURS = 26;        // "published since the last run", with slack
const DRAFTS_SCANNED = 200;
const RECENT_POSTS = 50;
const WEEK_REPORTS = 5000;
const DIGEST_BATCH = 200;
const SUBSCRIBER_PAGE = 1000;
const RESEND_URL = "https://api.resend.com/emails";
const BUCKET = "report-photos";
const BATCH = 50;
const MAX_ATTEMPTS = 5;
const DEFAULT_FROM = "Gurugram Vision Forum <noreply@gurugramvisionforum.org>";
const LINKS_PER_RUN = 200;         // every link, every run (36 today); the function runs in Mumbai so India-only hosts answer
const LINK_TIMEOUT_MS = 6000;
const LINK_CONCURRENCY = 12;
const BROKEN_IN_DIGEST = 50;
const SIGNAL_DAYS = 7;          // the pulse window
const SIGNAL_RETENTION_DAYS = 60;
const SIGNAL_BATCH = 200;

function secretMatches(req, secret) {
  if (!secret) return false;
  const h = req.headers?.authorization || "";
  const m = /^Bearer\s+(\S+)$/i.exec(Array.isArray(h) ? h[0] : h);
  if (!m) return false;
  const a = Buffer.from(m[1]), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Builds the coordinator's digest row. Only the fields named here are copied,
// so nothing about the reporter can leak into the body.
export function slaDigestMail(digest, to, broken = []) {
  const unmapped = Array.isArray(digest?.unmapped) ? digest.unmapped : [];
  const filed = Array.isArray(digest?.filed_overdue) ? digest.filed_overdue : [];
  const links = Array.isArray(broken) ? broken : [];
  const line = (r, tail) => `- ${r.ref}: ${r.issue_type || "?"}, ${r.area || "?"}${r.ward ? `, ward ${r.ward}` : ""}, ${tail}\n  ${SITE}/#/desk/${r.ref}`;
  const parts = [`SLA digest for ${new Date().toISOString().slice(0, 10)}`, ""];
  parts.push(`Not mapped within 3 working days (${unmapped.length}):`);
  parts.push(unmapped.length ? unmapped.map((r) => line(r, `${plural(r.days ?? 0, "working day", "working days")} since received`)).join("\n") : "- none");
  parts.push("");
  parts.push(`Filed more than 21 days ago with no change (${filed.length}):`);
  parts.push(filed.length ? filed.map((r) => line(r, `${plural(r.days ?? 0, "day", "days")} since filed${r.official_ticket ? `, ticket ${r.official_ticket}` : ", no ticket recorded"}`)).join("\n") : "- none");
  if (links.length) {
    parts.push("");
    parts.push(`Broken links (${links.length}):`);
    parts.push(links.slice(0, BROKEN_IN_DIGEST).map((l) => `- ${l.url} (${l.status ? `HTTP ${l.status}` : l.error || "no response"})${l.where_used ? `, used in ${l.where_used}` : ""}`).join("\n"));
    if (links.length > BROKEN_IN_DIGEST) parts.push(`- and ${links.length - BROKEN_IN_DIGEST} more; see ${SITE}/api/health`);
  }
  parts.push("", "Open the desk: " + SITE + "/#/desk", "");
  return {
    to_email: to,
    subject: `SLA digest: ${plural(unmapped.length, "report", "reports")} unmapped, ${filed.length} filed past 21 days${links.length ? `, ${plural(links.length, "broken link", "broken links")}` : ""}`,
    body_text: parts.join("\n"),
    kind: "sla"
  };
}

// One Resend call. Throws with a short message on any failure.
export async function sendMail(row, env = process.env) {
  const key = env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY not set");
  const payload = {
    from: env.MAIL_FROM || DEFAULT_FROM,
    to: [row.to_email],
    subject: row.subject,
    text: row.body_text
  };
  if (row.body_html) payload.html = row.body_html;
  const r = await fetch(RESEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`resend ${r.status}: ${detail.slice(0, 300)}`);
  }
  return r.json().catch(() => ({}));
}

// Every link currently marked broken (from this and earlier runs), for the digest.
async function brokenLinks(sb) {
  const { data, error } = await sb.from("link_status").select("url, status, error, where_used").eq("ok", false).order("checked_at", { ascending: false }).limit(200);
  if (error) { console.error("link_status select failed", error); return []; }
  return data || [];
}

async function slaStep(sb, env) {
  const { data, error } = await sb.rpc("sla_digest");
  if (error) throw new Error(`sla_digest: ${error.message || error}`);
  const digest = data || {};
  const unmapped = Array.isArray(digest.unmapped) ? digest.unmapped.length : 0;
  const filed = Array.isArray(digest.filed_overdue) ? digest.filed_overdue.length : 0;
  const broken = await brokenLinks(sb);
  let digest_sent = false;
  if ((unmapped || filed || broken.length) && env.COORDINATOR_EMAIL) {
    const { error: e2 } = await sb.from("outbox").insert(slaDigestMail(digest, env.COORDINATOR_EMAIL, broken));
    if (e2) throw new Error(`outbox insert: ${e2.message || e2}`);
    digest_sent = true;
  }
  return { unmapped, filed_overdue: filed, digest_sent };
}

// News: sources from news_sources (seeded from data/news-sources.json when the
// table is empty), each fetched and parsed in isolation, newest 20 upserted.
async function newsStep(sb, fetchImpl) {
  const out = { sources: 0, fetched: 0, new_items: 0, failed: [] };
  const COLS = "id, name, url, type, selector, home, enabled";
  let { data: sources, error } = await sb.from("news_sources").select(COLS).eq("enabled", true);
  if (error) throw new Error(`news_sources select: ${error.message || error}`);
  if (!sources || !sources.length) {
    const seeds = await loadSourcesFile();
    if (seeds.length) {
      const { error: se } = await sb.from("news_sources").upsert(seeds, { onConflict: "id", ignoreDuplicates: true });
      if (se) throw new Error(`news_sources seed: ${se.message || se}`);
      ({ data: sources, error } = await sb.from("news_sources").select(COLS).eq("enabled", true));
      if (error) throw new Error(`news_sources select: ${error.message || error}`);
    }
  }
  const list = (sources || []).filter((s) => s.type !== "none" && s.url);
  out.sources = list.length;
  if (!fetchImpl) { out.skipped = true; return out; }
  const results = await fetchSources(list, fetchImpl);
  const now = new Date().toISOString();
  for (const r of results) {
    const patch = { last_fetched_at: now, last_status: r.error ? "error" : "ok", last_error: r.error };
    if (!r.error) {
      out.fetched++;
      if (r.items.length) {
        const rows = r.items.map((i) => ({ source_id: r.id, title: i.title, url: i.url, published_at: i.published_at }));
        const { data: ins, error: ie } = await sb.from("news_items").upsert(rows, { onConflict: "source_id,url", ignoreDuplicates: true }).select("id");
        if (ie) { patch.last_status = "error"; patch.last_error = `upsert: ${String(ie.message || ie).slice(0, 150)}`; out.failed.push(r.id); }
        else out.new_items += Array.isArray(ins) ? ins.length : 0;
      }
    } else out.failed.push(r.id);
    const { error: ue } = await sb.from("news_sources").update(patch).eq("id", r.id);
    if (ue) console.error("news_sources update failed", r.id, ue);
  }
  return out;
}

// Links: every external URL in site/data.js, 40 per run, never-checked first
// then the oldest check, HEAD then GET, stored in link_status.
async function linksStep(sb, fetchImpl) {
  const all = await collectLinks();
  const { data: known, error } = await sb.from("link_status").select("url, checked_at");
  if (error) throw new Error(`link_status select: ${error.message || error}`);
  const when = new Map((known || []).map((r) => [r.url, r.checked_at ? Date.parse(r.checked_at) : 0]));
  const queue = all.slice().sort((a, b) => (when.get(a.url) || 0) - (when.get(b.url) || 0)).slice(0, LINKS_PER_RUN);
  const out = { total: all.length, checked: 0, broken: 0, remaining: Math.max(0, all.length - queue.length) };
  if (!fetchImpl) { out.skipped = true; return out; }
  const results = await checkLinks(queue, fetchImpl, { concurrency: LINK_CONCURRENCY, timeoutMs: LINK_TIMEOUT_MS });
  await storeLinkStatus(sb, results);
  out.checked = results.length;
  out.broken = results.filter((r) => !r.ok).length;
  return out;
}

// Signals: the public discussion scan. Reddit's public listing and Google
// News RSS searches are fetched with the injected client. Everything is
// upserted on (source, external_id) and rows older than 60 days are deleted.
// Without a fetch client (unit tests) the whole step skips.
async function signalsStep(sb, fetchImpl) {
  // Reports raised on the Forum are confidential (owner's decision, 8 Oct
  // 2026): they are never read into the public pulse.
  const out = { reddit: 0, news: 0, new: 0 };
  if (!fetchImpl) { out.skipped = true; return out; }
  const [reddit, news] = await Promise.all([fetchReddit(fetchImpl), fetchGoogleNews(fetchImpl)]);
  out.reddit = reddit.length; out.news = news.length;
  const rows = [...reddit, ...news];
  for (let i = 0; i < rows.length; i += SIGNAL_BATCH) {
    const { data: ins, error: ie } = await sb.from("signals").upsert(rows.slice(i, i + SIGNAL_BATCH), { onConflict: "source,external_id", ignoreDuplicates: true }).select("id");
    if (ie) throw new Error(`signals upsert: ${ie.message || ie}`);
    out.new += Array.isArray(ins) ? ins.length : 0;
  }
  const cutoff = new Date(Date.now() - SIGNAL_RETENTION_DAYS * 86400000).toISOString();
  const { error: de } = await sb.from("signals").delete().lt("fetched_at", cutoff);
  if (de) console.error("signals cleanup failed", de);
  return out;
}

// Insights: the pulse over the last 7 days against the 7 before, narrated
// (AI when a provider key is set, rule-based otherwise) and stored. Nothing
// is stored on a week with no signals. Without a fetch client the step skips.
async function insightsStep(sb, env, fetchImpl, ctx = {}) {
  const out = { topics: 0, ai: false, stored: false };
  if (!fetchImpl) { out.skipped = true; return out; }
  const now = Date.now();
  const since = new Date(now - 2 * SIGNAL_DAYS * 86400000).toISOString();
  const { data, error } = await sb.from("signals").select("source, title, url, posted_at, fetched_at, issue_type, area, score").gte("posted_at", since).order("posted_at", { ascending: false }).limit(5000);
  if (error) throw new Error(`signals select: ${error.message || error}`);
  const pulse = computePulse(data || [], { days: SIGNAL_DAYS, prev: SIGNAL_DAYS, now });
  out.topics = pulse.topics.length;
  ctx.insight = null; // this run's pulse, for the autopost step: null means "nothing this week"
  if (!pulse.total) return out;
  const brief = await narrate(env, pulse, fetchImpl);
  out.ai = !!brief.ai;
  const row = { period_start: pulse.period.from, period_end: pulse.period.to, data: insightData(pulse, brief), published: true };
  const { error: ie } = await sb.from("insights").insert(row);
  if (ie) throw new Error(`insights insert: ${ie.message || ie}`);
  out.stored = true;
  ctx.insight = row.data;
  return out;
}

// ---------------------------------------------------------------------------
// Settings rows 'autopost' and 'seo', with defaults for anything missing.
// ---------------------------------------------------------------------------
export async function loadSettings(sb) {
  const { data, error } = await sb.from("site_settings").select("key, value");
  if (error) throw new Error(`site_settings select: ${error.message || error}`);
  const rows = {};
  for (const r of data || []) if (r && r.key) rows[r.key] = r.value && typeof r.value === "object" ? r.value : {};
  const autopost = { ...AUTOPOST_DEFAULTS, ...(rows.autopost || {}) };
  autopost.enabled = autopost.enabled !== false;
  autopost.weekday = Number.isInteger(autopost.weekday) && autopost.weekday >= 0 && autopost.weekday <= 6 ? autopost.weekday : AUTOPOST_DEFAULTS.weekday;
  autopost.review_hours = Number.isInteger(autopost.review_hours) && autopost.review_hours >= -1 && autopost.review_hours <= 720 ? autopost.review_hours : AUTOPOST_DEFAULTS.review_hours;
  const seo = { ...SEO_DEFAULTS, ...(rows.seo || {}) };
  seo.indexnow = seo.indexnow !== false;
  return { autopost, seo };
}

const isAuto = (p) => typeof p?.source === "string" && p.source.startsWith(AUTO_SOURCE_PREFIX);
const hasTag = (p, t) => Array.isArray(p?.tags) && p.tags.includes(t);
const hoursAgoIso = (now, h) => new Date(now - h * 3600000).toISOString();

// Posts published in the last 26 hours, newest first (the fallback list for
// the digest and the IndexNow ping).
async function recentlyPublished(sb, now) {
  const { data, error } = await sb.from("posts").select("id, slug, title, title_hi, summary, summary_hi, tags, source, published_at, digest_sent_at")
    .eq("published", true).order("published_at", { ascending: false }).limit(RECENT_POSTS);
  if (error) throw new Error(`posts select: ${error.message || error}`);
  const since = hoursAgoIso(now, RECENT_HOURS);
  return (data || []).filter((p) => p && p.slug && p.published_at && p.published_at >= since);
}

// The latest stored pulse, read only when this run's insights step did not
// settle the question (it skipped or failed).
async function latestInsight(sb) {
  const { data, error } = await sb.from("insights").select("data").eq("published", true).order("generated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`insights select: ${error.message || error}`);
  return data && data.data ? data.data : null;
}

// Report counts for the round-up: the site-wide total first, the week's
// breakdown (stage and issue type only, aggregated here; nothing about any
// one report leaves this function) once the total passes the editorial
// threshold PUBLIC_MIN_REPORTS.
async function reportStats(sb, since) {
  const { count, error } = await sb.from("reports").select("id", { count: "exact", head: true });
  if (error) throw new Error(`reports count: ${error.message || error}`);
  const total = Number(count) || 0;
  if (total < PUBLIC_MIN_REPORTS) return { total, week: 0, by_stage: {}, by_issue: {} };
  const { data, error: e2 } = await sb.from("reports").select("stage, issue_type").gte("created_at", since).limit(WEEK_REPORTS);
  if (e2) throw new Error(`reports select: ${e2.message || e2}`);
  const by_stage = {}, by_issue = {};
  for (const r of data || []) {
    const s = String(r.stage ?? "0"), i = String(r.issue_type || "other");
    by_stage[s] = (by_stage[s] || 0) + 1;
    by_issue[i] = (by_issue[i] || 0) + 1;
  }
  return { total, week: (data || []).length, by_stage, by_issue };
}

export function autopostMail(post, to, settings, env, now) {
  const site = siteUrl(env);
  const h = settings.review_hours;
  const rule = h === -1 ? "It will not publish until someone on the desk publishes it."
    : h === 0 ? "It was published immediately (review window 0 hours); unpublish it from the desk if needed."
    : `It publishes on ${new Date(now + h * 3600000).toISOString().replace("T", " ").slice(0, 16)} UTC unless held (add the tag "hold" or edit it from the desk).`;
  return {
    to_email: to,
    subject: `Weekly round-up draft ready: ${post.title}`,
    body_text: [
      `The weekly round-up for ${post.week} is drafted${post.ai ? ` (prose by ${post.provider || "the AI provider"}, facts from the data)` : " (template prose, facts from the data)"}.`,
      "",
      post.title,
      post.summary,
      "",
      rule,
      "",
      `Open the desk: ${site}/desk`,
      ""
    ].join("\n"),
    kind: "autopost"
  };
}

// Autopost: (a) on the configured weekday, draft this ISO week's round-up
// once; (b) publish drafts whose review window has passed and that nobody
// held. Drafting needs the fetch client (as the insights step does); the
// publish pass runs every day.
export async function autopostStep(sb, env, { fetch: fetchImpl = null, now = Date.now(), ctx = {} } = {}) {
  const out = { drafted: false, published: 0, skipped: null };
  const { autopost: settings } = await loadSettings(sb);
  const nowDate = new Date(now);

  if (!settings.enabled) out.skipped = "disabled";
  else if (nowDate.getUTCDay() !== settings.weekday) out.skipped = "not_the_day";
  else if (!fetchImpl) out.skipped = "no_fetch";
  else {
    const tag = weekTag(isoWeek(nowDate));
    const source = AUTO_SOURCE_PREFIX + tag;
    const { data: dup, error: de } = await sb.from("posts").select("id").eq("source", source).limit(1);
    if (de) throw new Error(`posts select: ${de.message || de}`);
    if (dup && dup.length) out.skipped = "exists";
    else {
      const since = hoursAgoIso(now, 7 * 24);
      const pulse = ctx.insight !== undefined ? ctx.insight : await latestInsight(sb);
      const { data: items, error: ne } = await sb.from("news_items").select("title, url, published_at, source_id, news_sources(name)")
        .gte("fetched_at", since).order("fetched_at", { ascending: false }).limit(NEWS_MAX);
      if (ne) throw new Error(`news_items select: ${ne.message || ne}`);
      const news = (items || []).map((n) => ({ title: n.title, url: n.url, published_at: n.published_at, source: (n.news_sources && n.news_sources.name) || n.source_id }));
      const stats = await reportStats(sb, since);
      const weekPosts = (await recentlyPublished(sb, now + (7 * 24 - RECENT_HOURS) * 3600000)).filter((p) => !isAuto(p)).map((p) => ({ title: p.title, slug: p.slug, kind: p.kind || "news" }));
      const post = await buildWeeklyPost({ pulse, news, reportStats: stats, posts: weekPosts, period: { from: since, to: nowDate.toISOString() }, env, fetchImpl, now });
      if (!post) out.skipped = "nothing_to_say";
      else {
        const { value, errors } = validatePost(post);
        if (errors.length) throw new Error(`autopost invalid: ${errors.join(",")}`);
        const row = { ...value, slug: post.slug, created_by: "cron:autopost", published: settings.review_hours === 0, published_at: settings.review_hours === 0 ? nowDate.toISOString() : null };
        let { error: ie } = await sb.from("posts").insert(row);
        if (ie && ie.code === "23505") { row.slug = slugFor(post.slug); ({ error: ie } = await sb.from("posts").insert(row)); }
        if (ie) throw new Error(`posts insert: ${ie.message || ie}`);
        out.drafted = true;
        out.slug = row.slug;
        out.ai = !!post.ai;
        if (row.published) out.published++;
        if (env.COORDINATOR_EMAIL) {
          const { error: oe } = await sb.from("outbox").insert(autopostMail(post, env.COORDINATOR_EMAIL, settings, env, now));
          if (oe) console.error("autopost outbox insert failed", oe);
        }
      }
    }
  }

  // (b) publish due drafts.
  if (settings.review_hours !== -1) {
    const { data: drafts, error } = await sb.from("posts").select("id, source, tags, created_at").eq("published", false).order("created_at", { ascending: true }).limit(DRAFTS_SCANNED);
    if (error) throw new Error(`posts select: ${error.message || error}`);
    const due = (drafts || []).filter((p) => isAuto(p) && !hasTag(p, "hold") && Date.parse(p.created_at || 0) + settings.review_hours * 3600000 <= now);
    for (const p of due) {
      const { error: ue } = await sb.from("posts").update({ published: true, published_at: nowDate.toISOString() }).eq("id", p.id);
      if (ue) throw new Error(`posts update: ${ue.message || ue}`);
      out.published++;
    }
  }
  return out;
}

export function digestMail(post, sub, env) {
  const site = siteUrl(env);
  const hi = sub.lang === "hi" && post.title_hi;
  const title = hi ? post.title_hi : post.title;
  const summary = (hi ? post.summary_hi : post.summary) || post.summary || "";
  const link = `${site}${hi ? "/hi" : ""}/blog/${post.slug}`;
  const unsub = `${site}/api/subscribe?unsubscribe=${sub.token}`;
  const read = hi ? "पूरा सार पढ़ें" : "Read the round-up";
  const stop = hi ? "ये ईमेल बंद करें" : "Stop these emails";
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return {
    to_email: sub.email,
    subject: title,
    body_text: [summary, "", `${read}: ${link}`, "", `${stop}: ${unsub}`, ""].join("\n"),
    body_html: `<p>${esc(summary)}</p><p><a href="${link}">${read}</a></p><p style="font-size:12px"><a href="${unsub}">${stop}</a></p>`,
    kind: "digest"
  };
}

async function confirmedSubscribers(sb) {
  const out = [];
  for (let from = 0; ; from += SUBSCRIBER_PAGE) {
    const { data, error } = await sb.from("subscribers").select("id, email, lang, token")
      .not("confirmed_at", "is", null).is("unsubscribed_at", null).order("id", { ascending: true }).range(from, from + SUBSCRIBER_PAGE - 1);
    if (error) throw new Error(`subscribers select: ${error.message || error}`);
    const rows = data || [];
    out.push(...rows);
    if (rows.length < SUBSCRIBER_PAGE) break;
  }
  return out;
}

// Digest: every "weekly" post published in the last 26 hours and not yet
// mailed goes to the confirmed subscribers, once; the post is then marked.
export async function digestStep(sb, env, { now = Date.now() } = {}) {
  const out = { posts: 0, queued: 0 };
  const posts = (await recentlyPublished(sb, now)).filter((p) => hasTag(p, "weekly") && !p.digest_sent_at);
  if (!posts.length) return out;
  const subs = await confirmedSubscribers(sb);
  for (const post of posts) {
    const rows = subs.map((s) => digestMail(post, s, env));
    for (let i = 0; i < rows.length; i += DIGEST_BATCH) {
      const { error } = await sb.from("outbox").insert(rows.slice(i, i + DIGEST_BATCH));
      if (error) throw new Error(`outbox insert: ${error.message || error}`);
      out.queued += Math.min(DIGEST_BATCH, rows.length - i);
    }
    const { error: ue } = await sb.from("posts").update({ digest_sent_at: new Date(now).toISOString() }).eq("id", post.id);
    if (ue) throw new Error(`posts update: ${ue.message || ue}`);
    out.posts++;
  }
  return out;
}

// IndexNow: the pages that changed since the last run (new posts in both
// languages plus the daily pages and the sitemap), one POST, never fatal.
export async function indexnowStep(sb, env, { fetch: fetchImpl = null, now = Date.now() } = {}) {
  const out = { pinged: false, urls: 0, status: 0, skipped: null };
  if (!env.INDEXNOW_KEY) { out.skipped = "no_key"; return out; }
  if (!fetchImpl) { out.skipped = "no_fetch"; return out; }
  const { seo } = await loadSettings(sb);
  if (!seo.indexnow) { out.skipped = "disabled"; return out; }
  const site = siteUrl(env);
  const urls = [`${site}/sitemap.xml`, `${site}/pulse`, `${site}/news`, `${site}/blog`];
  for (const p of await recentlyPublished(sb, now)) urls.push(`${site}/blog/${p.slug}`, `${site}/hi/blog/${p.slug}`);
  const r = await pingIndexNow(env, urls, fetchImpl);
  out.pinged = !!r.ok;
  out.urls = r.count;
  out.status = r.status;
  if (!r.ok) out.skipped = r.skipped || r.error || `http_${r.status}`;
  return out;
}

async function startRun(sb) {
  try {
    const { data } = await sb.from("cron_runs").insert({ started_at: new Date().toISOString() }).select("id").maybeSingle();
    return data?.id ?? null;
  } catch (e) { console.error("cron_runs insert failed", e); return null; }
}

async function finishRun(sb, id, result) {
  if (id === null || id === undefined) return;
  try {
    const { error } = await sb.from("cron_runs").update({ finished_at: new Date().toISOString(), ok: result.ok, result }).eq("id", id);
    if (error) console.error("cron_runs update failed", error);
  } catch (e) { console.error("cron_runs update failed", e); }
}

// The daily brief (owner's ask): the ward-wise state of play every morning
// to every active owner and coordinator by email (queued in the outbox, sent
// in the same run) and to owners on WhatsApp through an approved template
// (WHATSAPP_BRIEF_TEMPLATE, default gvf_daily_brief, one body parameter:
// the one-line brief) when the Meta values are set.
const GRAPH = "https://graph.facebook.com/v20.0";
export function briefMail(brief, to) {
  return { to_email: to, subject: `Daily brief ${brief.date}: ${brief.totals.open} open, ${brief.totals.overdue} overdue`, body_text: brief.text, kind: "brief" };
}
async function briefStep(sb, env, { fetch: fetchImpl, now } = {}) {
  const out = { emails: 0, whatsapp: 0, recipients: 0 };
  const m = await loadMetrics(sb, env, now);
  if (!m.wards.length) { out.skipped = "no_data"; return out; }
  const brief = { ...m.brief, totals: m.totals, date: new Date(now || Date.now()).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) };
  const { data: staff, error } = await sb.from("staff").select("user_id, name, role, email, phone, active");
  if (error) throw new Error(`staff select: ${error.message || error}`);
  const people = (staff || []).filter((p) => p.active !== false && (p.role === "owner" || p.role === "coordinator"));
  out.recipients = people.length;
  const mails = people.filter((p) => p.email).map((p) => briefMail(brief, p.email));
  if (mails.length) {
    const { error: oe } = await sb.from("outbox").insert(mails);
    if (oe) throw new Error(`outbox insert: ${oe.message || oe}`);
    out.emails = mails.length;
  }
  if (env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID && fetchImpl) {
    const template = env.WHATSAPP_BRIEF_TEMPLATE || "gvf_daily_brief";
    for (const p of people.filter((x) => x.role === "owner" && x.phone)) {
      try {
        const r = await fetchImpl(`${GRAPH}/${env.WHATSAPP_PHONE_ID}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ messaging_product: "whatsapp", to: String(p.phone).replace(/^\+/, ""), type: "template",
            template: { name: template, language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: brief.line }] }] } })
        });
        if (r.ok) out.whatsapp++; else console.error("brief whatsapp failed", r.status);
      } catch (e) { console.error("brief whatsapp failed", e); }
    }
  } else out.whatsapp_skipped = "no_whatsapp_config";
  return out;
}

async function outboxStep(sb, env) {
  const { data, error } = await sb.from("outbox")
    .select("id, to_email, subject, body_text, body_html, attempts")
    .eq("status", "pending").lt("attempts", MAX_ATTEMPTS)
    .order("id", { ascending: true }).limit(BATCH);
  if (error) throw new Error(`outbox select: ${error.message || error}`);
  const rows = data || [];
  const out = { sent: 0, failed: 0, skipped: 0 };
  if (!env.RESEND_API_KEY) { out.skipped = rows.length; return out; }
  for (const row of rows) {
    let patch;
    try {
      await sendMail(row, env);
      patch = { status: "sent", sent_at: new Date().toISOString(), attempts: (row.attempts || 0) + 1, last_error: null };
      out.sent++;
    } catch (e) {
      const attempts = (row.attempts || 0) + 1;
      patch = { attempts, last_error: String(e?.message || e).slice(0, 500), status: attempts >= MAX_ATTEMPTS ? "failed" : "pending" };
      out.failed++;
    }
    const { error: e2 } = await sb.from("outbox").update(patch).eq("id", row.id);
    if (e2) console.error("outbox update failed", row.id, e2);
  }
  return out;
}

async function retentionStep(sb) {
  const { data, error } = await sb.rpc("retention_sweep");
  if (error) throw new Error(`retention_sweep: ${error.message || error}`);
  const refs = Array.isArray(data?.refs) ? data.refs : [];
  for (const ref of refs) {
    try {
      const { data: objects, error: le } = await sb.storage.from(BUCKET).list(ref, { limit: 100 });
      if (le) { console.error("retention: list failed", ref, le); continue; }
      const paths = (objects || []).map((o) => `${ref}/${o.name}`);
      if (!paths.length) continue;
      const { error: re } = await sb.storage.from(BUCKET).remove(paths);
      if (re) console.error("retention: remove failed", ref, re);
    } catch (e) { console.error("retention: storage error", ref, e); }
  }
  return { deleted: Number(data?.deleted) || refs.length };
}

// The whole daily run against an injected client, so tests can pass a fake.
// Each step is isolated: a failure is recorded in `errors` and the rest still run.
// `deps.fetch` is the HTTP client for the news, link, signals and insights
// steps; without one (unit tests) they skip the network.
// `deps.now` (ms) fixes the clock for the autopost, digest and IndexNow steps.
// Step groups: Vercel functions get 60 s, so the schedule runs the slow
// network steps (/api/cron/fetch) and the analysis steps (/api/cron/analyse)
// as two invocations; /api/cron/daily runs everything, or ?steps=a,b.
export const STEP_NAMES = ["news", "links", "signals", "insights", "autopost", "digest", "indexnow", "sla", "brief", "outbox", "retention"];
export const STEP_GROUPS = { fetch: ["news", "links"], analyse: ["signals", "insights", "autopost", "digest", "indexnow", "sla", "brief", "outbox", "retention"] };
export function parseSteps(v) {
  const list = String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!list.length) return null;
  const known = list.filter((x) => STEP_NAMES.includes(x));
  return known.length ? known : null;
}

export async function runDaily(sb, env = process.env, deps = {}, { only = null } = {}) {
  const fetchImpl = deps.fetch || null;
  const now = Number.isFinite(Number(deps.now)) ? Number(deps.now) : Date.now();
  const ctx = {};
  const result = {
    ok: true,
    news: { sources: 0, fetched: 0, new_items: 0, failed: [] },
    links: { total: 0, checked: 0, broken: 0, remaining: 0 },
    signals: { reddit: 0, news: 0, new: 0 },
    insights: { topics: 0, ai: false, stored: false },
    autopost: { drafted: false, published: 0, skipped: null },
    digest: { posts: 0, queued: 0 },
    indexnow: { pinged: false, urls: 0, status: 0, skipped: null },
    sla: { unmapped: 0, filed_overdue: 0, digest_sent: false },
    brief: { emails: 0, whatsapp: 0, recipients: 0 },
    outbox: { sent: 0, failed: 0, skipped: 0 },
    retention: { deleted: 0 },
    errors: []
  };
  const runId = await startRun(sb);
  const steps = [
    ["news", () => newsStep(sb, fetchImpl)],
    ["links", () => linksStep(sb, fetchImpl)],
    ["signals", () => signalsStep(sb, fetchImpl)],
    ["insights", () => insightsStep(sb, env, fetchImpl, ctx)],
    ["autopost", () => autopostStep(sb, env, { fetch: fetchImpl, now, ctx })],
    ["digest", () => digestStep(sb, env, { now })],
    ["indexnow", () => indexnowStep(sb, env, { fetch: fetchImpl, now })],
    ["sla", () => slaStep(sb, env)],
    ["brief", () => briefStep(sb, env, { fetch: fetchImpl, now })],
    ["outbox", () => outboxStep(sb, env)],
    ["retention", () => retentionStep(sb)]
  ];
  if (Array.isArray(only) && only.length) result.steps = only;
  for (const [name, fn] of steps) {
    if (Array.isArray(only) && only.length && !only.includes(name)) { result[name] = { skipped: "not_in_run" }; continue; }
    try { result[name] = await fn(); }
    catch (e) { console.error(`cron ${name} failed`, e); result.ok = false; result.errors.push(`${name}: ${String(e?.message || e).slice(0, 200)}`); }
  }
  if (!result.errors.length) delete result.errors;
  await finishRun(sb, runId, result);
  return result;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, "GET");
  if (!secretMatches(req, process.env.CRON_SECRET)) return send(res, 401, { ok: false, error: "unauthenticated" });
  try {
    const group = STEP_GROUPS[req.query?.group] || null;
    const only = group || parseSteps(req.query?.steps);
    const result = await runDaily(supabase(), process.env, { fetch: globalThis.fetch }, { only });
    return send(res, result.ok ? 200 : 500, result);
  } catch (e) {
    console.error("cron failed", e);
    return send(res, 500, { ok: false, error: "server_error" });
  }
}
