// GET /api/news?limit=   -> the latest items the daily cron fetched from the
// official and local-press sources in news_sources, newest first. Public;
// cached for ten minutes.
import { supabase } from "../supabase.js";
import { send, methodNotAllowed } from "../http.js";

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;

export const clampLimit = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(Math.max(n, 1), MAX_LIMIT) : DEFAULT_LIMIT; };
const when = (i) => Date.parse(i.published_at || i.fetched_at || 0) || 0;

// `sb` is injectable for tests; the router calls handler(req, res).
export default async function handler(req, res, sb) {
  if (req.method !== "GET") return methodNotAllowed(res, "GET");
  const limit = clampLimit(req.query?.limit);
  try {
    sb = sb || supabase();
    const [sources, items] = await Promise.all([
      sb.from("news_sources").select("id, name, home, enabled, last_fetched_at, last_status").eq("enabled", true).order("name", { ascending: true }),
      sb.from("news_items").select("source_id, title, url, published_at, fetched_at").order("fetched_at", { ascending: false }).limit(limit * 3)
    ]);
    if (sources.error) throw sources.error;
    if (items.error) throw items.error;
    const byId = new Map((sources.data || []).map((s) => [s.id, s]));
    const out = (items.data || [])
      .filter((i) => byId.has(i.source_id))
      .sort((a, b) => when(b) - when(a))
      .slice(0, limit)
      .map((i) => ({ title: i.title, url: i.url, published_at: i.published_at, fetched_at: i.fetched_at, source_id: i.source_id, source_name: byId.get(i.source_id).name, home: byId.get(i.source_id).home || null }));
    res.setHeader("Cache-Control", "public, max-age=600");
    return send(res, 200, {
      ok: true,
      items: out,
      sources: (sources.data || []).map((s) => ({ id: s.id, name: s.name, home: s.home || null, last_fetched_at: s.last_fetched_at, last_status: s.last_status }))
    });
  } catch (e) {
    console.error("news failed", e);
    return send(res, 500, { ok: false, error: "server_error" });
  }
}
