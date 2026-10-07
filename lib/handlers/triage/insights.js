// GET /api/triage/insights?limit=  -> { ok, insights, signals, since, limit }
// The desk's view of the Gurugram pulse: the latest insights (up to 12) and
// the 100 highest-scoring signals of the last 7 days, for owners,
// coordinators and the content team. Signals carry a public post's title,
// snippet, link and date only; no author or handle is stored or shown.
import { supabase } from "../../supabase.js";
import { requireStaff, handleError } from "../../auth.js";
import { send, methodNotAllowed } from "../../http.js";

export const ROLES = ["owner", "coordinator", "content"];
const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 12;
const SIGNALS_MAX = 100;
const SIGNAL_DAYS = 7;
const INSIGHT_COLS = "id, period_start, period_end, generated_at, data, published";
const SIGNAL_COLS = "id, source, external_id, title, snippet, url, posted_at, fetched_at, issue_type, area, ward, score, lang";

export const clampLimit = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(Math.max(n, 1), MAX_LIMIT) : DEFAULT_LIMIT; };

// `auth` and `sb` are injectable for tests; the router calls handler(req, res).
export function makeHandler({ auth, sb: sbIn } = {}) {
  const requireAuth = auth || requireStaff;
  return async function handler(req, res, sb) {
    if (req.method !== "GET") return methodNotAllowed(res, "GET");
    try {
      await requireAuth(req, ROLES);
      sb = sb || sbIn || supabase();
      const limit = clampLimit(req.query?.limit);
      const since = new Date(Date.now() - SIGNAL_DAYS * 86400000).toISOString();
      const [insights, signals] = await Promise.all([
        sb.from("insights").select(INSIGHT_COLS).order("generated_at", { ascending: false }).limit(limit),
        sb.from("signals").select(SIGNAL_COLS).gte("posted_at", since).order("score", { ascending: false }).limit(SIGNALS_MAX)
      ]);
      if (insights.error) throw insights.error;
      if (signals.error) throw signals.error;
      res.setHeader("Cache-Control", "no-store");
      return send(res, 200, { ok: true, insights: insights.data || [], signals: signals.data || [], since, limit });
    } catch (e) { return handleError(res, e); }
  };
}

export default makeHandler();
