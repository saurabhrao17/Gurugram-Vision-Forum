// GET /api/cron/daily: called by Vercel Cron with "Authorization: Bearer <CRON_SECRET>".
// Runs, in order: the news fetch (news_sources -> news_items), the link check
// (40 of the site's external URLs per run -> link_status), the signals scan
// (Reddit public JSON, Google News RSS and the Forum's own reports ->
// signals), the insights step (the week's pulse against the week before ->
// insights), the SLA digest (overdue reports and broken links to the
// coordinator), the outbox sender (pending emails through Resend) and the
// 24-month retention sweep (reports plus their storage objects). Every run
// is logged in cron_runs.
// Env: CRON_SECRET (required), COORDINATOR_EMAIL, RESEND_API_KEY, MAIL_FROM;
// GEMINI_API_KEY / GROQ_API_KEY / ANTHROPIC_API_KEY (optional, for the brief).
import { timingSafeEqual } from "node:crypto";
import { supabase } from "../supabase.js";
import { send, methodNotAllowed } from "../http.js";
import { fetchSources, loadSourcesFile } from "../news-fetch.js";
import { collectLinks, checkLinks, storeLinkStatus } from "../link-check.js";
import { fetchReddit, fetchGoogleNews, signalsFromReports, computePulse, narrate, insightData } from "../signals.js";

const SITE = "https://gurugramvisionforum.org";
const RESEND_URL = "https://api.resend.com/emails";
const BUCKET = "report-photos";
const BATCH = 50;
const MAX_ATTEMPTS = 5;
const DEFAULT_FROM = "Gurugram Vision Forum <noreply@gurugramvisionforum.org>";
const LINKS_PER_RUN = 40;
const LINK_TIMEOUT_MS = 8000;
const LINK_CONCURRENCY = 5;
const BROKEN_IN_DIGEST = 50;
const SIGNAL_DAYS = 7;          // the pulse window, and the window of the Forum's own reports scanned
const SIGNAL_RETENTION_DAYS = 60;
const SIGNAL_BATCH = 200;
const REPORTS_SCANNED = 500;

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
// News RSS searches are fetched with the injected client; the Forum's own
// reports of the last 7 days are read by reference only. Everything is
// upserted on (source, external_id) and rows older than 60 days are deleted.
// Without a fetch client (unit tests) the whole step skips.
async function signalsStep(sb, fetchImpl) {
  const out = { reddit: 0, news: 0, reports: 0, new: 0 };
  if (!fetchImpl) { out.skipped = true; return out; }
  const since = new Date(Date.now() - SIGNAL_DAYS * 86400000).toISOString();
  const { data: reports, error } = await sb.from("reports").select("ref, issue_type, area, ward, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(REPORTS_SCANNED);
  if (error) throw new Error(`reports select: ${error.message || error}`);
  const [reddit, news] = await Promise.all([fetchReddit(fetchImpl), fetchGoogleNews(fetchImpl)]);
  const own = signalsFromReports(reports || []);
  out.reddit = reddit.length; out.news = news.length; out.reports = own.length;
  const rows = [...reddit, ...news, ...own];
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
async function insightsStep(sb, env, fetchImpl) {
  const out = { topics: 0, ai: false, stored: false };
  if (!fetchImpl) { out.skipped = true; return out; }
  const now = Date.now();
  const since = new Date(now - 2 * SIGNAL_DAYS * 86400000).toISOString();
  const { data, error } = await sb.from("signals").select("source, title, url, posted_at, fetched_at, issue_type, area, score").gte("posted_at", since).order("posted_at", { ascending: false }).limit(5000);
  if (error) throw new Error(`signals select: ${error.message || error}`);
  const pulse = computePulse(data || [], { days: SIGNAL_DAYS, prev: SIGNAL_DAYS, now });
  out.topics = pulse.topics.length;
  if (!pulse.total) return out;
  const brief = await narrate(env, pulse, fetchImpl);
  out.ai = !!brief.ai;
  const row = { period_start: pulse.period.from, period_end: pulse.period.to, data: insightData(pulse, brief), published: true };
  const { error: ie } = await sb.from("insights").insert(row);
  if (ie) throw new Error(`insights insert: ${ie.message || ie}`);
  out.stored = true;
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
export async function runDaily(sb, env = process.env, deps = {}) {
  const fetchImpl = deps.fetch || null;
  const result = {
    ok: true,
    news: { sources: 0, fetched: 0, new_items: 0, failed: [] },
    links: { total: 0, checked: 0, broken: 0, remaining: 0 },
    signals: { reddit: 0, news: 0, reports: 0, new: 0 },
    insights: { topics: 0, ai: false, stored: false },
    sla: { unmapped: 0, filed_overdue: 0, digest_sent: false },
    outbox: { sent: 0, failed: 0, skipped: 0 },
    retention: { deleted: 0 },
    errors: []
  };
  const runId = await startRun(sb);
  const steps = [
    ["news", () => newsStep(sb, fetchImpl)],
    ["links", () => linksStep(sb, fetchImpl)],
    ["signals", () => signalsStep(sb, fetchImpl)],
    ["insights", () => insightsStep(sb, env, fetchImpl)],
    ["sla", () => slaStep(sb, env)],
    ["outbox", () => outboxStep(sb, env)],
    ["retention", () => retentionStep(sb)]
  ];
  for (const [name, fn] of steps) {
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
    const result = await runDaily(supabase(), process.env, { fetch: globalThis.fetch });
    return send(res, result.ok ? 200 : 500, result);
  } catch (e) {
    console.error("cron failed", e);
    return send(res, 500, { ok: false, error: "server_error" });
  }
}
