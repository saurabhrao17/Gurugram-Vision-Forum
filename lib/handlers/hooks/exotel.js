// /api/hooks/exotel: Exotel call webhook (passthru applet or status callback).
// GET or POST with query or form-encoded parameters: CallSid, From, To,
// CallStatus, RecordingUrl, Direction, digits. One report per CallSid with
// source 'phone'; a later callback for the same call only adds the recording.
// Auth: ?token= or X-Webhook-Token must equal EXOTEL_WEBHOOK_TOKEN when set.
import { timingSafeEqual } from "node:crypto";
import { supabase } from "../../supabase.js";
import { send, methodNotAllowed, text, normalisePhone } from "../../http.js";
import { makeStore } from "../../inbound.js";

// Query plus body, keys lower-cased so CallSid / callsid / CALLSID all work.
export function params(req) {
  const out = {};
  const put = (k, v) => { if (typeof v === "string" && v !== "") out[String(k).toLowerCase()] = v; };
  for (const [k, v] of Object.entries(req.query || {})) put(k, Array.isArray(v) ? v[0] : v);
  const b = req.body;
  if (typeof b === "string" && b) {
    const t = b.trim();
    if (t.startsWith("{")) { try { for (const [k, v] of Object.entries(JSON.parse(t))) put(k, v == null ? "" : String(v)); } catch { /* ignore */ } }
    else for (const [k, v] of new URLSearchParams(t)) put(k, v);
  } else if (b && typeof b === "object") {
    for (const [k, v] of Object.entries(b)) put(k, Array.isArray(v) ? v[0] : v == null ? "" : String(v));
  }
  return out;
}

function tokenOk(expected, given) {
  if (!expected) return true;
  const g = String(given || "");
  if (g.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(g, "utf8"), Buffer.from(expected, "utf8"));
}

export function describeCall(p) {
  let d = "Helpline call";
  if (p.recordingurl) d += ", recording: " + text(p.recordingurl, 500);
  if (p.digits) d += ", keyed: " + text(p.digits, 40).replace(/"/g, "");
  return d;
}

export async function handle(req, res, deps = {}) {
  const env = deps.env || process.env;
  if (req.method !== "GET" && req.method !== "POST") return methodNotAllowed(res, "GET, POST");
  const p = params(req);
  const given = p.token || req.headers?.["x-webhook-token"];
  if (!tokenOk(env.EXOTEL_WEBHOOK_TOKEN, given)) return send(res, 401, { ok: false, error: "unauthorised" });

  const callSid = text(p.callsid, 120);
  if (!callSid) return send(res, 400, { ok: false, error: "missing_call_sid" });
  const phone = normalisePhone(p.from);
  if (!phone) return send(res, 400, { ok: false, error: "bad_phone" });

  const store = deps.store || makeStore(supabase());
  const payload = { to: p.to || null, status: p.callstatus || null, direction: p.direction || null, digits: p.digits || null, recording: p.recordingurl ? true : false };

  const earlier = await store.seen("exotel", callSid);
  if (earlier) {
    // Status callbacks arrive after the passthru with the recording link.
    if (earlier.report_id && p.recordingurl) await store.appendDescription(earlier.report_id, ", recording: " + text(p.recordingurl, 500));
    const r = earlier.report_id ? await store.reportById(earlier.report_id) : null;
    return send(res, 200, { ok: true, ref: r?.ref || null, duplicate: true });
  }

  const report = await store.createReport({
    issue_type: "other",
    affects: "Me or my family",
    area: "Helpline call",
    spot: null, lat: null, lng: null,
    description: describeCall(p),
    reporter_name: "Helpline caller",
    reporter_phone: phone,
    reporter_email: null,
    consent_at: new Date().toISOString(),
    source: "phone",
    ip_hash: null,
    user_agent: "exotel"
  });
  await store.recordInbound({ provider: "exotel", external_id: callSid, from_number: phone, payload, report_id: report.id });
  return send(res, 200, { ok: true, ref: report.ref });
}

export default function handler(req, res) {
  return handle(req, res);
}
