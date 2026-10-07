// POST /api/visitor
//   { token, name, phone, email, area, pincode, city, consent, notice_version, first_page, referrer, turnstile }
//     -> registers (or re-registers) the device token: upsert on token, visits + 1   -> { ok: true }
//   { token, event, path, meta }
//     -> records one first-party analytics event (token optional)                    -> { ok: true }
// The browser never sees other visitors; the desk reads them through /api/triage/visitors.
import { supabase } from "../supabase.js";
import { send, methodNotAllowed, readJson, ipHash, text, normalisePhone, isEmail, verifyTurnstile } from "../http.js";

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
const PINCODE = /^[1-9]\d{5}$/;
const LIMIT_PER_HOUR = 30;
const META_MAX = 1024;
export const EVENTS = ["page_view", "report_start", "report_step", "report_submit", "follow", "join", "gate_shown", "gate_done", "gate_skipped", "search", "outbound_click"];

export function validateVisitor(b) {
  const errors = [];
  const out = {};
  b = b && typeof b === "object" ? b : {};
  out.token = text(b.token, 64);
  if (!TOKEN.test(out.token)) errors.push("token");
  out.name = text(b.name, 80);
  if (out.name.length < 2) errors.push("name");
  out.phone = normalisePhone(b.phone);
  if (!out.phone) errors.push("phone");
  out.email = text(b.email, 160).toLowerCase();
  if (!isEmail(out.email)) errors.push("email");
  out.area = text(b.area, 80) || null;
  const pin = text(b.pincode, 10).replace(/\s/g, "");
  if (pin && !PINCODE.test(pin)) errors.push("pincode");
  out.pincode = pin && PINCODE.test(pin) ? pin : null;
  out.city = text(b.city, 40) || "Gurugram";
  if (b.consent !== true) errors.push("consent");
  out.notice_version = text(b.notice_version, 40) || null;
  out.first_page = text(b.first_page, 200) || null;
  out.referrer = text(b.referrer, 300) || null;
  return { errors, out };
}

export function validateEvent(b) {
  const errors = [];
  const out = {};
  b = b && typeof b === "object" ? b : {};
  const token = text(b.token, 64);
  out.visitor_token = token && TOKEN.test(token) ? token : null;
  if (token && !out.visitor_token) errors.push("token");
  out.event = text(b.event, 40);
  if (!EVENTS.includes(out.event)) errors.push("event");
  out.path = text(b.path, 200) || null;
  out.meta = null;
  if (b.meta !== undefined && b.meta !== null) {
    if (typeof b.meta !== "object" || Array.isArray(b.meta)) errors.push("meta");
    else {
      const s = JSON.stringify(b.meta);
      if (s.length > META_MAX) errors.push("meta");
      else out.meta = b.meta;
    }
  }
  return { errors, out };
}

export const isEventBody = (b) => !!b && typeof b === "object" && typeof b.event === "string" && b.name === undefined;

// `sb` is injectable for tests; the router calls handler(req, res).
export default async function handler(req, res, sb) {
  if (req.method !== "POST") return methodNotAllowed(res, "POST");
  const body = readJson(req);
  if (!body) return send(res, 400, { ok: false, error: "bad_json" });

  try {
    if (isEventBody(body)) {
      const { errors, out } = validateEvent(body);
      if (errors.length) return send(res, 400, { ok: false, error: "invalid", fields: errors });
      sb = sb || supabase();
      const { error } = await sb.from("visitor_events").insert({ ...out, ip_hash: ipHash(req) });
      if (error) throw error;
      return send(res, 200, { ok: true });
    }

    const { errors, out } = validateVisitor(body);
    if (errors.length) return send(res, 400, { ok: false, error: "invalid", fields: errors });
    if (!(await verifyTurnstile(body.turnstile, req))) return send(res, 403, { ok: false, error: "captcha_failed" });

    sb = sb || supabase();
    const hash = ipHash(req);
    const { data: recent, error: rlErr } = await sb.rpc("visitors_from_ip_last_hour", { p_ip_hash: hash });
    if (!rlErr && recent >= LIMIT_PER_HOUR) return send(res, 429, { ok: false, error: "too_many" });

    const now = new Date().toISOString();
    const profile = {
      name: out.name, phone: out.phone, email: out.email, area: out.area, pincode: out.pincode, city: out.city,
      notice_version: out.notice_version, user_agent: text(req.headers?.["user-agent"], 300) || null, ip_hash: hash, last_seen_at: now
    };
    const { data: existing, error: le } = await sb.from("visitors").select("id, visits").eq("token", out.token).maybeSingle();
    if (le) throw le;
    if (existing) {
      const { error } = await sb.from("visitors").update({ ...profile, visits: (existing.visits || 0) + 1 }).eq("id", existing.id);
      if (error) throw error;
    } else {
      const row = { ...profile, token: out.token, consent_at: now, first_page: out.first_page, referrer: out.referrer, visits: 1 };
      const { error } = await sb.from("visitors").upsert(row, { onConflict: "token" });
      if (error) throw error;
    }
    return send(res, 200, { ok: true });
  } catch (e) {
    console.error("visitor failed", e);
    return send(res, 500, { ok: false, error: "server_error" });
  }
}
