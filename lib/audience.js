// Newsletter audience sync (owner's ask, 8 Oct 2026): the Forum keeps the
// subscriber record itself (double opt-in, token links, DPDP-minded) and
// mirrors it to Resend contacts, the free tier of the mail provider the site
// already uses (1,000 contacts and unlimited Broadcasts at no cost, a rich
// editor, its own unsubscribe link in every broadcast, contact webhooks).
//  * a confirmed subscriber is created as a contact (or re-subscribed);
//  * an unsubscribe here is pushed as unsubscribed=true, an erasure as a delete;
//  * an unsubscribe on Resend's side comes back through /api/hooks/email
//    (contact.updated / contact.deleted) and stops the Forum's own digest too;
//  * the nightly cron step `audience` re-pushes anything that failed.
// Nothing but the email address and language ever leaves the Forum; the
// contact carries no name. With no RESEND_API_KEY every call is a no-op and
// the desk says so. RESEND_AUDIENCE_ID keeps older accounts on the
// audience-scoped paths; new accounts use the global /contacts endpoints.
export const RESEND_API = "https://api.resend.com";
const TIMEOUT_MS = 8000;
const PAGE = 100;

export const syncEnabled = (env = process.env) => !!env.RESEND_API_KEY && String(env.AUDIENCE_SYNC || "resend").toLowerCase() !== "off";

function paths(env) {
  const aud = env.RESEND_AUDIENCE_ID ? `/audiences/${encodeURIComponent(env.RESEND_AUDIENCE_ID)}` : "";
  return { create: `${aud}/contacts`, one: (email) => `${aud}/contacts/${encodeURIComponent(email)}` };
}

async function call(env, fetchImpl, method, path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetchImpl(`${RESEND_API}${path}`, {
      method, signal: ctrl.signal,
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let json = null;
    try { json = await r.json(); } catch { json = null; }
    return { status: Number(r.status) || 0, json };
  } catch (e) {
    return { status: 0, json: null, error: e?.name === "AbortError" ? "timeout" : String(e?.message || e).slice(0, 200) };
  } finally { clearTimeout(timer); }
}

const errorOf = (r) => r.error || (r.json && (r.json.message || r.json.name)) || `http_${r.status}`;
const exists = (r) => r.status === 409 || (r.status === 422 && /exist/i.test(String(r.json?.message || "")));

// Create the contact, or re-subscribe it when it already exists.
export async function pushContact(env, { email, lang }, fetchImpl = fetch) {
  if (!syncEnabled(env)) return { ok: false, skipped: "no_key" };
  const p = paths(env);
  let r = await call(env, fetchImpl, "POST", p.create, { email, unsubscribed: false, ...(lang ? { properties: { lang } } : {}) });
  // Older accounts reject unknown properties; try again with the address alone.
  if (r.status === 422 && !exists(r) && lang) r = await call(env, fetchImpl, "POST", p.create, { email, unsubscribed: false });
  if (exists(r)) r = await call(env, fetchImpl, "PATCH", p.one(email), { unsubscribed: false });
  if (r.status >= 200 && r.status < 300) return { ok: true, id: r.json?.id || r.json?.data?.id || null };
  return { ok: false, error: errorOf(r), status: r.status };
}

// Mark the contact unsubscribed; a contact Resend never had is fine.
export async function pushUnsubscribe(env, email, fetchImpl = fetch) {
  if (!syncEnabled(env)) return { ok: false, skipped: "no_key" };
  const r = await call(env, fetchImpl, "PATCH", paths(env).one(email), { unsubscribed: true });
  if ((r.status >= 200 && r.status < 300) || r.status === 404) return { ok: true, id: r.json?.id || null };
  return { ok: false, error: errorOf(r), status: r.status };
}

// Remove the contact (erasure request from the desk).
export async function pushDelete(env, email, fetchImpl = fetch) {
  if (!syncEnabled(env)) return { ok: false, skipped: "no_key" };
  const r = await call(env, fetchImpl, "DELETE", paths(env).one(email));
  if ((r.status >= 200 && r.status < 300) || r.status === 404) return { ok: true };
  return { ok: false, error: errorOf(r), status: r.status };
}

// Push one subscriber row in its current state and record the outcome on the
// row (synced_at, external_id, sync_error). Never throws: the public
// confirm/unsubscribe pages and the desk must not fail because the mirror is
// down; the nightly step retries anything with synced_at null.
export async function syncSubscriber(sb, env, row, fetchImpl = fetch) {
  if (!row || !row.confirmed_at) return { ok: false, skipped: "unconfirmed" };
  if (!syncEnabled(env)) return { ok: false, skipped: "no_key" };
  let r;
  try {
    r = row.unsubscribed_at ? await pushUnsubscribe(env, row.email, fetchImpl) : await pushContact(env, { email: row.email, lang: row.lang }, fetchImpl);
  } catch (e) { r = { ok: false, error: String(e?.message || e).slice(0, 200) }; }
  const patch = r.ok ? { synced_at: new Date().toISOString(), sync_error: null, ...(r.id ? { external_id: r.id } : {}) } : { sync_error: String(r.error || "failed").slice(0, 200) };
  try {
    const { error } = await sb.from("subscribers").update(patch).eq("id", row.id);
    if (error) console.error("subscribers sync update failed", error);
  } catch (e) { console.error("subscribers sync update failed", e); }
  return r;
}

// Nightly reconcile: every confirmed row whose last change has not reached
// Resend (synced_at null; the handlers clear it on every change).
export async function audienceStep(sb, env, { fetch: fetchImpl = null, limit = PAGE } = {}) {
  const out = { pushed: 0, unsubscribed: 0, failed: 0, skipped: null };
  if (!syncEnabled(env)) { out.skipped = "no_key"; return out; }
  if (!fetchImpl) { out.skipped = "no_fetch"; return out; }
  const { data, error } = await sb.from("subscribers").select("id, email, lang, confirmed_at, unsubscribed_at")
    .not("confirmed_at", "is", null).is("synced_at", null).order("id", { ascending: true }).limit(limit);
  if (error) throw new Error(`subscribers select: ${error.message || error}`);
  for (const row of data || []) {
    const r = await syncSubscriber(sb, env, row, fetchImpl);
    if (!r.ok) out.failed++; else if (row.unsubscribed_at) out.unsubscribed++; else out.pushed++;
  }
  return out;
}
