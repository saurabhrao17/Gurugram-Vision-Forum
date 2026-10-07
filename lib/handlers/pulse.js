// GET /api/pulse -> the latest Gurugram pulse: what residents talked about
// this week (topics with counts, areas, example links), the headline and
// summary in both languages and the suggested actions, as the daily cron
// stored it in insights.data. Public; cached for ten minutes. Counts and
// public links only: nothing here identifies a reporter or a poster.
import { supabase } from "../supabase.js";
import { send, methodNotAllowed } from "../http.js";

const COLS = "generated_at, period_start, period_end, data";

// `sb` is injectable for tests; the router calls handler(req, res).
export default async function handler(req, res, sb) {
  if (req.method !== "GET") return methodNotAllowed(res, "GET");
  try {
    sb = sb || supabase();
    const { data, error } = await sb.from("insights").select(COLS).eq("published", true).order("generated_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    res.setHeader("Cache-Control", "public, max-age=600");
    if (!data || !data.data) return send(res, 200, { ok: true, pulse: null });
    const d = data.data;
    return send(res, 200, {
      ok: true,
      pulse: {
        generated_at: data.generated_at,
        period: d.period || { from: data.period_start, to: data.period_end },
        headline_en: d.headline_en || "",
        headline_hi: d.headline_hi || "",
        summary_en: d.summary_en || "",
        summary_hi: d.summary_hi || "",
        total: d.total || 0,
        sources_checked: d.sources_checked || [],
        topics: Array.isArray(d.topics) ? d.topics : [],
        actions: Array.isArray(d.actions) ? d.actions : [],
        ai: !!d.ai
      }
    });
  } catch (e) {
    console.error("pulse failed", e);
    return send(res, 500, { ok: false, error: "server_error" });
  }
}
