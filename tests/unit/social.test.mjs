import { test } from "node:test";
import assert from "node:assert/strict";
import { PLATFORMS, PLATFORM_KEYS, channels, configured, composeText, postUrl, linkFacet, oauth1Header, publishOne, queueShares, flushSocial, socialStep } from "../../lib/social.js";
import { makeHandler } from "../../lib/handlers/triage/social.js";
import { STEP_NAMES, STEP_GROUPS } from "../../lib/handlers/cron.js";
import { HttpError } from "../../lib/auth.js";

function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: null };
  res.status = (s) => { res.statusCode = s; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; return res; };
  res.end = (b) => { try { res.body = JSON.parse(b); } catch { res.body = b; } };
  return res;
}
const authAs = (role) => async (req, roles) => { if (roles && !roles.includes(role)) throw new HttpError(403, "forbidden"); return { user: { id: "u-" + role }, staff: { user_id: "u-" + role, name: "Tester", role, email: role + "@gvf.test" } }; };
const ENV = { SITE_URL: "https://gurugramvisionforum.org", SUPABASE_URL: "https://xyz.supabase.co", META_PAGE_ID: "123", META_PAGE_TOKEN: "ptok", META_IG_USER_ID: "456", TELEGRAM_BOT_TOKEN: "bot1:abc", TELEGRAM_CHAT_ID: "@gvfchannel", BLUESKY_HANDLE: "gvf.bsky.social", BLUESKY_APP_PASSWORD: "app-pass", X_API_KEY: "ck", X_API_SECRET: "cs", X_ACCESS_TOKEN: "tok", X_ACCESS_SECRET: "ts" };
const POST = { id: "11111111-1111-4111-8111-111111111111", kind: "story", slug: "sewa-drive-sector-45", title: "Sewa drive cleans Sector 45 park", summary: "Forty volunteers, two tonnes of waste cleared with MCG's truck. Next drive 20 October.", tags: ["sewa", "sector 45", "hold"], published: true, media_path: "posts/a.jpg", media_type: "image/jpeg" };

// A Supabase fake for social_posts and posts: reads answer from `rows`, writes are recorded.
function fakeSb({ shares = [], posts = [POST] } = {}) {
  const calls = [];
  function chain(table) {
    const q = { table, op: "select", filters: [], lt: null };
    const c = { select: () => c, order: () => c, limit: () => c, maybeSingle: () => c,
      eq: (k, v) => { q.filters.push([k, v]); return c; }, lt: (k, v) => { q.lt = [k, v]; return c; },
      upsert: (row, opts) => { q.op = "upsert"; q.row = row; q.opts = opts; calls.push(q); return c; },
      update: (row) => { q.op = "update"; q.row = row; calls.push(q); return c; },
      then: (ok) => {
        if (q.op !== "select") {
          if (q.op === "upsert") { const i = shares.findIndex((r) => r.post_id === q.row.post_id && r.platform === q.row.platform); const row = { id: i >= 0 ? shares[i].id : shares.length + 1, attempts: 0, ...(i >= 0 ? shares[i] : {}), ...q.row }; if (i >= 0) shares[i] = row; else shares.push(row); }
          if (q.op === "update") { const id = q.filters.find((f) => f[0] === "id"); const r = shares.find((x) => x.id === (id && id[1])); if (r) Object.assign(r, q.row); }
          return ok({ data: null, error: null });
        }
        if (table === "posts") { const id = q.filters.find((f) => f[0] === "id"); return ok({ data: posts.find((p) => p.id === (id && id[1])) || null, error: null }); }
        let list = shares.filter((r) => q.filters.every(([k, v]) => r[k] === v) && (!q.lt || r[q.lt[0]] < q.lt[1]));
        return ok({ data: list, error: null });
      } };
    return c;
  }
  return { calls, shares, from: chain };
}

test("channels: every platform listed with whether it is connected and what it needs", () => {
  assert.deepEqual(PLATFORM_KEYS, ["facebook", "instagram", "telegram", "bluesky", "x"]);
  const none = channels({});
  assert.equal(none.length, 5);
  assert.ok(none.every((c) => !c.configured));
  assert.deepEqual(none[1].needs, ["META_IG_USER_ID", "META_PAGE_TOKEN"]);
  assert.equal(none[1].image, "required");
  assert.ok(channels(ENV).every((c) => c.configured));
  assert.equal(configured("facebook", { META_PAGE_ID: "1" }), false, "a half-set platform is not connected");
  assert.equal(PLATFORMS.x.max, 280);
});

test("composeText: title, summary, link and hashtags, clipped per platform; the hold tag never leaks", () => {
  assert.equal(postUrl(POST, ENV), "https://gurugramvisionforum.org/blog/sewa-drive-sector-45");
  assert.equal(postUrl({ kind: "photo" }, ENV), "https://gurugramvisionforum.org/updates");
  const fb = composeText(POST, "facebook", ENV);
  assert.ok(fb.text.startsWith("Sewa drive cleans Sector 45 park\n\nForty volunteers"));
  assert.ok(fb.text.includes("https://gurugramvisionforum.org/blog/sewa-drive-sector-45"));
  assert.ok(fb.text.includes("#sewa #sector45") && !fb.text.includes("#hold"));
  const ig = composeText(POST, "instagram", ENV);
  assert.ok(ig.text.includes("More: https://gurugramvisionforum.org/blog/"));
  const x = composeText({ ...POST, summary: "x".repeat(400) }, "x", ENV);
  assert.ok(x.text.length - x.url.length + 23 <= 280, "X text fits 280 with the link counted as 23");
  const b = composeText({ ...POST, summary: "y".repeat(400) }, "bluesky", ENV);
  assert.ok(b.text.length <= 300, "Bluesky text fits 300");
  const f = linkFacet("नमस्ते " + fb.url, fb.url);
  assert.equal(f.index.byteStart, Buffer.byteLength("नमस्ते ", "utf8"), "facet offsets count UTF-8 bytes");
  assert.equal(f.features[0].uri, fb.url);
  assert.equal(linkFacet("no link here", fb.url), null);
});

test("oauth1Header: deterministic HMAC-SHA1 signature for X with a fixed nonce and timestamp", () => {
  const h = oauth1Header("POST", "https://api.x.com/2/tweets", ENV, { nonce: "abc123", timestamp: 1700000000 });
  assert.ok(h.startsWith("OAuth "));
  assert.ok(h.includes('oauth_consumer_key="ck"') && h.includes('oauth_token="tok"') && h.includes('oauth_nonce="abc123"') && h.includes('oauth_timestamp="1700000000"'));
  const sig = /oauth_signature="([^"]+)"/.exec(h)[1];
  assert.equal(sig, oauth1Header("POST", "https://api.x.com/2/tweets", ENV, { nonce: "abc123", timestamp: 1700000000 }).match(/oauth_signature="([^"]+)"/)[1]);
  assert.notEqual(sig, oauth1Header("POST", "https://api.x.com/2/tweets", { ...ENV, X_ACCESS_SECRET: "other" }, { nonce: "abc123", timestamp: 1700000000 }).match(/oauth_signature="([^"]+)"/)[1]);
});

test("publishOne: each platform's calls and results with a fake fetch", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", body: init.body, headers: init.headers || {} });
    const ok = (j) => ({ ok: true, status: 200, json: async () => j, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
    if (url.includes("/123/photos")) return ok({ id: "ph1", post_id: "123_777" });
    if (url.includes("/123/feed")) return ok({ id: "123_778" });
    if (url.includes("/456/media_publish")) return ok({ id: "ig9" });
    if (url.includes("/456/media")) return ok({ id: "cont1" });
    if (url.includes("/cont1?fields=status_code")) return ok({ status_code: "FINISHED" });
    if (url.includes("/ig9?fields=permalink")) return ok({ permalink: "https://www.instagram.com/p/abc/" });
    if (url.includes("api.telegram.org")) return ok({ ok: true, result: { message_id: 55 } });
    if (url.includes("createSession")) return ok({ accessJwt: "jwt", did: "did:plc:xyz" });
    if (url.includes("uploadBlob")) return ok({ blob: { $type: "blob", ref: { $link: "bafy" }, mimeType: "image/jpeg", size: 3 } });
    if (url.includes("createRecord")) return ok({ uri: "at://did:plc:xyz/app.bsky.feed.post/3k2abc", cid: "c" });
    if (url.includes("api.x.com")) return ok({ data: { id: "1700", text: "x" } });
    if (url.startsWith("https://xyz.supabase.co/")) return ok({});
    return { ok: false, status: 404, json: async () => ({ error: { message: "nope" } }) };
  };
  const sleep = async () => {};
  const fb = await publishOne("facebook", POST, ENV, fetchImpl, sleep);
  assert.equal(fb.id, "123_777"); assert.equal(fb.url, "https://www.facebook.com/123_777");
  assert.ok(calls[0].url.endsWith("/123/photos") && String(calls[0].body).includes("access_token=ptok") && String(calls[0].body).includes("url=https%3A%2F%2Fxyz.supabase.co"), "a post with a photo goes to /photos with the image URL");
  calls.length = 0;
  const fb2 = await publishOne("facebook", { ...POST, media_path: null, media_type: null }, ENV, fetchImpl, sleep);
  assert.equal(fb2.id, "123_778"); assert.ok(calls[0].url.endsWith("/123/feed") && String(calls[0].body).includes("link=https%3A%2F%2Fgurugramvisionforum.org%2Fblog%2F"), "a post without a photo goes to /feed with the link");
  calls.length = 0;
  const ig = await publishOne("instagram", POST, ENV, fetchImpl, sleep);
  assert.equal(ig.id, "ig9"); assert.equal(ig.url, "https://www.instagram.com/p/abc/");
  assert.deepEqual(calls.map((c) => c.url.replace(/\?.*/, "").split("/").slice(-1)[0]), ["media", "cont1", "media_publish", "ig9"], "container, status poll, publish, permalink");
  await assert.rejects(publishOne("instagram", { ...POST, media_path: null, media_type: null }, ENV, fetchImpl, sleep), (e) => e.skip === "needs_image");
  calls.length = 0;
  const tg = await publishOne("telegram", POST, ENV, fetchImpl, sleep);
  assert.equal(tg.url, "https://t.me/gvfchannel/55"); assert.ok(calls[0].url.endsWith("/sendPhoto") && JSON.parse(calls[0].body).chat_id === "@gvfchannel");
  calls.length = 0;
  const bs = await publishOne("bluesky", POST, ENV, fetchImpl, sleep);
  assert.equal(bs.url, "https://bsky.app/profile/gvf.bsky.social/post/3k2abc");
  const rec = JSON.parse(calls.find((c) => c.url.includes("createRecord")).body).record;
  assert.equal(rec.embed.$type, "app.bsky.embed.images"); assert.equal(rec.facets.length, 1); assert.ok(rec.text.length <= 300);
  calls.length = 0;
  const x = await publishOne("x", POST, ENV, fetchImpl, sleep);
  assert.equal(x.url, "https://x.com/i/web/status/1700");
  assert.ok(String(calls[0].headers.Authorization).startsWith("OAuth ") && JSON.parse(calls[0].body).text.includes("Sewa drive"));
  await assert.rejects(publishOne("x", POST, {}, fetchImpl, sleep), (e) => e.skip === "not_configured");
  await assert.rejects(publishOne("facebook", POST, ENV, async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "Invalid OAuth access token" } }) }), sleep), /facebook: Invalid OAuth access token/);
});

test("queueShares and flushSocial: queued rows are sent, skipped or failed and recorded", async () => {
  const sb = fakeSb({ shares: [{ id: 1, post_id: POST.id, platform: "facebook", status: "sent", attempts: 1 }] });
  const q = await queueShares(sb, POST.id, ["facebook", "telegram", "instagram", "nope"], "Tester");
  assert.deepEqual(q, [{ platform: "facebook", status: "sent", already: true }, { platform: "telegram", status: "queued" }, { platform: "instagram", status: "queued" }]);
  assert.equal(sb.shares.length, 3);
  const fetchImpl = async (url) => url.includes("telegram") ? { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 7 } }) } : { ok: false, status: 500, json: async () => ({ error: { message: "down" } }) };
  const noImage = { ...POST, media_path: null, media_type: null };
  const r = await flushSocial(sb, ENV, { fetch: fetchImpl, postId: POST.id, sleep: async () => {} });
  assert.equal(r.sent, 1); assert.equal(r.failed, 1); assert.equal(r.skipped, 0);
  const tg = sb.shares.find((x) => x.platform === "telegram"); assert.equal(tg.status, "sent"); assert.equal(tg.external_url, "https://t.me/gvfchannel/7");
  // Instagram with the stored image fails on the API (500): stays queued for the cron's retry, with the message
  const ig = sb.shares.find((x) => x.platform === "instagram");
  assert.equal(ig.status, "queued"); assert.equal(ig.attempts, 1); assert.ok(/down/.test(ig.last_error));
  // Instagram without a photo is skipped for good
  const sbNo = fakeSb({ shares: [{ id: 1, post_id: POST.id, platform: "instagram", status: "queued", attempts: 0 }], posts: [noImage] });
  const rNo = await flushSocial(sbNo, ENV, { fetch: fetchImpl, sleep: async () => {} });
  assert.equal(rNo.skipped, 1); assert.equal(sbNo.shares[0].status, "skipped"); assert.ok(/needs a photo/.test(sbNo.shares[0].last_error));
  const sb2 = fakeSb({ shares: [{ id: 1, post_id: POST.id, platform: "facebook", status: "queued", attempts: 2 }] });
  const r2 = await flushSocial(sb2, ENV, { fetch: fetchImpl, sleep: async () => {} });
  assert.equal(r2.failed, 1); assert.equal(sb2.shares[0].status, "failed", "the third failed attempt marks the row failed"); assert.ok(/down/.test(sb2.shares[0].last_error));
  const sb3 = fakeSb({ shares: [{ id: 1, post_id: POST.id, platform: "telegram", status: "queued", attempts: 0 }], posts: [{ ...noImage, published: false }] });
  const r3 = await flushSocial(sb3, ENV, { fetch: fetchImpl, sleep: async () => {} });
  assert.equal(r3.skipped, 1); assert.equal(sb3.shares[0].status, "skipped"); assert.ok(/not published/.test(sb3.shares[0].last_error));
  assert.deepEqual(await socialStep(fakeSb(), {}, { fetch: fetchImpl }), { sent: 0, failed: 0, skipped: 0, skipped_reason: "no_accounts" });
  assert.ok(STEP_NAMES.includes("social") && STEP_GROUPS.analyse.includes("social"), "the cron runs the social step in the analyse group");
});

test("social handler: content roles, GET lists channels and shares, POST queues and sends", async () => {
  const denied = fakeRes();
  await makeHandler({ auth: authAs("triage"), sb: fakeSb(), env: ENV })({ method: "GET", query: {} }, denied);
  assert.equal(denied.statusCode, 403);
  const sb = fakeSb();
  const get = fakeRes();
  await makeHandler({ auth: authAs("content"), sb, env: {} })({ method: "GET", query: {} }, get);
  assert.equal(get.statusCode, 200); assert.equal(get.body.channels.length, 5); assert.ok(get.body.channels.every((c) => !c.configured)); assert.deepEqual(get.body.shares, []);
  const bad = fakeRes();
  await makeHandler({ auth: authAs("owner"), sb, env: ENV })({ method: "POST", query: {}, body: { post_id: "x", platforms: [] } }, bad);
  assert.equal(bad.statusCode, 400);
  const nc = fakeRes();
  await makeHandler({ auth: authAs("owner"), sb, env: { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "@c" } })({ method: "POST", query: {}, body: { post_id: POST.id, platforms: ["facebook"] } }, nc);
  assert.equal(nc.statusCode, 409); assert.equal(nc.body.error, "not_connected"); assert.deepEqual(nc.body.platforms, ["facebook"]);
  const unpub = fakeRes();
  await makeHandler({ auth: authAs("owner"), sb: fakeSb({ posts: [{ ...POST, published: false }] }), env: ENV })({ method: "POST", query: {}, body: { post_id: POST.id, platforms: ["telegram"] } }, unpub);
  assert.equal(unpub.statusCode, 409); assert.equal(unpub.body.error, "not_published");
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 9 } }) });
  const ok = fakeRes();
  await makeHandler({ auth: authAs("coordinator"), sb, env: ENV, fetchImpl, sleep: async () => {} })({ method: "POST", query: {}, body: { post_id: POST.id, platforms: ["telegram"] } }, ok);
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body)); assert.equal(ok.body.sent, 1); assert.equal(ok.body.results[0].url, "https://t.me/gvfchannel/9");
  assert.equal(sb.shares[0].created_by, "Tester <coordinator@gvf.test>");
});
