// Social publishing (owner's ask, 8 Oct 2026): a published post goes out to the
// Forum's own accounts from the desk, through each platform's free API and
// nothing in between. See docs/social-publishing-research.md for why these
// five and how each account is connected.
//   facebook  Page post or photo through the Graph API (free; Page token)
//   instagram Image post through the Graph API (free; needs a photo)
//   telegram  Channel message or photo through the Bot API (free)
//   bluesky   Post with a link card or an image through the AT Protocol (free)
//   x         Text post with the link through API v2 (pay-per-use credits)
// Every attempt is a row in social_posts (queued → sent | failed | skipped).
// Tokens come from the environment only; the browser never sees them.
import { createHmac, randomBytes } from "node:crypto";
import { siteUrl } from "./indexnow.js";
import { mediaUrl } from "./content.js";

const GRAPH = "https://graph.facebook.com/v21.0";
const TELEGRAM = "https://api.telegram.org";
const BSKY = "https://bsky.social/xrpc";
const X_POST = "https://api.x.com/2/tweets";
const BSKY_IMAGE_MAX = 1000000; // Bluesky refuses blobs over ~1 MB

export const PLATFORMS = {
  facebook: { label: "Facebook Page", needs: ["META_PAGE_ID", "META_PAGE_TOKEN"], image: "optional", max: 63206 },
  instagram: { label: "Instagram", needs: ["META_IG_USER_ID", "META_PAGE_TOKEN"], image: "required", max: 2200 },
  telegram: { label: "Telegram channel", needs: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"], image: "optional", max: 1024 },
  bluesky: { label: "Bluesky", needs: ["BLUESKY_HANDLE", "BLUESKY_APP_PASSWORD"], image: "optional", max: 300 },
  x: { label: "X (Twitter)", needs: ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"], image: "none", max: 280 }
};
export const PLATFORM_KEYS = Object.keys(PLATFORMS);

export function configured(platform, env = process.env) {
  const p = PLATFORMS[platform];
  return !!p && p.needs.every((k) => String(env[k] || "").trim());
}
// What the desk shows: every platform with whether it is connected and what it needs.
export function channels(env = process.env) {
  return PLATFORM_KEYS.map((k) => ({ platform: k, label: PLATFORMS[k].label, configured: configured(k, env), image: PLATFORMS[k].image, needs: PLATFORMS[k].needs }));
}

export function postUrl(post, env = process.env) {
  const site = siteUrl(env);
  return post.slug && (post.kind === "story" || post.kind === "news") ? `${site}/blog/${post.slug}` : `${site}/updates`;
}
export function imageUrl(post, env = process.env) {
  if (!post.media_path || !/^image\//.test(post.media_type || "")) return null;
  return post.media_url || (env.SUPABASE_URL ? mediaUrl(env.SUPABASE_URL, post.media_path) : null);
}
const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, Math.max(0, n - 1)).replace(/\s+\S*$/, "") + "…" : s; };
const hashtags = (post) => (post.tags || []).filter((t) => t && t !== "hold").slice(0, 4).map((t) => "#" + String(t).replace(/[^\wऀ-ॿ]+/g, "")).filter((t) => t.length > 1).join(" ");

// The words that go out: title, a clipped summary, the link (and hashtags where
// they help). X counts a link as 23 characters; Bluesky counts 300 graphemes.
export function composeText(post, platform, env = process.env) {
  const url = postUrl(post, env);
  const title = String(post.title || "").trim();
  const tags = hashtags(post);
  const limit = PLATFORMS[platform]?.max || 2000;
  const linkCost = platform === "x" ? 23 : url.length;
  let room = limit - title.length - linkCost - 4 - (tags ? tags.length + 2 : 0);
  if (room < 40) room = 0;
  const summary = room ? clip(post.summary || "", Math.min(room, 600)) : "";
  const parts = [title];
  if (summary) parts.push(summary);
  if (platform !== "instagram") parts.push(url); else parts.push(`More: ${url}`);
  if (tags) parts.push(tags);
  let text = parts.join("\n\n");
  if (platform === "x" && text.length - url.length + 23 > 280) text = [title, url].join("\n\n");
  return { text, url };
}

async function readJson(r) { try { return await r.json(); } catch { return null; } }
function fail(platform, r, j) {
  const msg = j?.error?.message || j?.description || j?.message || j?.detail || j?.title || (typeof j === "string" ? j : "") || `HTTP ${r.status}`;
  const e = new Error(`${platform}: ${String(msg).slice(0, 300)}`); e.status = r.status; return e;
}

async function publishFacebook(post, env, fetchImpl) {
  const { text, url } = composeText(post, "facebook", env);
  const img = imageUrl(post, env);
  const page = env.META_PAGE_ID;
  const body = new URLSearchParams(img ? { url: img, message: text } : { message: text, link: url });
  body.set("access_token", env.META_PAGE_TOKEN);
  const r = await fetchImpl(`${GRAPH}/${encodeURIComponent(page)}/${img ? "photos" : "feed"}`, { method: "POST", body });
  const j = await readJson(r);
  if (!r.ok || !j || !(j.post_id || j.id)) throw fail("facebook", r, j);
  const id = j.post_id || j.id;
  return { id, url: `https://www.facebook.com/${id}` };
}

async function publishInstagram(post, env, fetchImpl, sleep) {
  const img = imageUrl(post, env);
  if (!img) { const e = new Error("instagram: needs a photo"); e.skip = "needs_image"; throw e; }
  const { text } = composeText(post, "instagram", env);
  const ig = encodeURIComponent(env.META_IG_USER_ID);
  const token = env.META_PAGE_TOKEN;
  let r = await fetchImpl(`${GRAPH}/${ig}/media`, { method: "POST", body: new URLSearchParams({ image_url: img, caption: text, access_token: token }) });
  let j = await readJson(r);
  if (!r.ok || !j?.id) throw fail("instagram", r, j);
  const creation = j.id;
  for (let i = 0; i < 8; i++) {
    r = await fetchImpl(`${GRAPH}/${encodeURIComponent(creation)}?fields=status_code&access_token=${encodeURIComponent(token)}`);
    j = await readJson(r);
    if (j?.status_code === "FINISHED") break;
    if (j?.status_code === "ERROR" || j?.status_code === "EXPIRED") throw new Error(`instagram: container ${j.status_code}`);
    await sleep(1500);
  }
  r = await fetchImpl(`${GRAPH}/${ig}/media_publish`, { method: "POST", body: new URLSearchParams({ creation_id: creation, access_token: token }) });
  j = await readJson(r);
  if (!r.ok || !j?.id) throw fail("instagram", r, j);
  const id = j.id;
  let url = null;
  try { const p = await readJson(await fetchImpl(`${GRAPH}/${encodeURIComponent(id)}?fields=permalink&access_token=${encodeURIComponent(token)}`)); url = p?.permalink || null; } catch { /* permalink is cosmetic */ }
  return { id, url };
}

async function publishTelegram(post, env, fetchImpl) {
  const { text } = composeText(post, "telegram", env);
  const img = imageUrl(post, env);
  const chat = env.TELEGRAM_CHAT_ID;
  const body = img ? { chat_id: chat, photo: img, caption: clip(text, 1024) } : { chat_id: chat, text, link_preview_options: { prefer_large_media: true } };
  const r = await fetchImpl(`${TELEGRAM}/bot${env.TELEGRAM_BOT_TOKEN}/${img ? "sendPhoto" : "sendMessage"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await readJson(r);
  if (!r.ok || !j?.ok || !j.result?.message_id) throw fail("telegram", r, j);
  const id = String(j.result.message_id);
  const handle = String(chat).replace(/^@/, "");
  return { id, url: /^[A-Za-z0-9_]+$/.test(handle) ? `https://t.me/${handle}/${id}` : null };
}

// Byte offsets for a Bluesky link facet (the protocol counts UTF-8 bytes).
export function linkFacet(text, url) {
  const at = text.indexOf(url);
  if (at < 0) return null;
  const start = Buffer.byteLength(text.slice(0, at), "utf8");
  return { index: { byteStart: start, byteEnd: start + Buffer.byteLength(url, "utf8") }, features: [{ $type: "app.bsky.richtext.facet#link", uri: url }] };
}
async function publishBluesky(post, env, fetchImpl) {
  const { text, url } = composeText(post, "bluesky", env);
  let r = await fetchImpl(`${BSKY}/com.atproto.server.createSession`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: env.BLUESKY_HANDLE, password: env.BLUESKY_APP_PASSWORD }) });
  let j = await readJson(r);
  if (!r.ok || !j?.accessJwt) throw fail("bluesky", r, j);
  const { accessJwt, did } = j;
  const auth = { Authorization: `Bearer ${accessJwt}` };
  const record = { $type: "app.bsky.feed.post", text, createdAt: new Date().toISOString() };
  const facet = linkFacet(text, url);
  if (facet) record.facets = [facet];
  const img = imageUrl(post, env);
  let embedded = false;
  if (img) {
    try {
      const ir = await fetchImpl(img);
      const bytes = ir.ok ? Buffer.from(await ir.arrayBuffer()) : null;
      if (bytes && bytes.length && bytes.length <= BSKY_IMAGE_MAX) {
        const ur = await fetchImpl(`${BSKY}/com.atproto.repo.uploadBlob`, { method: "POST", headers: { ...auth, "Content-Type": post.media_type || "image/jpeg" }, body: bytes });
        const uj = await readJson(ur);
        if (ur.ok && uj?.blob) { record.embed = { $type: "app.bsky.embed.images", images: [{ alt: String(post.title || ""), image: uj.blob }] }; embedded = true; }
      }
    } catch (e) { console.error("bluesky image skipped", e?.message || e); }
  }
  if (!embedded) record.embed = { $type: "app.bsky.embed.external", external: { uri: url, title: String(post.title || "").slice(0, 200), description: clip(post.summary || "", 300) } };
  r = await fetchImpl(`${BSKY}/com.atproto.repo.createRecord`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ repo: did, collection: "app.bsky.feed.post", record }) });
  j = await readJson(r);
  if (!r.ok || !j?.uri) throw fail("bluesky", r, j);
  const rkey = String(j.uri).split("/").pop();
  return { id: j.uri, url: `https://bsky.app/profile/${env.BLUESKY_HANDLE}/post/${rkey}` };
}

// OAuth 1.0a user-context header for X API v2 (HMAC-SHA1). nonce and timestamp are injectable for tests.
const rfc3986 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
export function oauth1Header(method, url, env, { nonce, timestamp } = {}) {
  const p = {
    oauth_consumer_key: env.X_API_KEY, oauth_nonce: nonce || randomBytes(16).toString("hex"), oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp || Math.floor(Date.now() / 1000)), oauth_token: env.X_ACCESS_TOKEN, oauth_version: "1.0"
  };
  const params = Object.keys(p).sort().map((k) => `${rfc3986(k)}=${rfc3986(p[k])}`).join("&");
  const base = `${method.toUpperCase()}&${rfc3986(url)}&${rfc3986(params)}`;
  const key = `${rfc3986(env.X_API_SECRET)}&${rfc3986(env.X_ACCESS_SECRET)}`;
  p.oauth_signature = createHmac("sha1", key).update(base).digest("base64");
  return "OAuth " + Object.keys(p).sort().map((k) => `${rfc3986(k)}="${rfc3986(p[k])}"`).join(", ");
}
async function publishX(post, env, fetchImpl) {
  const { text } = composeText(post, "x", env);
  const r = await fetchImpl(X_POST, { method: "POST", headers: { Authorization: oauth1Header("POST", X_POST, env), "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  const j = await readJson(r);
  if (!r.ok || !j?.data?.id) throw fail("x", r, j);
  return { id: j.data.id, url: `https://x.com/i/web/status/${j.data.id}` };
}

const PUBLISHERS = { facebook: publishFacebook, instagram: publishInstagram, telegram: publishTelegram, bluesky: publishBluesky, x: publishX };

export async function publishOne(platform, post, env = process.env, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const fn = PUBLISHERS[platform];
  if (!fn) throw new Error(`unknown platform ${platform}`);
  if (!configured(platform, env)) { const e = new Error(`${platform}: not connected`); e.skip = "not_configured"; throw e; }
  return fn(post, env, fetchImpl, sleep);
}

// Queue (or re-queue) a share per platform. Rows already sent stay sent.
export async function queueShares(sb, postId, platforms, actor = null) {
  const list = (platforms || []).filter((p) => PLATFORM_KEYS.includes(p));
  if (!list.length) return [];
  const { data: existing, error } = await sb.from("social_posts").select("id, platform, status").eq("post_id", postId);
  if (error) throw error;
  const have = new Map((existing || []).map((r) => [r.platform, r]));
  const out = [];
  for (const platform of list) {
    const cur = have.get(platform);
    if (cur && cur.status === "sent") { out.push({ platform, status: "sent", already: true }); continue; }
    const { error: ue } = await sb.from("social_posts").upsert({ post_id: postId, platform, status: "queued", last_error: null, created_by: actor }, { onConflict: "post_id,platform" });
    if (ue) throw ue;
    out.push({ platform, status: "queued" });
  }
  return out;
}

// Send every queued row (or those of one post). A post that is no longer
// published is skipped; Instagram without a photo is skipped; any API error
// marks the row failed with the message and the cron retries up to 3 times.
export async function flushSocial(sb, env = process.env, { fetch: fetchImpl = globalThis.fetch, postId = null, limit = 20, sleep } = {}) {
  const out = { sent: 0, failed: 0, skipped: 0, results: [] };
  let q = sb.from("social_posts").select("id, post_id, platform, attempts").eq("status", "queued").lt("attempts", 3).order("created_at", { ascending: true }).limit(limit);
  if (postId) q = q.eq("post_id", postId);
  const { data: rows, error } = await q;
  if (error) throw error;
  for (const row of rows || []) {
    const { data: post, error: pe } = await sb.from("posts").select("*").eq("id", row.post_id).maybeSingle();
    if (pe) throw pe;
    const patch = { attempts: (row.attempts || 0) + 1 };
    let res = { platform: row.platform };
    try {
      if (!post || !post.published) { const e = new Error("post is not published"); e.skip = "not_published"; throw e; }
      const r = await publishOne(row.platform, post, env, fetchImpl, sleep);
      Object.assign(patch, { status: "sent", external_id: r.id, external_url: r.url || null, sent_at: new Date().toISOString(), last_error: null });
      out.sent++; res = { ...res, status: "sent", url: r.url || null };
    } catch (e) {
      const msg = String(e?.message || e).slice(0, 300);
      if (e?.skip) { Object.assign(patch, { status: "skipped", last_error: msg }); out.skipped++; res = { ...res, status: "skipped", error: msg }; }
      else { Object.assign(patch, { status: patch.attempts >= 3 ? "failed" : "queued", last_error: msg }); out.failed++; res = { ...res, status: "failed", error: msg }; }
    }
    const { error: ue } = await sb.from("social_posts").update(patch).eq("id", row.id);
    if (ue) console.error("social_posts update failed", ue);
    out.results.push(res);
  }
  return out;
}

export async function socialStep(sb, env, { fetch: fetchImpl = null } = {}) {
  const out = { sent: 0, failed: 0, skipped: 0, skipped_reason: null };
  if (!PLATFORM_KEYS.some((k) => configured(k, env))) { out.skipped_reason = "no_accounts"; return out; }
  if (!fetchImpl) { out.skipped_reason = "no_fetch"; return out; }
  const r = await flushSocial(sb, env, { fetch: fetchImpl, limit: 20 });
  out.sent = r.sent; out.failed = r.failed; out.skipped = r.skipped;
  return out;
}
