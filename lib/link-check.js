// Link checker: gathers every external URL the site publishes from
// site/data.js and checks each with HEAD, falling back to GET. Used by the
// daily cron (40 URLs per run, oldest first) and by scripts/check-links.mjs.
import { readFile } from "node:fs/promises";
import vm from "node:vm";

export const USER_AGENT = "GurugramVisionForumBot/1.0 (+https://gurugramvisionforum.org)";
const DATA_URL = new URL("../site/data.js", import.meta.url);

const isHttp = (u) => typeof u === "string" && /^https?:\/\//i.test(u.trim());

// Loads site/data.js in a bare vm context and returns window.GVF.
export async function loadData(url = DATA_URL) {
  const src = await readFile(url, "utf8");
  const window = {};
  const ctx = vm.createContext({ window, console: { log() {}, warn() {}, error() {} } });
  vm.runInContext(src, ctx, { filename: "data.js" });
  if (!window.GVF) throw new Error("site/data.js did not set window.GVF");
  return window.GVF;
}

// Every http(s) URL in the content, with a label saying where it is used.
// The same URL used in several places keeps the first label plus a count.
export function collectFrom(G) {
  const seen = new Map();
  const add = (u, where) => {
    if (!isHttp(u)) return;
    const url = u.trim();
    const cur = seen.get(url);
    if (cur) { cur.uses++; return; }
    seen.set(url, { url, where_used: where, uses: 1 });
  };
  for (const [k, v] of Object.entries(G.L || {})) add(v, `L.${k}`);
  for (const c of G.CATS || []) for (const ch of c.channels || []) add(ch.href, `CATS.${c.id}.channels.${ch.k || ""}`);
  for (const p of G.PORTALS || []) add(p.h, `PORTALS.${p.n || ""}`);
  for (const c of G.CHARTERS || []) for (const s of c.src || []) add(Array.isArray(s) ? s[1] : s?.h, `CHARTERS.${c.id}.src.${Array.isArray(s) ? s[0] : ""}`);
  const roles = Array.isArray(G.ROLES) ? G.ROLES.map((r, i) => [r.id || i, r]) : Object.entries(G.ROLES || {});
  for (const [id, r] of roles) for (const l of r?.links || []) add(Array.isArray(l) ? l[1] : l?.h, `ROLES.${id}.links.${Array.isArray(l) ? l[0] : ""}`);
  for (const c of G.CIVIC || []) for (const e of c.ent || []) add(e.h, `CIVIC.${c.id}.ent.${e.l || ""}`);
  return [...seen.values()].map(({ url, where_used, uses }) => ({ url, where_used: uses > 1 ? `${where_used} (+${uses - 1})` : where_used }));
}

export async function collectLinks(url = DATA_URL) {
  return collectFrom(await loadData(url));
}

async function request(url, method, fetchImpl, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { method, redirect: "follow", headers: { "User-Agent": USER_AGENT, Accept: "*/*" }, signal: ctrl.signal });
    // Drain a GET body cheaply so the socket is released; a missing body is fine.
    if (method === "GET" && r.body && typeof r.body.cancel === "function") { try { await r.body.cancel(); } catch { /* ignore */ } }
    return { status: Number(r.status) || 0, error: null };
  } catch (e) {
    return { status: 0, error: e?.name === "AbortError" ? "timeout" : String(e?.message || e).slice(0, 200) };
  } finally { clearTimeout(timer); }
}

// One URL: HEAD, then GET when HEAD is refused or fails. 200..399 is ok.
// A server that answers 401/403/405/429 is up but limits bots (government
// WAFs do this to any non-browser client); that counts as reachable, with
// error "bot_limited" kept for the record. No answer at all (status 0:
// timeout, refused, TLS) is retried once with a longer timeout, since the
// slower government hosts answer late rather than never.
export const BOT_LIMITED = new Set([401, 403, 405, 429]);
export async function checkLink(url, fetchImpl = fetch, { timeoutMs = 8000 } = {}) {
  let r = await request(url, "HEAD", fetchImpl, timeoutMs);
  const okStatus = (s) => s >= 200 && s < 400;
  if (!okStatus(r.status)) {
    // Keep the GET verdict; it is what a browser would see.
    r = await request(url, "GET", fetchImpl, timeoutMs);
    if (r.status === 0) r = await request(url, "GET", fetchImpl, timeoutMs * 2);
  }
  const limited = BOT_LIMITED.has(r.status);
  return { url, status: r.status, ok: okStatus(r.status) || limited, error: limited ? "bot_limited" : r.error, checked_at: new Date().toISOString() };
}

// Many URLs with bounded concurrency → [{ url, status, ok, error, checked_at, where_used }].
export async function checkLinks(links, fetchImpl = fetch, { concurrency = 5, timeoutMs = 8000 } = {}) {
  const list = (links || []).map((l) => (typeof l === "string" ? { url: l, where_used: null } : l));
  const out = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      const r = await checkLink(list[i].url, fetchImpl, { timeoutMs });
      out[i] = { ...r, where_used: list[i].where_used || null };
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, list.length || 1)) }, worker));
  return out;
}

// A link counts as broken only after it fails this many nightly checks in a
// row: government sites often miss one night (owner's decision, 9 Oct 2026).
// link_status.fails holds the consecutive failures; a good check resets it.
export const BROKEN_AFTER = 2;
export const isBroken = (row) => !!row && row.ok === false && (Number(row.fails) || 0) >= BROKEN_AFTER;

// Writes results into link_status (upsert on url). prevFails maps a URL to
// its stored consecutive failures.
export async function storeLinkStatus(sb, results, prevFails = new Map()) {
  if (!results?.length) return;
  const rows = results.map((r) => ({ url: r.url, status: r.status, ok: r.ok, fails: r.ok ? 0 : (Number(prevFails.get(r.url)) || 0) + 1, checked_at: r.checked_at, error: r.error, where_used: r.where_used }));
  const { error } = await sb.from("link_status").upsert(rows, { onConflict: "url" });
  if (error) throw new Error(`link_status upsert: ${error.message || error}`);
}
