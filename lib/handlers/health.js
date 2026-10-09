// GET /api/health -> { ok, checks: { db, storage, cron, outbox, links, news }, version }
// Public and secret-free: counts, timestamps and broken public URLs only.
// Overall ok is false when the database fails, the daily cron has not run in
// 36 hours, or any checked link is broken. Never cached.
import { supabase } from "../supabase.js";
import { send, methodNotAllowed } from "../http.js";
import { BROKEN_AFTER } from "../link-check.js";

const BUCKET = "report-photos";
const CRON_MAX_HOURS = 36;
const NEWS_STALE_HOURS = 48;
const BROKEN_MAX = 20;

const num = (v) => Number(v) || 0;
const hoursSince = (iso) => (iso ? Math.round(((Date.now() - Date.parse(iso)) / 36e5) * 10) / 10 : null);

async function dbCheck(sb) {
  const t0 = Date.now();
  const { error } = await sb.from("cron_runs").select("id").limit(1);
  const ms = Date.now() - t0;
  return error ? { ok: false, ms, error: String(error.message || error).slice(0, 120) } : { ok: true, ms };
}

async function storageCheck(sb) {
  try {
    const { error } = await sb.storage.from(BUCKET).list("", { limit: 1 });
    return { ok: !error };
  } catch { return { ok: false }; }
}

async function cronCheck(sb) {
  const { data, error } = await sb.from("cron_runs").select("started_at, finished_at, ok").order("started_at", { ascending: false }).limit(1);
  if (error) throw error;
  const row = (data || [])[0];
  if (!row) return { last_run_at: null, ok: null, hours_since: null };
  return { last_run_at: row.started_at, ok: row.ok, hours_since: hoursSince(row.started_at) };
}

async function outboxCheck(sb) {
  const [p, f] = await Promise.all([
    sb.from("outbox").select("id", { count: "exact", head: true }).eq("status", "pending"),
    sb.from("outbox").select("id", { count: "exact", head: true }).eq("status", "failed")
  ]);
  if (p.error) throw p.error;
  if (f.error) throw f.error;
  return { pending: num(p.count), failed: num(f.count) };
}

async function linksCheck(sb) {
  const [c, b] = await Promise.all([
    sb.from("link_status").select("url", { count: "exact", head: true }).not("checked_at", "is", null),
    sb.from("link_status").select("url, status, where_used").eq("ok", false).gte("fails", BROKEN_AFTER).order("checked_at", { ascending: false }).limit(BROKEN_MAX)
  ]);
  if (c.error) throw c.error;
  if (b.error) throw b.error;
  return { checked: num(c.count), broken: (b.data || []).map((r) => ({ url: r.url, status: r.status, where_used: r.where_used })) };
}

async function newsCheck(sb) {
  const [s, i] = await Promise.all([
    sb.from("news_sources").select("id, type, last_fetched_at").eq("enabled", true),
    sb.from("news_items").select("id", { count: "exact", head: true })
  ]);
  if (s.error) throw s.error;
  if (i.error) throw i.error;
  const cutoff = Date.now() - NEWS_STALE_HOURS * 36e5;
  const sources = (s.data || []).filter((r) => r.type !== "none");
  const stale = sources.filter((r) => !r.last_fetched_at || Date.parse(r.last_fetched_at) < cutoff).map((r) => r.id);
  return { sources: sources.length, items: num(i.count), stale_sources: stale };
}

// Every check is isolated so one failing table does not hide the others.
export async function healthChecks(sb) {
  const checks = {};
  const run = async (name, fn) => {
    try { checks[name] = await fn(); }
    catch (e) { checks[name] = { ok: false, error: String(e?.message || e).slice(0, 120) }; }
  };
  await run("db", () => dbCheck(sb));
  if (checks.db.ok) {
    await Promise.all([
      run("storage", () => storageCheck(sb)), run("cron", () => cronCheck(sb)), run("outbox", () => outboxCheck(sb)),
      run("links", () => linksCheck(sb)), run("news", () => newsCheck(sb))
    ]);
  } else {
    checks.storage = { ok: false }; checks.cron = { last_run_at: null, ok: null, hours_since: null };
    checks.outbox = { pending: 0, failed: 0 }; checks.links = { checked: 0, broken: [] }; checks.news = { sources: 0, items: 0, stale_sources: [] };
  }
  const cronStale = checks.cron.hours_since === null || checks.cron.hours_since > CRON_MAX_HOURS;
  const ok = !!checks.db.ok && !cronStale && !(checks.links.broken || []).length;
  return { ok, checks };
}

// `sb` is injectable for tests; the router calls handler(req, res).
export default async function handler(req, res, sb) {
  if (req.method !== "GET") return methodNotAllowed(res, "GET");
  res.setHeader("Cache-Control", "no-store");
  let out;
  try {
    sb = sb || supabase();
    out = await healthChecks(sb);
  } catch (e) {
    out = { ok: false, checks: { db: { ok: false, ms: 0, error: String(e?.message || e).slice(0, 120) } } };
  }
  return send(res, out.ok ? 200 : 503, { ...out, version: process.env.VERCEL_GIT_COMMIT_SHA || null, checked_at: new Date().toISOString() });
}
