import { test } from "node:test";
import assert from "node:assert/strict";
import { refIn, ingestReply } from "../../lib/replies.js";
import { makeHandler as makeAsk, askMail, askText, deskAddress } from "../../lib/handlers/triage/ask.js";
import { makeHandler as makeExtract, buildPrompt, cleanProposal } from "../../lib/handlers/triage/extract.js";
import { makeHandler as makeHook } from "../../lib/handlers/hooks/email.js";
import { HttpError } from "../../lib/auth.js";

function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: null };
  res.status = (s) => { res.statusCode = s; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; return res; };
  res.end = (b) => { try { res.body = JSON.parse(b); } catch { res.body = b; } };
  return res;
}
const session = (role) => ({ user: { id: "u-" + role }, staff: { user_id: "u-" + role, name: "Tester", role, email: role + "@gvf.test", wards: [] } });
const authAs = (role) => async (req, roles) => { if (roles && !roles.includes(role)) throw new HttpError(403, "forbidden"); return session(role); };

const FILING = { portal: "GMDA portal", fields: [{ k: "where", l: "Type of place", r: true }, { k: "since", l: "Since when", r: false }, { k: "landmark", l: "Nearest landmark", r: true }], docs: [{ k: "photo", l: "Photo of the spot", r: true }] };
const REPORT = { id: "r-1", ref: "GVF-2026-ABCDE", issue_type: "waste", issue_label: "Garbage", area: "Sector 29", ward: 30, stage: 0, reporter_name: "Asha", reporter_email: "asha@example.org", filing: FILING, extra: { where: "Street" }, attachments: [] };

// A Supabase fake: reads answer from `rows`, writes are recorded in `calls`.
function fakeSb({ report = REPORT, inbox = [] } = {}) {
  const calls = [];
  const uploads = [];
  const rpcs = [];
  function chain(table) {
    const q = { table, op: "select", filters: [] };
    const c = {
      select: () => c, order: () => c, limit: () => c, maybeSingle: () => c,
      eq: (k, v) => { q.filters.push([k, v]); return c; },
      insert: (row) => { q.op = "insert"; q.row = row; calls.push(q); return c; },
      update: (row) => { q.op = "update"; q.row = row; calls.push(q); return c; },
      upsert: (row, opts) => { q.op = "upsert"; q.row = row; q.opts = opts; calls.push(q); return c; },
      then: (ok) => {
        if (q.op !== "select") return ok({ data: q.op === "insert" ? { id: 7 } : [{ id: "x" }], error: null });
        if (table === "triage_reports") { const ref = q.filters.find((f) => f[0] === "ref"); return ok({ data: report && ref && ref[1] === report.ref ? report : null, error: null }); }
        if (table === "inbox") { const id = q.filters.find((f) => f[0] === "id"); return ok({ data: inbox.find((m) => m.id === (id && id[1])) || null, error: null }); }
        if (table === "reports") return ok({ data: { asked_at: null }, error: null });
        return ok({ data: null, error: null });
      }
    };
    return c;
  }
  return { calls, uploads, rpcs, from: chain, rpc: async (name, args) => { rpcs.push([name, args]); return { data: null, error: null }; },
    storage: { from: () => ({ upload: async (path, bytes, opts) => { uploads.push({ path, size: bytes.length, opts }); return { error: null }; } }) } };
}

test("refIn finds a report reference in a subject or body, any case", () => {
  assert.equal(refIn("Re: [GVF-2026-ABCDE] A few details needed"), "GVF-2026-ABCDE");
  assert.equal(refIn("my ref gvf-2026-abcde thanks"), "GVF-2026-ABCDE");
  assert.equal(refIn("GVF-2026-ABC"), null);
  assert.equal(refIn(""), null);
});

test("askMail: bilingual, reference in the subject, Reply-To the desk, never the phone", () => {
  const env = { SITE_URL: "https://gurugramvisionforum.org", RESEND_API_KEY: "k" };
  assert.equal(deskAddress(env), "desk@gurugramvisionforum.org");
  assert.equal(deskAddress({ ...env, DESK_EMAIL: "help@gvf.org" }), "help@gvf.org");
  const fc = { portal: "GMDA portal", missing: ["Nearest landmark", "Photo of the spot"] };
  const m = askMail({ ...REPORT, reporter_phone: "+919899999999" }, fc, env);
  assert.equal(m.to_email, "asha@example.org");
  assert.equal(m.subject, "[GVF-2026-ABCDE] A few details needed for your report");
  assert.equal(m.reply_to, "desk@gurugramvisionforum.org");
  assert.equal(m.kind, "ask");
  assert.equal(m.report_id, "r-1");
  assert.ok(m.body_text.includes("Nearest landmark") && m.body_text.includes("Photo of the spot"));
  assert.ok(m.body_text.includes("नमस्ते") && m.body_html.includes('lang="hi"'));
  assert.ok(m.body_text.includes("/track") && m.body_html.includes("gurugramvisionforum.org/track"));
  assert.ok(!m.body_text.includes("9899999999") && !m.body_html.includes("9899999999"));
  assert.ok(askText(REPORT, fc).includes("GVF-2026-ABCDE") && askText(REPORT, fc).includes("Nearest landmark"));
});

test("ask handler: content refused, 409 when nothing is missing or no email, sends and logs otherwise", async () => {
  const denied = fakeRes();
  await makeAsk({ auth: authAs("content"), sb: fakeSb(), env: {} })({ method: "POST", query: { ref: "GVF-2026-ABCDE" } }, denied);
  assert.equal(denied.statusCode, 403);

  const bad = fakeRes();
  await makeAsk({ auth: authAs("owner"), sb: fakeSb(), env: {} })({ method: "POST", query: { ref: "nope" } }, bad);
  assert.equal(bad.statusCode, 400);

  const none = fakeRes();
  await makeAsk({ auth: authAs("owner"), sb: fakeSb({ report: { ...REPORT, extra: { where: "Street", landmark: "Gate" }, attachments: [{ kind: "photo", name: "a.jpg" }] } }), env: {} })({ method: "POST", query: { ref: "GVF-2026-ABCDE" } }, none);
  assert.equal(none.statusCode, 409);
  assert.equal(none.body.error, "nothing_missing");

  const noEmail = fakeRes();
  await makeAsk({ auth: authAs("coordinator"), sb: fakeSb({ report: { ...REPORT, reporter_email: null } }), env: { RESEND_API_KEY: "k" } })({ method: "POST", query: { ref: "GVF-2026-ABCDE" } }, noEmail);
  assert.equal(noEmail.statusCode, 409);
  assert.equal(noEmail.body.error, "no_email");
  assert.ok(noEmail.body.text.includes("GVF-2026-ABCDE"));
  assert.deepEqual(noEmail.body.missing, ["Nearest landmark", "Photo of the spot"]);

  const noKey = fakeRes();
  await makeAsk({ auth: authAs("coordinator"), sb: fakeSb(), env: {} })({ method: "POST", query: { ref: "GVF-2026-ABCDE" } }, noKey);
  assert.equal(noKey.statusCode, 503);
  assert.equal(noKey.body.error, "mail_unavailable");
  assert.ok(noKey.body.text.includes("Nearest landmark"));

  const sb = fakeSb();
  const sent = [];
  const ok = fakeRes();
  await makeAsk({ auth: authAs("coordinator"), sb, env: { RESEND_API_KEY: "k", SITE_URL: "https://gurugramvisionforum.org" }, mailImpl: async (row) => { sent.push(row); } })({ method: "POST", query: { ref: "gvf-2026-abcde" } }, ok);
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.sent, true);
  assert.equal(ok.body.to, "asha@example.org");
  assert.ok(ok.body.asked_at);
  assert.deepEqual(ok.body.missing, ["Nearest landmark", "Photo of the spot"]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].reply_to, "desk@gurugramvisionforum.org");
  const outbox = sb.calls.find((c) => c.table === "outbox" && c.op === "insert");
  assert.ok(outbox && outbox.row.kind === "ask" && outbox.row.subject.startsWith("[GVF-2026-ABCDE]"));
  const ev = sb.calls.find((c) => c.table === "report_events" && c.op === "insert");
  assert.ok(ev && ev.row.note.startsWith("Asked the reporter by email for: Nearest landmark, Photo of the spot"));
  assert.equal(ev.row.actor, "Tester <coordinator@gvf.test>");
  const up = sb.calls.find((c) => c.table === "reports" && c.op === "update");
  assert.ok(up && up.row.asked_at);
});

test("ingestReply: links a mail by reference, stores allowed files into the open photo slot, logs the reply", async () => {
  const sb = fakeSb();
  const png = Buffer.from("pngbytes").toString("base64");
  const message = { subject: "Re: [GVF-2026-ABCDE] A few details needed", body_text: "Landmark is the Sector 29 gate.", external_id: "em_9" };
  const full = { id: "em_9", attachments: [
    { filename: "spot photo.png", content_type: "image/png", content: png },
    { filename: "notes.txt", content_type: "text/plain", content: Buffer.from("x").toString("base64") },
    { filename: "second.jpg", content_type: "image/jpeg", download_url: "https://files.example/second.jpg" }] };
  const fetchImpl = async (url) => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode("jpegbytes").buffer });
  const out = await ingestReply(sb, { RESEND_API_KEY: "k" }, message, full, fetchImpl);
  assert.equal(out.report_id, "r-1");
  assert.equal(out.report_ref, "GVF-2026-ABCDE");
  assert.equal(out.attachments.length, 3);
  assert.equal(out.attachments[0].stored, true);
  assert.equal(out.attachments[0].kind, "photo", "first image fills the missing photo slot");
  assert.equal(out.attachments[1].stored, false, "text files are not stored");
  assert.equal(out.attachments[2].stored, true);
  assert.equal(out.attachments[2].kind, "reply", "further files are kept as replies");
  assert.equal(sb.uploads.length, 2);
  assert.ok(sb.uploads[0].path.startsWith("GVF-2026-ABCDE/reply-") && sb.uploads[0].path.endsWith("-1-spot_photo.png"));
  assert.equal(sb.uploads[0].opts.contentType, "image/png");
  assert.equal(sb.rpcs.length, 1);
  assert.equal(sb.rpcs[0][0], "report_attach");
  assert.equal(sb.rpcs[0][1].p_ref, "GVF-2026-ABCDE");
  assert.equal(sb.rpcs[0][1].p_files.length, 2);
  assert.equal(sb.rpcs[0][1].p_files[0].via, "email");
  const ev = sb.calls.find((c) => c.table === "report_events" && c.op === "insert");
  assert.ok(ev && ev.row.actor === "reporter" && ev.row.note.includes("Landmark is the Sector 29 gate.") && ev.row.note.includes("2 file(s) attached"));
});

test("ingestReply: a mail without a reference, or with an unknown one, stays unlinked and never throws", async () => {
  const sb = fakeSb();
  assert.deepEqual(await ingestReply(sb, {}, { subject: "Hello", body_text: "Just a question" }, {}), { report_id: null, report_ref: null, attachments: [] });
  assert.deepEqual(await ingestReply(sb, {}, { subject: "GVF-2026-ZZZZZ", body_text: "" }, {}), { report_id: null, report_ref: null, attachments: [] });
  const broken = { from: () => { throw new Error("db down"); } };
  assert.deepEqual(await ingestReply(broken, {}, { subject: "GVF-2026-ABCDE" }, {}), { report_id: null, report_ref: null, attachments: [] });
  assert.equal(sb.calls.length, 0);
});

test("email hook stores the link and the files on the inbox row", async () => {
  const sb = fakeSb();
  const h = makeHook({ env: { EMAIL_HOOK_TOKEN: "tok" }, sb });
  const res = fakeRes();
  await h({ method: "POST", headers: { "x-webhook-token": "tok" }, query: {}, body: { from: "Asha <asha@example.org>", subject: "Re: [GVF-2026-ABCDE] A few details needed", text: "The landmark is the gate.", attachments: [{ filename: "a.png", content_type: "image/png", content: Buffer.from("png").toString("base64") }] } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.report_ref, "GVF-2026-ABCDE");
  assert.equal(res.body.files, 1);
  const up = sb.calls.find((c) => c.table === "inbox" && c.op === "upsert");
  assert.ok(up);
  assert.equal(up.row.report_id, "r-1");
  assert.equal(up.row.report_ref, "GVF-2026-ABCDE");
  assert.equal(up.row.attachments.length, 1);
  assert.equal(up.row.attachments[0].stored, true);
  const plain = fakeRes();
  await h({ method: "POST", headers: { "x-webhook-token": "tok" }, query: {}, body: { from: "x@y.z", subject: "Hi", text: "No reference here" } }, plain);
  assert.equal(plain.statusCode, 200);
  assert.equal(plain.body.report_ref, null);
});

test("extract: prompt lists only the missing fields, proposal is cleaned, handler needs a key", async () => {
  const fields = [{ key: "landmark", label: "Nearest landmark" }, { key: "since", label: "Since when" }];
  const p = buildPrompt(fields, "Near the gate since 2 Oct");
  assert.ok(p.system.includes("never guess") && p.user.includes("- landmark: Nearest landmark") && p.user.includes("Near the gate since 2 Oct"));
  assert.deepEqual(cleanProposal({ landmark: " Sector 29 gate ", since: "", where: "Park", extra: 1, n: null }, fields), { landmark: "Sector 29 gate" });
  assert.deepEqual(cleanProposal(null, fields), {});

  const noKey = fakeRes();
  await makeExtract({ auth: authAs("coordinator"), sb: fakeSb(), env: {} })({ method: "POST", query: { ref: "GVF-2026-ABCDE" }, body: { text: "Near the gate" } }, noKey);
  assert.equal(noKey.statusCode, 503);
  assert.equal(noKey.body.error, "extract_unavailable");

  const denied = fakeRes();
  await makeExtract({ auth: authAs("content"), sb: fakeSb(), env: { GEMINI_API_KEY: "g" } })({ method: "POST", query: { ref: "GVF-2026-ABCDE" }, body: { text: "x" } }, denied);
  assert.equal(denied.statusCode, 403);

  const empty = fakeRes();
  await makeExtract({ auth: authAs("owner"), sb: fakeSb(), env: { GEMINI_API_KEY: "g" } })({ method: "POST", query: { ref: "GVF-2026-ABCDE" }, body: {} }, empty);
  assert.equal(empty.statusCode, 400);

  // From an inbox row that belongs to the report; the model answers JSON with one stray key.
  const inbox = [{ id: "11111111-1111-4111-8111-111111111111", report_id: "r-1", body_text: "The landmark is the Sector 29 gate, since 2 October.\n\n> On Mon you wrote: we still need" }];
  const asked = [];
  const fetchImpl = async (url, init) => { asked.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '```json\n{"landmark":"Sector 29 gate","since":"2026-10-02","where":"Park"}\n```' }] } }] }) }; };
  const ok = fakeRes();
  await makeExtract({ auth: authAs("owner"), sb: fakeSb({ inbox }), env: { GEMINI_API_KEY: "g" }, fetchImpl })({ method: "POST", query: { ref: "GVF-2026-ABCDE" }, body: { inbox_id: inbox[0].id } }, ok);
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.provider, "gemini");
  assert.deepEqual(ok.body.fields, { landmark: "Sector 29 gate", since: "2026-10-02" }, "where is already filled, so it is not proposed");
  assert.equal(asked.length, 1);
  assert.ok(JSON.stringify(asked[0].body).includes("Sector 29 gate"));

  const other = fakeRes();
  await makeExtract({ auth: authAs("owner"), sb: fakeSb({ inbox: [{ id: inbox[0].id, report_id: "r-2", body_text: "x" }] }), env: { GEMINI_API_KEY: "g" }, fetchImpl })({ method: "POST", query: { ref: "GVF-2026-ABCDE" }, body: { inbox_id: inbox[0].id } }, other);
  assert.equal(other.statusCode, 404, "a reply from another report is not read");
});
