// POST /api/follow { ref, email }        -> { ok: true } (never says whether the email already followed)
// GET  /api/follow?unsubscribe=<token>   -> small HTML page, 200 whether or not the token existed
// Followers get the same stage-change emails as the reporter (reports_notify_stage trigger).
import { randomBytes } from "node:crypto";
import { supabase } from "../supabase.js";
import { send, methodNotAllowed, readJson, text, isEmail } from "../http.js";

const REF = /^GVF-\d{4}-[A-Z2-9]{5}$/;
const TOKEN = /^[0-9a-f]{48}$/;
const MAX_FOLLOWERS = 500;

export function validateFollow(b) {
  const errors = [];
  const out = {};
  out.ref = text(b?.ref, 20).toUpperCase();
  if (!REF.test(out.ref)) errors.push("ref");
  out.email = text(b?.email, 160).toLowerCase();
  if (!isEmail(out.email)) errors.push("email");
  return { errors, out };
}

export const unsubscribeToken = (q) => { const t = text(q?.unsubscribe, 60).toLowerCase(); return TOKEN.test(t) ? t : null; };

const UNSUB_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Unsubscribed</title>
<style>body{font-family:system-ui,sans-serif;background:#fff;color:#0B1F3A;margin:0;padding:48px 16px;line-height:1.5}main{max-width:36rem;margin:0 auto}a{color:#0B1F3A}</style>
</head><body><main>
<p>You will no longer get updates for this report.</p>
<p lang="hi">अब आपको इस रिपोर्ट की सूचनाएँ नहीं मिलेंगी।</p>
<p><a href="https://gurugramvisionforum.org/">Gurugram Vision Forum</a></p>
</main></body></html>
`;

function html(res, status, body) {
  res.status(status).setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(body);
}

// `sb` is injectable for tests; the router calls handler(req, res).
export default async function handler(req, res, sb) {
  if (req.method === "GET") {
    const token = unsubscribeToken(req.query);
    if (!token) return send(res, 400, { ok: false, error: "invalid" });
    try {
      sb = sb || supabase();
      const { error } = await sb.from("followers").delete().eq("token", token);
      if (error) console.error("unsubscribe failed", error);
    } catch (e) { console.error("unsubscribe failed", e); }
    return html(res, 200, UNSUB_HTML);
  }
  if (req.method !== "POST") return methodNotAllowed(res, "GET, POST");

  const body = readJson(req);
  if (!body) return send(res, 400, { ok: false, error: "bad_json" });
  const { errors, out } = validateFollow(body);
  if (errors.length) return send(res, 400, { ok: false, error: "invalid", fields: errors });

  try {
    sb = sb || supabase();
    const { data: report, error } = await sb.from("reports").select("id").eq("ref", out.ref).maybeSingle();
    if (error) throw error;
    if (!report) return send(res, 404, { ok: false, error: "not_found" });

    const { count, error: ce } = await sb.from("followers").select("id", { count: "exact", head: true }).eq("report_id", report.id);
    if (ce) throw ce;
    if ((count || 0) >= MAX_FOLLOWERS) return send(res, 429, { ok: false, error: "too_many" });

    const row = { report_id: report.id, email: out.email, token: randomBytes(24).toString("hex") };
    const { error: ie } = await sb.from("followers").upsert(row, { onConflict: "report_id,email", ignoreDuplicates: true });
    if (ie && ie.code !== "23505") throw ie;
    return send(res, 200, { ok: true });
  } catch (e) {
    console.error("follow failed", e);
    return send(res, 500, { ok: false, error: "server_error" });
  }
}
