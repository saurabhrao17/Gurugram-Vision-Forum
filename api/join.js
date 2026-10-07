// POST /api/join: stores a volunteer, chapter lead or youth fellow sign-up.
import { supabase } from "../lib/supabase.js";
import { send, methodNotAllowed, readJson, ipHash, text, normalisePhone, isEmail, verifyTurnstile } from "../lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, "POST");
  const b = readJson(req);
  if (!b) return send(res, 400, { ok: false, error: "bad_json" });

  const errors = [];
  const name = text(b.name, 120); if (!name) errors.push("name");
  const phone = normalisePhone(b.phone); if (!phone) errors.push("phone");
  const email = text(b.email, 160); if (!isEmail(email)) errors.push("email");
  const role = text(b.role, 60); if (!role) errors.push("role");
  if (errors.length) return send(res, 400, { ok: false, error: "invalid", fields: errors });

  if (!(await verifyTurnstile(b.turnstile, req))) return send(res, 403, { ok: false, error: "captcha_failed" });

  const { error } = await supabase().from("joins").insert({
    name, phone, email, role,
    area: text(b.area, 160) || null,
    note: text(b.note, 2000) || null,
    ip_hash: ipHash(req)
  });
  if (error) {
    console.error("join insert failed", error);
    return send(res, 500, { ok: false, error: "server_error" });
  }
  return send(res, 201, { ok: true });
}
