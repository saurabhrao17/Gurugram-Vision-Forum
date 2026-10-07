// GET /api/cron/daily: called by Vercel Cron with "Authorization: Bearer <CRON_SECRET>".
// Runs, in order: the SLA digest (overdue reports to the coordinator), the
// outbox sender (pending emails through Resend) and the 24-month retention
// sweep (reports plus their storage objects).
// Env: CRON_SECRET (required), COORDINATOR_EMAIL, RESEND_API_KEY, MAIL_FROM.
import { timingSafeEqual } from "node:crypto";
import { supabase } from "../supabase.js";
import { send, methodNotAllowed } from "../http.js";

const SITE = "https://gurugramvisionforum.org";
const RESEND_URL = "https://api.resend.com/emails";
const BUCKET = "report-photos";
const BATCH = 50;
const MAX_ATTEMPTS = 5;
const DEFAULT_FROM = "Gurugram Vision Forum <noreply@gurugramvisionforum.org>";

function secretMatches(req, secret) {
  if (!secret) return false;
  const h = req.headers?.authorization || "";
  const m = /^Bearer\s+(\S+)$/i.exec(Array.isArray(h) ? h[0] : h);
  if (!m) return false;
  const a = Buffer.from(m[1]), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Builds the coordinator's digest row. Only the fields named here are copied,
// so nothing about the reporter can leak into the body.
export function slaDigestMail(digest, to) {
  const unmapped = Array.isArray(digest?.unmapped) ? digest.unmapped : [];
  const filed = Array.isArray(digest?.filed_overdue) ? digest.filed_overdue : [];
  const line = (r, tail) => `- ${r.ref}: ${r.issue_type || "?"}, ${r.area || "?"}${r.ward ? `, ward ${r.ward}` : ""}, ${tail}\n  ${SITE}/#/desk/${r.ref}`;
  const parts = [`SLA digest for ${new Date().toISOString().slice(0, 10)}`, ""];
  parts.push(`Not mapped within 3 working days (${unmapped.length}):`);
  parts.push(unmapped.length ? unmapped.map((r) => line(r, `${plural(r.days ?? 0, "working day", "working days")} since received`)).join("\n") : "- none");
  parts.push("");
  parts.push(`Filed more than 21 days ago with no change (${filed.length}):`);
  parts.push(filed.length ? filed.map((r) => line(r, `${plural(r.days ?? 0, "day", "days")} since filed${r.official_ticket ? `, ticket ${r.official_ticket}` : ", no ticket recorded"}`)).join("\n") : "- none");
  parts.push("", "Open the desk: " + SITE + "/#/desk", "");
  return {
    to_email: to,
    subject: `SLA digest: ${plural(unmapped.length, "report", "reports")} unmapped, ${filed.length} filed past 21 days`,
    body_text: parts.join("\n"),
    kind: "sla"
  };
}

// One Resend call. Throws with a short message on any failure.
export async function sendMail(row, env = process.env) {
  const key = env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY not set");
  const payload = {
    from: env.MAIL_FROM || DEFAULT_FROM,
    to: [row.to_email],
    subject: row.subject,
    text: row.body_text
  };
  if (row.body_html) payload.html = row.body_html;
  const r = await fetch(RESEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`resend ${r.status}: ${detail.slice(0, 300)}`);
  }
  return r.json().catch(() => ({}));
}

async function slaStep(sb, env) {
  const { data, error } = await sb.rpc("sla_digest");
  if (error) throw new Error(`sla_digest: ${error.message || error}`);
  const digest = data || {};
  const unmapped = Array.isArray(digest.unmapped) ? digest.unmapped.length : 0;
  const filed = Array.isArray(digest.filed_overdue) ? digest.filed_overdue.length : 0;
  let digest_sent = false;
  if ((unmapped || filed) && env.COORDINATOR_EMAIL) {
    const { error: e2 } = await sb.from("outbox").insert(slaDigestMail(digest, env.COORDINATOR_EMAIL));
    if (e2) throw new Error(`outbox insert: ${e2.message || e2}`);
    digest_sent = true;
  }
  return { unmapped, filed_overdue: filed, digest_sent };
}

async function outboxStep(sb, env) {
  const { data, error } = await sb.from("outbox")
    .select("id, to_email, subject, body_text, body_html, attempts")
    .eq("status", "pending").lt("attempts", MAX_ATTEMPTS)
    .order("id", { ascending: true }).limit(BATCH);
  if (error) throw new Error(`outbox select: ${error.message || error}`);
  const rows = data || [];
  const out = { sent: 0, failed: 0, skipped: 0 };
  if (!env.RESEND_API_KEY) { out.skipped = rows.length; return out; }
  for (const row of rows) {
    let patch;
    try {
      await sendMail(row, env);
      patch = { status: "sent", sent_at: new Date().toISOString(), attempts: (row.attempts || 0) + 1, last_error: null };
      out.sent++;
    } catch (e) {
      const attempts = (row.attempts || 0) + 1;
      patch = { attempts, last_error: String(e?.message || e).slice(0, 500), status: attempts >= MAX_ATTEMPTS ? "failed" : "pending" };
      out.failed++;
    }
    const { error: e2 } = await sb.from("outbox").update(patch).eq("id", row.id);
    if (e2) console.error("outbox update failed", row.id, e2);
  }
  return out;
}

async function retentionStep(sb) {
  const { data, error } = await sb.rpc("retention_sweep");
  if (error) throw new Error(`retention_sweep: ${error.message || error}`);
  const refs = Array.isArray(data?.refs) ? data.refs : [];
  for (const ref of refs) {
    try {
      const { data: objects, error: le } = await sb.storage.from(BUCKET).list(ref, { limit: 100 });
      if (le) { console.error("retention: list failed", ref, le); continue; }
      const paths = (objects || []).map((o) => `${ref}/${o.name}`);
      if (!paths.length) continue;
      const { error: re } = await sb.storage.from(BUCKET).remove(paths);
      if (re) console.error("retention: remove failed", ref, re);
    } catch (e) { console.error("retention: storage error", ref, e); }
  }
  return { deleted: Number(data?.deleted) || refs.length };
}

// The whole daily run against an injected client, so tests can pass a fake.
// Each step is isolated: a failure is recorded in `errors` and the rest still run.
export async function runDaily(sb, env = process.env) {
  const result = { ok: true, sla: { unmapped: 0, filed_overdue: 0, digest_sent: false }, outbox: { sent: 0, failed: 0, skipped: 0 }, retention: { deleted: 0 }, errors: [] };
  const steps = [["sla", () => slaStep(sb, env)], ["outbox", () => outboxStep(sb, env)], ["retention", () => retentionStep(sb)]];
  for (const [name, fn] of steps) {
    try { result[name] = await fn(); }
    catch (e) { console.error(`cron ${name} failed`, e); result.ok = false; result.errors.push(`${name}: ${String(e?.message || e).slice(0, 200)}`); }
  }
  if (!result.errors.length) delete result.errors;
  return result;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, "GET");
  if (!secretMatches(req, process.env.CRON_SECRET)) return send(res, 401, { ok: false, error: "unauthenticated" });
  try {
    const result = await runDaily(supabase(), process.env);
    return send(res, result.ok ? 200 : 500, result);
  } catch (e) {
    console.error("cron failed", e);
    return send(res, 500, { ok: false, error: "server_error" });
  }
}
