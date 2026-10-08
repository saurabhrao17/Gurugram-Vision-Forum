// POST /api/join: stores a volunteer, chapter lead or youth fellow sign-up.
import { supabase } from "../supabase.js";
import { send, methodNotAllowed, readJson, ipHash, text, normalisePhone, isEmail, verifyTurnstile } from "../http.js";

// The coordinator's note: who wants to join and as what; the details stay on
// the desk (no phone or email in the mail, which may be forwarded).
export function joinMail(j, to, env = process.env) {
  const site = (env && env.SITE_URL) || "https://gurugramvisionforum.org";
  const lines = [`${j.name} asked to join the Forum as ${j.role}${j.area ? ` (${j.area})` : ""}.`, ""];
  if (j.note) lines.push(`Note: ${j.note}`, "");
  lines.push(`Open the desk to see the contact details and mark it contacted: ${site}/#/desk (Join requests tab).`);
  return { to_email: to, subject: `New join request: ${j.name} (${j.role})`, body_text: lines.join("\n"), kind: "join" };
}

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

  const sb = supabase();
  const area = text(b.area, 160) || null, note = text(b.note, 2000) || null;
  const { error } = await sb.from("joins").insert({ name, phone, email, role, area, note, ip_hash: ipHash(req) });
  if (error) {
    console.error("join insert failed", error);
    return send(res, 500, { ok: false, error: "server_error" });
  }
  // Tell the coordinator through the outbox (the cron sends it); the desk's
  // Join requests tab is the record. Never from here directly.
  const to = text(process.env.COORDINATOR_EMAIL, 160);
  if (to) {
    const { error: oe } = await sb.from("outbox").insert(joinMail({ name, role, area, note }, to, process.env));
    if (oe) console.error("join outbox insert failed", oe);
  }
  return send(res, 201, { ok: true });
}
