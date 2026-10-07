// GET /api/triage/visitors?days=&offset=&limit=   -> { ok, stats, visitors, total, offset, limit }
// GET /api/triage/visitors?export=csv              -> visitors.csv download
// Owner only: this is the one place the Forum sees who registered at the
// gate. Nothing here is ever rendered publicly.
import { supabase } from "../../supabase.js";
import { requireStaff, handleError } from "../../auth.js";
import { send, methodNotAllowed, text } from "../../http.js";

const COLS = "id, name, phone, email, area, pincode, city, consent_at, notice_version, first_page, referrer, created_at, last_seen_at, visits";
const CSV_COLS = ["name", "phone", "email", "area", "pincode", "city", "consent_at", "created_at", "last_seen_at", "visits"];
const EXPORT_MAX = 10000;

export const clampDays = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(Math.max(n, 1), 3650) : 30; };

// Quotes every field. A value that a spreadsheet would run as a formula
// (leading =, @, tab, or +/- followed by anything but digits) is prefixed with
// an apostrophe; E.164 phone numbers (+91...) are left as they are.
export function csvCell(v) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=@\t\r]/.test(s) || /^[+\-](?!\d+$)/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(rows, cols = CSV_COLS) {
  const lines = [cols.map(csvCell).join(",")];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

// `auth` and `sb` are injectable for tests; the router calls handler(req, res).
export function makeHandler({ auth, sb: sbIn } = {}) {
  const requireAuth = auth || requireStaff;
  return async function handler(req, res, sb) {
  if (req.method !== "GET") return methodNotAllowed(res, "GET");
  try {
    await requireAuth(req, ["owner"]);
    sb = sb || sbIn || supabase();
    const qs = req.query || {};

    if (text(qs.export, 10) === "csv") {
      const { data, error } = await sb.from("visitors").select(CSV_COLS.join(", ")).order("created_at", { ascending: false }).limit(EXPORT_MAX);
      if (error) throw error;
      res.status(200);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="visitors.csv"');
      res.setHeader("Cache-Control", "no-store");
      return res.end(toCsv(data || []));
    }

    const days = clampDays(qs.days);
    const limit = Math.min(Math.max(parseInt(qs.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(qs.offset, 10) || 0, 0);
    const [stats, list] = await Promise.all([
      sb.rpc("visitor_stats", { p_days: days }),
      sb.from("visitors").select(COLS, { count: "exact" }).order("created_at", { ascending: false }).range(offset, offset + limit - 1)
    ]);
    if (stats.error) throw stats.error;
    if (list.error) throw list.error;
    res.setHeader("Cache-Control", "no-store");
    return send(res, 200, { ok: true, stats: stats.data || null, visitors: list.data || [], total: list.count ?? (list.data || []).length, offset, limit, days });
  } catch (e) { return handleError(res, e); }
  };
}

export default makeHandler();
