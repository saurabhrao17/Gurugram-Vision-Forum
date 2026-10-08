// The newsletter run from the desk: rendering, channel choice, the Resend
// Broadcast call, the outbox path and the desk endpoint's roles.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCampaign, textToHtml, renderMail, renderBroadcast, channelFor, sendBroadcast, outboxRows, flushCampaign } from "../../lib/newsletter.js";
import { makeHandler } from "../../lib/handlers/triage/newsletter.js";
import { HttpError } from "../../lib/auth.js";

const ENV = { RESEND_API_KEY: "re_full", SITE_URL: "https://gvf.test", MAIL_FROM: "Forum <news@gvf.test>" };
const C = { id: 3, subject: "October drive", subject_hi: "अक्टूबर अभियान", body: "## Thanks\n\nForty volunteers came.\nTwo tonnes cleared.\n\n- Next drive 20 Oct\n- Bring gloves\n\nMore: https://gvf.test/blog/x.", body_hi: "चालीस स्वयंसेवक आए।", status: "draft" };

function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: null };
  res.status = (s) => { res.statusCode = s; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; return res; };
  res.end = (b) => { try { res.body = JSON.parse(b); } catch { res.body = b; } };
  return res;
}
const authAs = (role) => async (req, roles) => { if (roles && !roles.includes(role)) throw new HttpError(403, "forbidden"); return { user: { id: "u" }, staff: { role, email: role + "@gvf.test", name: "T" } }; };

// Tables with filters applied in JS; inserts get ids.
function fakeSb(tables = {}) {
  const calls = [];
  let seq = 100;
  const from = (table) => {
    const q = { table, op: "select", filters: [], row: null, single: false, head: false };
    const rows = () => (tables[table] = tables[table] || []);
    const match = (r) => q.filters.every(([op, k, v]) => op === "eq" ? String(r[k]) === String(v) : op === "is" ? r[k] == null : op === "not" ? r[k] != null : op === "in" ? v.map(String).includes(String(r[k])) : true);
    const chain = {
      select(cols, opts) { if (opts && opts.head) q.head = true; if (opts && opts.count) q.count = true; return chain; },
      insert(row) { q.op = "insert"; q.row = row; return chain; },
      update(row) { q.op = "update"; q.row = row; return chain; },
      delete() { q.op = "delete"; return chain; },
      eq(k, v) { q.filters.push(["eq", k, v]); return chain; }, is(k, v) { q.filters.push(["is", k, v]); return chain; },
      not(k, o, v) { q.filters.push(["not", k, v]); return chain; }, in(k, v) { q.filters.push(["in", k, v]); return chain; },
      order() { return chain; }, limit() { return chain; }, range() { return chain; },
      maybeSingle() { q.single = true; return chain; },
      then(resolve, reject) {
        calls.push(q);
        let data = null, count = null;
        if (q.op === "insert") { const list = Array.isArray(q.row) ? q.row : [q.row]; const made = list.map((r) => ({ id: ++seq, status: "pending", ...r })); rows().push(...made); data = q.single ? made[0] : made; }
        else { const hit = rows().filter(match); if (q.op === "update") { for (const r of hit) Object.assign(r, q.row); data = q.single ? (hit[0] || null) : hit; } else if (q.op === "delete") { for (const r of hit) rows().splice(rows().indexOf(r), 1); data = hit.map((r) => ({ id: r.id })); } else { data = q.head ? null : (q.single ? (hit[0] || null) : hit); count = hit.length; } }
        return Promise.resolve({ data, error: null, count }).then(resolve, reject);
      }
    };
    return chain;
  };
  return { from, calls, tables };
}
function fakeResend(script = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = url.replace("https://api.resend.com", "");
    calls.push({ method: init.method, path, body: init.body ? JSON.parse(init.body) : null });
    const r = script[`${init.method} ${path}`] || { status: 200, json: { id: "bc_1" } };
    return { status: r.status, json: async () => r.json };
  };
  return { calls, fetchImpl };
}

test("validateCampaign: subject and body required, Hindi optional, no HTML", () => {
  assert.deepEqual(validateCampaign({ subject: "Hi", body: "short" }).errors, ["subject", "body"]);
  const ok = validateCampaign({ subject: "  October drive ", body: "x".repeat(30), subject_hi: "", body_hi: "", post_id: "nope" });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.out, { subject: "October drive", body: "x".repeat(30), subject_hi: null, body_hi: null, post_id: null });
  assert.deepEqual(validateCampaign({ subject: "Hello there", body: "<script>alert(1)</script> and twenty chars" }).errors, ["html_not_allowed"]);
});

test("textToHtml: paragraphs, headings, lists, line breaks and links, all escaped", () => {
  const h = textToHtml("## Thanks <all>\n\nLine one\nLine two & more\n\n- a\n- b\n\nSee https://gvf.test/x.");
  assert.equal(h, '<h2>Thanks &lt;all&gt;</h2>\n<p>Line one<br>Line two &amp; more</p>\n<ul><li>a</li><li>b</li></ul>\n<p>See <a href="https://gvf.test/x">https://gvf.test/x</a>.</p>');
});

test("renderMail picks the subscriber's language and carries the Forum's own stop link; renderBroadcast is bilingual with Resend's placeholder", () => {
  const en = renderMail(C, { lang: "en", unsub: "https://gvf.test/api/subscribe?unsubscribe=t1", site: "https://gvf.test" });
  assert.equal(en.subject, "October drive");
  assert.ok(en.text.endsWith("Stop these emails: https://gvf.test/api/subscribe?unsubscribe=t1"));
  assert.ok(en.html.includes("<h1") && en.html.includes("<li>Next drive 20 Oct</li>") && en.html.includes('href="https://gvf.test/api/subscribe?unsubscribe=t1"'));
  const hi = renderMail(C, { lang: "hi", unsub: "u", site: "https://gvf.test" });
  assert.equal(hi.subject, "अक्टूबर अभियान");
  assert.ok(hi.text.startsWith("चालीस स्वयंसेवक आए।") && hi.text.includes("ये ईमेल बंद करें: u"));
  const noHi = renderMail({ ...C, body_hi: null }, { lang: "hi", unsub: "u", site: "https://gvf.test" });
  assert.equal(noHi.subject, "October drive", "falls back to English when Hindi is missing");
  const b = renderBroadcast(C, { site: "https://gvf.test" });
  assert.equal(b.subject, "October drive / अक्टूबर अभियान");
  assert.ok(b.html.includes("{{{RESEND_UNSUBSCRIBE_URL}}}") && b.html.includes('lang="hi"') && b.text.includes("चालीस"));
});

test("channelFor: none without a key, broadcast with a segment or audience, outbox otherwise", () => {
  assert.deepEqual(channelFor({}), { mode: "none" });
  assert.deepEqual(channelFor({ RESEND_API_KEY: "k" }), { mode: "outbox", flush_now: 100, daily_cap: 100 });
  assert.deepEqual(channelFor({ RESEND_API_KEY: "k", RESEND_SEGMENT_ID: "s" }), { mode: "broadcast" });
  assert.deepEqual(channelFor({ RESEND_API_KEY: "k", RESEND_AUDIENCE_ID: "a" }), { mode: "broadcast" });
  assert.deepEqual(channelFor({ RESEND_API_KEY: "k", RESEND_SEGMENT_ID: "s", AUDIENCE_SYNC: "off" }), { mode: "outbox", flush_now: 100, daily_cap: 100 });
});

test("sendBroadcast creates and sends in one call, or falls back to the separate send call", async () => {
  const r1 = fakeResend({ "POST /broadcasts": { status: 201, json: { id: "bc_9" } } });
  assert.deepEqual(await sendBroadcast({ ...ENV, RESEND_SEGMENT_ID: "seg_1" }, C, r1.fetchImpl), { ok: true, id: "bc_9" });
  assert.equal(r1.calls.length, 1);
  assert.equal(r1.calls[0].body.segment_id, "seg_1");
  assert.equal(r1.calls[0].body.send, true);
  assert.equal(r1.calls[0].body.from, "Forum <news@gvf.test>");
  assert.ok(r1.calls[0].body.html.includes("{{{RESEND_UNSUBSCRIBE_URL}}}"));
  const r2 = fakeResend({ "POST /broadcasts": { status: 422, json: { message: "send is not allowed" } }, "POST /broadcasts/bc_2/send": { status: 200, json: { id: "bc_2" } } });
  let n = 0;
  const f2 = async (url, init) => { n++; if (n === 2) return { status: 201, json: async () => ({ id: "bc_2" }) }; return r2.fetchImpl(url, init); };
  assert.deepEqual(await sendBroadcast({ ...ENV, RESEND_AUDIENCE_ID: "aud_1" }, C, f2), { ok: true, id: "bc_2" });
  assert.equal(n, 3);
  assert.deepEqual(await sendBroadcast(ENV, C, r1.fetchImpl), { ok: false, error: "no_broadcast_target" });
  const down = await sendBroadcast({ ...ENV, RESEND_SEGMENT_ID: "s" }, C, async () => { throw new Error("ECONNRESET"); });
  assert.deepEqual(down, { ok: false, id: null, error: "ECONNRESET", status: 0 });
});

test("outboxRows gives each subscriber their language and token link; flushCampaign sends a bounded batch and leaves the rest", async () => {
  const subs = [{ id: 1, email: "a@x.org", lang: "en", token: "ta" }, { id: 2, email: "b@x.org", lang: "hi", token: "tb" }, { id: 3, email: "c@x.org", lang: "en", token: "tc" }];
  const rows = outboxRows(C, subs, ENV);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].kind, "newsletter");
  assert.equal(rows[0].campaign_id, 3);
  assert.equal(rows[1].subject, "अक्टूबर अभियान");
  assert.ok(rows[1].body_text.includes("https://gvf.test/api/subscribe?unsubscribe=tb"));
  const sb = fakeSb({ outbox: rows.map((r, i) => ({ id: i + 1, status: "pending", attempts: 0, ...r })) });
  const sent = [];
  const send = async (row) => { if (row.to_email === "b@x.org") throw new Error("resend 429: slow down"); sent.push(row.to_email); };
  const out = await flushCampaign(sb, ENV, 3, { limit: 2, send });
  assert.deepEqual(out, { sent: 1, failed: 1, remaining: 1 });
  assert.deepEqual(sent, ["a@x.org"]);
  assert.equal(sb.tables.outbox[0].status, "sent");
  assert.equal(sb.tables.outbox[1].status, "pending");
  assert.equal(sb.tables.outbox[1].last_error, "resend 429: slow down");
  assert.equal(sb.tables.outbox[2].status, "pending");
  assert.deepEqual(await flushCampaign(sb, {}, 3, { send }), { sent: 0, failed: 0, remaining: 0 }, "no key: nothing goes out");
});

test("desk endpoint: roles, save, preview, test, send by outbox and by broadcast, delete", async () => {
  const subs = [
    { id: 1, email: "a@x.org", lang: "en", token: "ta", confirmed_at: "2026-10-01T00:00:00Z", unsubscribed_at: null },
    { id: 2, email: "b@x.org", lang: "hi", token: "tb", confirmed_at: "2026-10-01T00:00:00Z", unsubscribed_at: null },
    { id: 3, email: "p@x.org", lang: "en", token: "tp", confirmed_at: null, unsubscribed_at: null },
    { id: 4, email: "u@x.org", lang: "en", token: "tu", confirmed_at: "2026-10-01T00:00:00Z", unsubscribed_at: "2026-10-05T00:00:00Z" }
  ];
  const denied = fakeRes();
  await makeHandler({ auth: authAs("triage"), sb: fakeSb(), env: ENV })({ method: "GET", query: {} }, denied);
  assert.equal(denied.statusCode, 403);

  const sb = fakeSb({ subscribers: subs, campaigns: [] });
  const mailed = [];
  const mail = async (row) => { mailed.push(row); };
  const h = (role, extra = {}) => makeHandler({ auth: authAs(role), sb, env: ENV, mailImpl: mail, ...extra });

  // Save (content team may), then list.
  const save = fakeRes();
  await h("content")({ method: "POST", query: {}, body: { subject: C.subject, body: C.body, subject_hi: C.subject_hi, body_hi: C.body_hi } }, save);
  assert.equal(save.statusCode, 200, JSON.stringify(save.body));
  const id = save.body.campaign.id;
  assert.equal(save.body.campaign.status, "draft");
  assert.equal(save.body.campaign.created_by, "T <content@gvf.test>");
  const bad = fakeRes();
  await h("content")({ method: "POST", query: {}, body: { subject: "x", body: "<b>no</b> html here at all" } }, bad);
  assert.equal(bad.statusCode, 400);
  const list = fakeRes();
  await h("content")({ method: "GET", query: {} }, list);
  assert.equal(list.body.confirmed, 2, "confirmed and not stopped");
  assert.deepEqual(list.body.channel, { mode: "outbox", flush_now: 100, daily_cap: 100 });
  assert.equal(list.body.campaigns.length, 1);

  // Preview renders without saving.
  const pv = fakeRes();
  await h("content")({ method: "POST", query: { id: "preview" }, body: { subject: C.subject, body: C.body, subject_hi: C.subject_hi, body_hi: C.body_hi } }, pv);
  assert.equal(pv.statusCode, 200);
  assert.ok(pv.body.html.includes("<li>Next drive 20 Oct</li>") && pv.body.html_hi.includes("चालीस"));

  // Test mail goes to the signed-in person and is recorded in the outbox.
  const t = fakeRes();
  await h("content")({ method: "POST", query: { id: String(id) }, body: { action: "test" } }, t);
  assert.equal(t.statusCode, 200, JSON.stringify(t.body));
  assert.equal(t.body.to, "content@gvf.test");
  assert.equal(mailed.length, 1);
  assert.equal(mailed[0].subject, "[Test] October drive");
  assert.equal(sb.tables.outbox[0].kind, "newsletter_test");
  assert.equal(sb.tables.outbox[0].status, "sent");
  assert.ok(sb.tables.campaigns[0].test_sent_at);

  // The content team cannot send to the list; a coordinator can (outbox path).
  const no = fakeRes();
  await h("content")({ method: "POST", query: { id: String(id) }, body: { action: "send" } }, no);
  assert.equal(no.statusCode, 403);
  const sendRes = fakeRes();
  await h("coordinator")({ method: "POST", query: { id: String(id) }, body: { action: "send" } }, sendRes);
  assert.equal(sendRes.statusCode, 200, JSON.stringify(sendRes.body));
  assert.equal(sendRes.body.channel, "outbox");
  assert.equal(sendRes.body.recipients, 2);
  assert.equal(sendRes.body.sent, 2);
  assert.equal(sendRes.body.remaining, 0);
  assert.equal(sendRes.body.campaign.status, "sent");
  assert.equal(sendRes.body.campaign.sent_by, "T <coordinator@gvf.test>");
  const to = mailed.slice(1).map((m) => m.to_email).sort();
  assert.deepEqual(to, ["a@x.org", "b@x.org"], "pending and stopped addresses are never mailed");
  assert.ok(mailed.find((m) => m.to_email === "b@x.org").subject === "अक्टूबर अभियान");
  const again = fakeRes();
  await h("owner")({ method: "POST", query: { id: String(id) }, body: { action: "send" } }, again);
  assert.equal(again.statusCode, 409);
  const del = fakeRes();
  await h("content")({ method: "DELETE", query: { id: String(id) } }, del);
  assert.equal(del.statusCode, 404, "a sent newsletter cannot be deleted");

  // Broadcast path with a segment configured: one Resend call, no outbox rows.
  const r = fakeResend({ "POST /broadcasts": { status: 201, json: { id: "bc_7" } } });
  const sb2 = fakeSb({ subscribers: subs, campaigns: [{ ...C, id: 11, status: "draft" }] });
  const hb = makeHandler({ auth: authAs("owner"), sb: sb2, env: { ...ENV, RESEND_SEGMENT_ID: "seg_1" }, fetchImpl: r.fetchImpl, mailImpl: mail });
  const bres = fakeRes();
  await hb({ method: "POST", query: { id: "11" }, body: { action: "send" } }, bres);
  assert.equal(bres.statusCode, 200, JSON.stringify(bres.body));
  assert.equal(bres.body.channel, "broadcast");
  assert.equal(bres.body.campaign.broadcast_id, "bc_7");
  assert.equal(bres.body.campaign.status, "sent");
  assert.equal(bres.body.campaign.sent, 2);
  assert.equal(r.calls.length, 1);
  assert.equal((sb2.tables.outbox || []).length, 0);
  // Without a key: 503 and nothing changes.
  const none = fakeRes();
  await makeHandler({ auth: authAs("owner"), sb: fakeSb({ subscribers: subs, campaigns: [{ ...C, id: 12 }] }), env: {} })({ method: "POST", query: { id: "12" }, body: { action: "send" } }, none);
  assert.equal(none.statusCode, 503);
  // A draft can be deleted.
  const sb3 = fakeSb({ campaigns: [{ ...C, id: 13, status: "draft" }] });
  const d2 = fakeRes();
  await makeHandler({ auth: authAs("content"), sb: sb3, env: ENV })({ method: "DELETE", query: { id: "13" } }, d2);
  assert.deepEqual(d2.body, { ok: true, deleted: true, id: 13 });
  assert.equal(sb3.tables.campaigns.length, 0);
});
