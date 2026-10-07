// POST /api/report: creates a report and returns its reference.
// Body: { issue_type, affects, area, ward, spot, lat, lng, description, name, phone, email, consent, turnstile }
import { supabase } from "../supabase.js";
import { send, methodNotAllowed, readJson, ipHash, text, normalisePhone, isEmail, verifyTurnstile } from "../http.js";
import { cleanExtra } from "../filing.js";
import { randomBytes, createHash } from "node:crypto";

const AFFECTS = ["Me or my family", "My society or RWA", "My sector or neighbourhood", "The whole city"];
const LIMIT_PER_HOUR = 5;

export function validate(b) {
  const errors = [];
  const out = {};
  out.issue_type = text(b.issue_type, 40);
  if (!out.issue_type) errors.push("issue_type");
  out.affects = text(b.affects, 60) || null;
  if (out.affects && !AFFECTS.includes(out.affects)) out.affects = null;
  out.area = text(b.area, 160);
  if (!out.area) errors.push("area");
  const ward = parseInt(b.ward, 10);
  out.ward = Number.isInteger(ward) && ward >= 1 && ward <= 36 ? ward : null;
  out.spot = text(b.spot, 240) || null;
  const lat = parseFloat(b.lat), lng = parseFloat(b.lng);
  out.lat = Number.isFinite(lat) && Math.abs(lat) <= 90 ? lat : null;
  out.lng = Number.isFinite(lng) && Math.abs(lng) <= 180 ? lng : null;
  out.description = text(b.description, 4000);
  if (!out.description) errors.push("description");
  out.reporter_name = text(b.name, 120);
  if (!out.reporter_name) errors.push("name");
  out.reporter_phone = normalisePhone(b.phone);
  if (!out.reporter_phone) errors.push("phone");
  const email = text(b.email, 160);
  out.reporter_email = email ? (isEmail(email) ? email : (errors.push("email"), null)) : null;
  if (b.consent !== true) errors.push("consent");
  out.extra = cleanExtra(b.extra);
  return { errors, out };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, "POST");
  const body = readJson(req);
  if (!body) return send(res, 400, { ok: false, error: "bad_json" });

  const { errors, out } = validate(body);
  if (errors.length) return send(res, 400, { ok: false, error: "invalid", fields: errors });

  if (!(await verifyTurnstile(body.turnstile, req))) {
    return send(res, 403, { ok: false, error: "captcha_failed" });
  }

  const sb = supabase();
  const hash = ipHash(req);
  const { data: recent, error: rlErr } = await sb.rpc("reports_from_ip_last_hour", { p_ip_hash: hash });
  if (!rlErr && recent >= LIMIT_PER_HOUR) {
    return send(res, 429, { ok: false, error: "too_many_reports" });
  }

  // Ward: keep the resident's choice, but record what the map or the sector table says.
  let detected = null, detectedSource = null;
  try {
    const { data: d } = await sb.rpc("detect_ward", { p_lat: out.lat, p_lng: out.lng, p_area: out.area });
    if (d && d.ward) { detected = d.ward; detectedSource = d.source; }
  } catch (e) { console.error("detect_ward failed", e); }
  const wardSource = out.ward ? "manual" : (detected ? detectedSource : null);
  // One-hour token so the browser can attach files to this report only
  const uploadToken = randomBytes(24).toString("hex");
  const row = {
    ...out,
    upload_token_hash: createHash("sha256").update(uploadToken).digest("hex"),
    upload_token_expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    ward: out.ward || detected,
    ward_detected: detected,
    ward_source: wardSource,
    consent_at: new Date().toISOString(),
    source: "web",
    ip_hash: hash,
    user_agent: text(req.headers["user-agent"], 300) || null
  };
  const { data, error } = await sb.from("reports").insert(row).select("ref, stage, created_at").single();
  if (error) {
    if (error.code === "23503") return send(res, 400, { ok: false, error: "invalid", fields: ["issue_type"] });
    console.error("report insert failed", error);
    return send(res, 500, { ok: false, error: "server_error" });
  }
  return send(res, 201, { ok: true, ref: data.ref, stage: data.stage, created_at: data.created_at, ward: row.ward, ward_source: row.ward_source, upload_token: uploadToken });
}
