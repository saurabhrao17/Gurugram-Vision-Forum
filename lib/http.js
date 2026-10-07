// Small helpers shared by the API functions.
import { createHash } from "node:crypto";

export function send(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export function methodNotAllowed(res, allow) {
  res.setHeader("Allow", allow);
  send(res, 405, { ok: false, error: "method_not_allowed" });
}

export function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return null;
}

export function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd || "").split(",")[0].trim();
  return ip || req.socket?.remoteAddress || "unknown";
}

// Hash the IP with a server-side salt so the table never holds raw addresses.
export function ipHash(req) {
  const salt = process.env.IP_HASH_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || "gvf";
  return createHash("sha256").update(salt + "|" + clientIp(req)).digest("hex").slice(0, 32);
}

export const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Indian mobile: 10 digits starting 6 to 9, with or without +91 / 0 prefix.
export function normalisePhone(v) {
  let d = String(v || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (!/^[6-9]\d{9}$/.test(d)) return null;
  return "+91" + d;
}

export const isEmail = (v) => /^\S+@\S+\.\S+$/.test(v);

// Cloudflare Turnstile: enforced only when TURNSTILE_SECRET is configured.
export async function verifyTurnstile(token, req) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return true;
  if (!token) return false;
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token, remoteip: clientIp(req) })
    });
    const j = await r.json();
    return !!j.success;
  } catch {
    return false;
  }
}
