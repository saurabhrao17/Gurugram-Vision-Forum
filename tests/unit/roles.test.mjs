import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLES, CONTENT_ROLES, REPORT_ROLES, MANAGER_ROLES, isOwner, isManager, canContent, canReports, HttpError } from "../../lib/auth.js";
import { makeHandler as makeContent } from "../../lib/handlers/triage/content.js";
import { makeHandler as makeVisitors } from "../../lib/handlers/triage/visitors.js";
import { makeHandler as makeSubscribers } from "../../lib/handlers/triage/subscribers.js";
import { makeHandler as makeNewsletter } from "../../lib/handlers/triage/newsletter.js";
import { makeHandler as makeJoins, validateJoinPatch, STATUSES } from "../../lib/handlers/triage/joins.js";
import { joinMail } from "../../lib/handlers/join.js";
import { makeHandler as makeReports } from "../../lib/handlers/triage/reports.js";
import { makeHandler as makeReport } from "../../lib/handlers/triage/report.js";
import { makeHandler as makeAsk } from "../../lib/handlers/triage/ask.js";
import { makeHandler as makeExtract } from "../../lib/handlers/triage/extract.js";
import { makeHandler as makeDraft } from "../../lib/handlers/triage/draft.js";
import { CREATABLE_ROLES, COORDINATOR_CREATABLE } from "../../lib/handlers/triage/staff.js";
import { makeHandler as makeTranslate, detectLang, buildTranslatePrompt, readFields, cleanTranslation, SYSTEM_PROMPT } from "../../lib/handlers/triage/translate.js";
import { LIMITS } from "../../lib/content.js";

function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: null };
  res.status = (s) => { res.statusCode = s; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; return res; };
  res.end = (b) => { try { res.body = JSON.parse(b); } catch { res.body = b; } };
  return res;
}

// A fake requireStaff that behaves like the real one: the session's role is
// checked against the handler's list and 403 forbidden is thrown otherwise.
const session = (role) => ({ user: { id: "u-" + role }, staff: { user_id: "u-" + role, name: "T", role, email: role + "@gvf.test", wards: [] } });
const authAs = (role) => async (req, roles) => {
  const s = session(role);
  if (roles && !roles.includes(role)) throw new HttpError(403, "forbidden");
  return s;
};

// Minimal Supabase fake for the content GET: every chain resolves to rows.
function fakeSb(rows = {}) {
  return {
    from(table) {
      const data = rows[table] || [];
      const chain = { select: () => chain, order: () => chain, limit: () => chain, eq: () => chain, then: (ok) => ok({ data, error: null }) };
      return chain;
    }
  };
}

test("role helpers: owner sees everything, content only content, triage only reports", () => {
  assert.deepEqual(ROLES, ["owner", "coordinator", "triage", "content"]);
  assert.deepEqual(CONTENT_ROLES, ["owner", "coordinator", "content"]);
  assert.deepEqual(REPORT_ROLES, ["owner", "coordinator", "triage"]);
  assert.deepEqual(MANAGER_ROLES, ["owner", "coordinator"]);
  const matrix = {
    owner: { isOwner: true, isManager: true, canContent: true, canReports: true },
    coordinator: { isOwner: false, isManager: true, canContent: true, canReports: true },
    triage: { isOwner: false, isManager: false, canContent: false, canReports: true },
    content: { isOwner: false, isManager: false, canContent: true, canReports: false }
  };
  for (const [role, want] of Object.entries(matrix)) {
    const s = session(role);
    assert.equal(isOwner(s), want.isOwner, role);
    assert.equal(isManager(s), want.isManager, role);
    assert.equal(canContent(s), want.canContent, role);
    assert.equal(canReports(s), want.canReports, role);
  }
  // The helpers also accept a bare staff row.
  assert.equal(canContent({ role: "content" }), true);
  assert.equal(canReports({ role: "content" }), false);
  assert.equal(isOwner(null), false);
});

test("staff POST: coordinators may create triage and content, only the owner may create coordinators", () => {
  assert.deepEqual(CREATABLE_ROLES, ["coordinator", "triage", "content"]);
  assert.deepEqual(COORDINATOR_CREATABLE, ["triage", "content"]);
  assert.ok(!CREATABLE_ROLES.includes("owner"));
});

test("content handler rejects a ward volunteer and accepts the content team", async () => {
  const denied = fakeRes();
  await makeContent({ auth: authAs("triage"), sb: fakeSb() })({ method: "GET", query: {} }, denied);
  assert.equal(denied.statusCode, 403);
  assert.deepEqual(denied.body, { ok: false, error: "forbidden" });

  const ok = fakeRes();
  await makeContent({ auth: authAs("content"), sb: fakeSb({ posts: [{ id: "p1", kind: "news", title: "Hi", media_path: null }], site_settings: [{ key: "social", value: { x: "https://x.com/gvf" } }] }) })({ method: "GET", query: {} }, ok);
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.ok, true);
  assert.equal(ok.body.posts.length, 1);
  assert.deepEqual(ok.body.settings.social, { x: "https://x.com/gvf" });

  const owner = fakeRes();
  await makeContent({ auth: authAs("owner"), sb: fakeSb() })({ method: "GET", query: {} }, owner);
  assert.equal(owner.statusCode, 200);
});

test("draft handler accepts the content team", async () => {
  const res = fakeRes();
  await makeDraft({ env: {}, auth: authAs("content"), fetchImpl: async () => { throw new Error("no"); } })({ method: "POST", body: { brief: "x" } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "draft_unavailable");
  const no = fakeRes();
  await makeDraft({ env: { GEMINI_API_KEY: "k" }, auth: authAs("triage") })({ method: "POST", body: { brief: "x" } }, no);
  assert.equal(no.statusCode, 403);
});

test("ask and extract on a report follow the report roles: content refused, owner, coordinator and triage allowed", async () => {
  for (const make of [makeAsk, makeExtract]) {
    const denied = fakeRes();
    await make({ auth: authAs("content"), sb: fakeSb(), env: {} })({ method: "POST", query: { ref: "GVF-2026-ABCDE" }, body: {} }, denied);
    assert.equal(denied.statusCode, 403);
    assert.deepEqual(denied.body, { ok: false, error: "forbidden" });
    for (const role of ["owner", "coordinator", "triage"]) {
      const res = fakeRes();
      await make({ auth: authAs(role), sb: fakeSb(), env: {} })({ method: "POST", query: { ref: "bad ref" }, body: {} }, res);
      assert.equal(res.statusCode, 400, role + " passes the role gate and fails on the reference");
    }
  }
});

test("visitors is owner only: a coordinator is refused", async () => {
  const res = fakeRes();
  await makeVisitors({ auth: authAs("coordinator"), sb: fakeSb() })({ method: "GET", query: {} }, res);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { ok: false, error: "forbidden" });
  const content = fakeRes();
  await makeVisitors({ auth: authAs("content"), sb: fakeSb() })({ method: "GET", query: {} }, content);
  assert.equal(content.statusCode, 403);
});

test("subscribers is owner only: coordinator, content and triage are refused", async () => {
  for (const role of ["coordinator", "content", "triage"]) {
    const res = fakeRes();
    await makeSubscribers({ auth: authAs(role), sb: fakeSb() })({ method: "GET", query: {} }, res);
    assert.equal(res.statusCode, 403, role);
    assert.deepEqual(res.body, { ok: false, error: "forbidden" });
  }
});

test("newsletter: triage is refused; the content team may draft but only owner and coordinator may send", async () => {
  const res = fakeRes();
  await makeNewsletter({ auth: authAs("triage"), sb: fakeSb(), env: {} })({ method: "GET", query: {} }, res);
  assert.equal(res.statusCode, 403);
  const draft = fakeRes();
  await makeNewsletter({ auth: authAs("content"), sb: fakeSb(), env: {} })({ method: "POST", query: {}, body: { subject: "x", body: "y" } }, draft);
  assert.equal(draft.statusCode, 400, "allowed in, refused only on validation");
  const sendRes = fakeRes();
  await makeNewsletter({ auth: authAs("content"), sb: fakeSb(), env: {} })({ method: "POST", query: { id: "1" }, body: { action: "send" } }, sendRes);
  assert.equal(sendRes.statusCode, 403);
});

test("reports list and detail refuse the content team", async () => {
  const list = fakeRes();
  await makeReports({ auth: authAs("content") })({ method: "GET", query: {} }, list);
  assert.equal(list.statusCode, 403);
  assert.deepEqual(list.body, { ok: false, error: "forbidden" });
  const one = fakeRes();
  await makeReport({ auth: authAs("content") })({ method: "GET", query: { ref: "GVF-2026-ABCDE" } }, one);
  assert.equal(one.statusCode, 403);
  const patch = fakeRes();
  await makeReport({ auth: authAs("content") })({ method: "PATCH", query: { ref: "GVF-2026-ABCDE" }, body: { stage: 1 } }, patch);
  assert.equal(patch.statusCode, 403);
});

// --- translate -----------------------------------------------------------------

test("detectLang: English, Hindi and mixed text", () => {
  assert.equal(detectLang("Drain cleaned in Sector 29"), "en");
  assert.equal(detectLang("सेक्टर 29 में नाला साफ"), "hi");
  assert.equal(detectLang("GMDA ने Sector 29 का नाला साफ किया"), "hi");
  assert.equal(detectLang("Meeting at 6 pm on 20 October 2026, MCG office"), "en");
  assert.equal(detectLang(""), "en");
  assert.equal(detectLang({ title: "Hello", body: "<p>नमस्ते</p>" }), "hi");
  assert.equal(detectLang({ title: "Hello", body: "<p>world</p>" }), "en");
});

test("buildTranslatePrompt carries the Forum's rules and the fields as JSON", () => {
  const p = buildTranslatePrompt({ title: "Drain cleaned", body: "<p>Call GMDA on 1800-180-1817.</p>" }, "en", "hi");
  assert.equal(p.system, SYSTEM_PROMPT);
  assert.match(p.system, /non-partisan/);
  assert.match(p.system, /GMDA, MCG, DHBVN, HRERA/);
  assert.match(p.system, /CM Window/);
  assert.match(p.system, /HTML tags/);
  assert.match(p.system, /same keys/);
  assert.match(p.user, /from English to Hindi \(Devanagari\)/);
  assert.match(p.user, /"title":"Drain cleaned"/);
  assert.equal(p.json, true);
  const back = buildTranslatePrompt({ title: "x" }, "hi", "en");
  assert.match(back.user, /from Hindi \(Devanagari\) to English/);
});

test("readFields and cleanTranslation cap lengths and sanitise the body", () => {
  assert.deepEqual(readFields({ title: " A ", summary: "", body: null, extra: "ignored" }), { fields: { title: "A" }, errors: [] });
  assert.deepEqual(readFields({ title: "x".repeat(LIMITS.title + 1) }), { fields: {}, errors: ["title"] });
  assert.deepEqual(readFields({ body: 42 }), { fields: {}, errors: ["body"] });
  assert.deepEqual(readFields(undefined), { fields: {}, errors: [] });
  const out = cleanTranslation({ title: "शीर्षक", body: "<p onclick=\"x()\">नमस्ते</p><script>alert(1)</script>", summary: "dropped" }, { title: "T", body: "<p>Hi</p>" });
  assert.deepEqual(out, { title: "शीर्षक", body: "<p>नमस्ते</p>" });
  assert.equal(cleanTranslation({ nope: 1 }, { title: "T" }), null);
  assert.equal(cleanTranslation(null, { title: "T" }), null);
});

test("translate handler sends the Gemini shape and returns the parsed reply", async () => {
  let captured;
  const reply = JSON.stringify({ title: "सेक्टर 29 में नाला साफ", summary: "GMDA ने 3 दिन में काम किया।", body: "<p>निवासियों ने <b>MCG</b> को 1 अक्टूबर 2026 को सूचित किया।</p>" });
  const fetchImpl = async (url, init) => { captured = { url, body: JSON.parse(init.body), headers: init.headers }; return { ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: reply }] } }] }) }; };
  const handler = makeTranslate({ env: { GEMINI_API_KEY: "free-key" }, auth: authAs("content"), fetchImpl });
  const res = fakeRes();
  await handler({ method: "POST", body: { fields: { title: "Drain cleaned in Sector 29", summary: "GMDA did it in 3 days.", body: "<p>Residents told <b>MCG</b> on 1 October 2026.</p>" } } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);
  assert.equal(res.body.from, "en");
  assert.equal(res.body.to, "hi");
  assert.equal(res.body.provider, "gemini");
  assert.equal(res.body.model, "gemini-2.0-flash");
  assert.deepEqual(Object.keys(res.body.fields).sort(), ["body", "summary", "title"]);
  assert.equal(res.body.fields.title, "सेक्टर 29 में नाला साफ");
  assert.equal(res.body.fields.body, "<p>निवासियों ने <b>MCG</b> को 1 अक्टूबर 2026 को सूचित किया।</p>");
  assert.match(captured.url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.0-flash:generateContent\?key=free-key$/);
  assert.equal(captured.headers.authorization, undefined);
  assert.match(captured.body.systemInstruction.parts[0].text, /Gurugram Vision Forum/);
  assert.equal(captured.body.generationConfig.responseMimeType, "application/json");
  assert.match(captured.body.contents[0].parts[0].text, /from English to Hindi/);
  assert.match(captured.body.contents[0].parts[0].text, /Drain cleaned in Sector 29/);

  // Hindi in, English out, with an explicit `from`.
  const back = fakeRes();
  const fetchBack = async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "```json\n{\"title\":\"Drain cleaned\"}\n```" }] } }] }) });
  await makeTranslate({ env: { GEMINI_API_KEY: "k" }, auth: authAs("owner"), fetchImpl: fetchBack })({ method: "POST", body: { fields: { title: "नाला साफ" }, from: "hi" } }, back);
  assert.equal(back.statusCode, 200);
  assert.equal(back.body.from, "hi");
  assert.equal(back.body.to, "en");
  assert.deepEqual(back.body.fields, { title: "Drain cleaned" });
});

test("translate handler: 503 without keys, 400 on bad input, 403 for triage, 502 upstream", async () => {
  const none = fakeRes();
  await makeTranslate({ env: {}, auth: authAs("content"), fetchImpl: async () => { throw new Error("must not be called"); } })({ method: "POST", body: { fields: { title: "Hi" } } }, none);
  assert.equal(none.statusCode, 503);
  assert.deepEqual(none.body, { ok: false, error: "translate_unavailable" });

  const withKey = (auth = authAs("content")) => makeTranslate({ env: { GEMINI_API_KEY: "k" }, auth, fetchImpl: async () => { throw new Error("must not be called"); } });
  const empty = fakeRes();
  await withKey()({ method: "POST", body: { fields: { title: "  ", body: "" } } }, empty);
  assert.equal(empty.statusCode, 400);
  assert.equal(empty.body.error, "invalid");
  const long = fakeRes();
  await withKey()({ method: "POST", body: { fields: { title: "ok", summary: "s".repeat(LIMITS.summary + 1) } } }, long);
  assert.equal(long.statusCode, 400);
  assert.deepEqual(long.body, { ok: false, error: "invalid", fields: ["summary"] });
  const noFields = fakeRes();
  await withKey()({ method: "POST", body: {} }, noFields);
  assert.equal(noFields.statusCode, 400);
  const badJson = fakeRes();
  await withKey()({ method: "POST", body: "{nope" }, badJson);
  assert.equal(badJson.statusCode, 400);
  assert.equal(badJson.body.error, "bad_json");
  const method = fakeRes();
  await withKey()({ method: "GET" }, method);
  assert.equal(method.statusCode, 405);

  const denied = fakeRes();
  await withKey(authAs("triage"))({ method: "POST", body: { fields: { title: "Hi" } } }, denied);
  assert.equal(denied.statusCode, 403);

  const failed = fakeRes();
  await makeTranslate({ env: { GROQ_API_KEY: "g" }, auth: authAs("coordinator"), fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: "rate" } }) }) })({ method: "POST", body: { fields: { title: "Hi" } } }, failed);
  assert.equal(failed.statusCode, 502);
  assert.equal(failed.body.error, "translate_failed");
  assert.equal(failed.body.provider, "groq");

  const garbage = fakeRes();
  await makeTranslate({ env: { GROQ_API_KEY: "g" }, auth: authAs("owner"), fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: "no json here" } }] }) }) })({ method: "POST", body: { fields: { title: "Hi" } } }, garbage);
  assert.equal(garbage.statusCode, 502);
  assert.equal(garbage.body.error, "translate_unparseable");
});

// The desk map asks for every pinned report that matches the filters. It must
// never be paged: the desk once sent the list's offset with fields=map and the
// map came back empty as soon as the list had scrolled past the pinned rows.
test("reports with fields=map ignore offset and limit; the list keeps them", async () => {
  const calls = [];
  const sbRec = {
    from(table) {
      const q = { table, filters: [], range: null };
      const chain = {
        select: () => chain, order: () => chain, single: async () => ({ data: { total: 1 }, error: null }),
        range: (a, b) => { q.range = [a, b]; return chain; },
        in: (k, v) => { q.filters.push(["in", k, v]); return chain; },
        not: (k, op, v) => { q.filters.push(["not", k, op, v]); return chain; },
        lt: (k, v) => { q.filters.push(["lt", k, v]); return chain; },
        eq: (k, v) => { q.filters.push(["eq", k, v]); return chain; },
        or: (v) => { q.filters.push(["or", v]); return chain; },
        then: (ok) => { calls.push(q); return ok({ data: [{ ref: "GVF-2026-T4DG5", lat: 28.44, lng: 77.0, stage: 0 }], error: null, count: 1 }); }
      };
      return chain;
    }
  };
  let res = fakeRes();
  await makeReports({ auth: authAs("owner"), sb: sbRec })({ method: "GET", query: { fields: "map", stage: "open", offset: "2", limit: "50" } }, res);
  assert.equal(res.statusCode, 200);
  let q = calls.find((c) => c.table === "triage_reports");
  assert.deepEqual(q.range, [0, 999], "map: from the first row, up to 1000 pins");
  assert.ok(q.filters.some((f) => f[0] === "not" && f[1] === "lat"), "map: only pinned reports");
  assert.equal(res.body.reports.length, 1);

  calls.length = 0;
  res = fakeRes();
  await makeReports({ auth: authAs("owner"), sb: sbRec })({ method: "GET", query: { stage: "open", offset: "2", limit: "50" } }, res);
  q = calls.find((c) => c.table === "triage_reports");
  assert.deepEqual(q.range, [2, 51], "list: paged as asked");
});

// Join requests: owner and coordinator work them; the content team and ward
// volunteers never see who asked to join.
function joinsSb(rows) {
  const calls = [];
  const from = (table) => {
    const q = { table, op: "select", filters: [], row: null };
    const chain = {
      select: () => chain, order: () => chain, limit: () => chain,
      eq: (k, v) => { q.filters.push(["eq", k, v]); return chain; },
      or: (v) => { q.filters.push(["or", v]); return chain; },
      update: (row) => { q.op = "update"; q.row = row; return chain; },
      maybeSingle: async () => { calls.push(q); const r = rows.find((x) => q.filters.some((f) => f[0] === "eq" && f[1] === "id" && f[2] === x.id)); return { data: r ? { ...r, ...q.row } : null, error: null }; },
      then: (ok) => { calls.push(q); let out = rows; for (const f of q.filters) if (f[0] === "eq") out = out.filter((r) => r[f[1]] === f[2]); return ok({ data: out, error: null }); }
    };
    return chain;
  };
  return { from, calls };
}
const JOINS = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Asha", phone: "+919899999999", email: "asha@example.org", role: "Volunteer", area: "Sector 45", note: "Weekends", status: "new", notes: null, handled_by: null, created_at: "2026-10-08T05:00:00Z", updated_at: "2026-10-08T05:00:00Z" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Ravi", phone: "+919888888888", email: "ravi@example.org", role: "Youth fellow", area: null, note: null, status: "contacted", notes: "Called", handled_by: "T <owner@gvf.test>", created_at: "2026-10-07T05:00:00Z", updated_at: "2026-10-07T06:00:00Z" }
];

test("join requests: managers list them with counts, the rest are refused", async () => {
  for (const role of ["content", "triage"]) {
    const res = fakeRes();
    await makeJoins({ auth: authAs(role), sb: joinsSb(JOINS) })({ method: "GET", query: {} }, res);
    assert.equal(res.statusCode, 403, role);
  }
  for (const role of ["owner", "coordinator"]) {
    const res = fakeRes();
    await makeJoins({ auth: authAs(role), sb: joinsSb(JOINS) })({ method: "GET", query: {} }, res);
    assert.equal(res.statusCode, 200, role);
    assert.equal(res.body.joins.length, 2);
    assert.deepEqual(res.body.counts, { new: 1, contacted: 1, onboarded: 0, declined: 0, total: 2 });
  }
  const res = fakeRes();
  await makeJoins({ auth: authAs("owner"), sb: joinsSb(JOINS) })({ method: "GET", query: { status: "new" } }, res);
  assert.deepEqual(res.body.joins.map((j) => j.name), ["Asha"]);
  assert.equal(res.body.counts.total, 2, "counts cover every status");
  const csv = fakeRes();
  await makeJoins({ auth: authAs("coordinator"), sb: joinsSb(JOINS) })({ method: "GET", query: { format: "csv" } }, csv);
  assert.equal(csv.headers["Content-Type"], "text/csv; charset=utf-8");
  assert.ok(String(csv.body).includes('"Asha","+919899999999"'));
});

test("join requests: PATCH sets status and notes and records who did it", async () => {
  assert.deepEqual(STATUSES, ["new", "contacted", "onboarded", "declined"]);
  assert.deepEqual(validateJoinPatch({ status: "contacted" }), { value: { status: "contacted" }, errors: [] });
  assert.deepEqual(validateJoinPatch({ status: "lost" }).errors, ["status"]);
  assert.deepEqual(validateJoinPatch({}).errors, ["empty"]);
  assert.deepEqual(validateJoinPatch({ notes: "  " }), { value: { notes: null }, errors: [] });
  const sb = joinsSb(JOINS);
  const res = fakeRes();
  await makeJoins({ auth: authAs("coordinator"), sb })({ method: "PATCH", query: { id: JOINS[0].id }, body: { status: "contacted", notes: "Spoke on phone" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.join.status, "contacted");
  const up = sb.calls.find((q) => q.op === "update");
  assert.equal(up.row.status, "contacted");
  assert.equal(up.row.notes, "Spoke on phone");
  assert.equal(up.row.handled_by, "T <coordinator@gvf.test>");
  const missing = fakeRes();
  await makeJoins({ auth: authAs("owner"), sb })({ method: "PATCH", query: { id: "33333333-3333-4333-8333-333333333333" }, body: { status: "declined" } }, missing);
  assert.equal(missing.statusCode, 404);
  const bad = fakeRes();
  await makeJoins({ auth: authAs("owner"), sb })({ method: "PATCH", query: { id: JOINS[0].id }, body: { status: "nope" } }, bad);
  assert.equal(bad.statusCode, 400);
  const denied = fakeRes();
  await makeJoins({ auth: authAs("triage"), sb })({ method: "PATCH", query: { id: JOINS[0].id }, body: { status: "declined" } }, denied);
  assert.equal(denied.statusCode, 403);
});

test("the coordinator's join mail names the person and role, never phone or email", () => {
  const m = joinMail({ name: "Asha Verma", role: "Volunteer", area: "Sector 45", note: "Weekends only" }, "coord@example.org", { SITE_URL: "https://gvf.test" });
  assert.equal(m.to_email, "coord@example.org");
  assert.equal(m.kind, "join");
  assert.equal(m.subject, "New join request: Asha Verma (Volunteer)");
  assert.ok(m.body_text.includes("Sector 45") && m.body_text.includes("Weekends only") && m.body_text.includes("https://gvf.test/#/desk"));
  assert.ok(!/@example|\+91|\d{10}/.test(m.body_text.replace("coord@example.org", "")));
});

// ---------------------------------------------------------------------------
// Team roster, metrics, inbox: owner and coordinator only.
// ---------------------------------------------------------------------------
import { makeHandler as makeTeam, validateTeamPatch, WARD_ROLES } from "../../lib/handlers/triage/team.js";
import { makeHandler as makeMetrics } from "../../lib/handlers/triage/metrics.js";
import { makeHandler as makeInbox, validateInboxPatch } from "../../lib/handlers/triage/inbox.js";
import { buildBrief, idlePeople } from "../../lib/brief.js";

function teamSb({ staff = [], wv = [], assignments = [], ageing = [], activity = [], inbox = [] } = {}) {
  const calls = [];
  const tables = { staff, ward_volunteers: wv, ward_assignments: assignments, inbox };
  const from = (table) => {
    const q = { table, op: "select", filters: [], row: null };
    const chain = {
      select: () => chain, order: () => chain, limit: () => chain,
      eq: (k, v) => { q.filters.push(["eq", k, v]); return chain; },
      update: (row) => { q.op = "update"; q.row = row; return chain; },
      maybeSingle: async () => { calls.push(q); const rows = (tables[table] || []).filter((r) => q.filters.every((f) => r[f[1]] === f[2])); return { data: rows[0] ? { ...rows[0], ...(q.op === "update" ? q.row : {}) } : null, error: null }; },
      then: (ok) => { calls.push(q); const rows = (tables[table] || []).filter((r) => q.filters.every((f) => r[f[1]] === f[2])); return ok({ data: rows, error: null }); }
    };
    return chain;
  };
  const rpc = async (name, args) => { calls.push({ rpc: name, args }); if (name === "ward_ageing") return { data: ageing, error: null }; if (name === "staff_activity") return { data: activity, error: null }; if (name === "set_staff_wards") return { data: args.p_wards, error: null }; return { data: null, error: null }; };
  return { from, rpc, calls };
}
const U1 = "11111111-1111-4111-8111-111111111111", U2 = "22222222-2222-4222-8222-222222222222";
const STAFF = [
  { user_id: U1, name: "Asha", role: "coordinator", email: "asha@gvf.test", phone: "+919899999999", active: true, created_at: "2026-10-01T00:00:00Z" },
  { user_id: U2, name: "Ravi", role: "triage", email: "ravi@gvf.test", phone: null, active: true, created_at: "2026-10-02T00:00:00Z" }
];
const WV = [{ user_id: U1, ward: 1, role: "coordinator" }, { user_id: U1, ward: 2, role: "coordinator" }, { user_id: U2, ward: 1, role: "lead" }];

test("team roster: managers see people with their wards; others are refused", async () => {
  for (const role of ["content", "triage"]) {
    const res = fakeRes();
    await makeTeam({ auth: authAs(role), sb: teamSb({ staff: STAFF, wv: WV }) })({ method: "GET", query: {} }, res);
    assert.equal(res.statusCode, 403, role);
  }
  const res = fakeRes();
  await makeTeam({ auth: authAs("coordinator"), sb: teamSb({ staff: STAFF, wv: WV, assignments: [{ ward: 1, councillor: "X" }] }) })({ method: "GET", query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.people.find((p) => p.user_id === U1).wards, [{ ward: 1, role: "coordinator" }, { ward: 2, role: "coordinator" }]);
  assert.equal(res.body.people.find((p) => p.user_id === U2).phone, null);
  assert.equal(res.body.wards.length, 1);
});

test("team PUT validates and replaces a person's wards through set_staff_wards", async () => {
  assert.deepEqual(WARD_ROLES, ["coordinator", "lead", "support"]);
  assert.deepEqual(validateTeamPatch({ phone: "98993 75445" }).value, { phone: "+919899375445" });
  assert.deepEqual(validateTeamPatch({ phone: "12" }).errors, ["phone"]);
  assert.deepEqual(validateTeamPatch({ wards: [{ ward: 7, role: "lead" }, { ward: 7, role: "lead" }, { ward: 8, role: "support" }] }).wards, [{ ward: 7, role: "lead" }, { ward: 8, role: "support" }]);
  assert.deepEqual(validateTeamPatch({ wards: [{ ward: 40, role: "lead" }] }).errors, ["wards"]);
  assert.deepEqual(validateTeamPatch({ wards: [{ ward: 3, role: "boss" }] }).errors, ["wards"]);
  assert.deepEqual(validateTeamPatch({}).errors, ["empty"]);
  const sb = teamSb({ staff: STAFF, wv: WV });
  const res = fakeRes();
  await makeTeam({ auth: authAs("owner"), sb })({ method: "PUT", query: {}, body: { user_id: U2, phone: "9888888888", wards: [{ ward: 8, role: "lead" }, { ward: 9, role: "lead" }] } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const up = sb.calls.find((q) => q.table === "staff" && q.op === "update");
  assert.deepEqual(up.row, { phone: "+919888888888" });
  const rpc = sb.calls.find((q) => q.rpc === "set_staff_wards");
  assert.equal(rpc.args.p_user, U2);
  assert.deepEqual(rpc.args.p_wards, [{ ward: 8, role: "lead" }, { ward: 9, role: "lead" }]);
  assert.equal(rpc.args.p_by, "T <owner@gvf.test>");
  assert.deepEqual(res.body.person.wards, [{ ward: 8, role: "lead" }, { ward: 9, role: "lead" }]);
  const missing = fakeRes();
  await makeTeam({ auth: authAs("owner"), sb })({ method: "PUT", query: {}, body: { user_id: "33333333-3333-4333-8333-333333333333", phone: "9888888888" } }, missing);
  assert.equal(missing.statusCode, 404);
  const denied = fakeRes();
  await makeTeam({ auth: authAs("triage"), sb })({ method: "PUT", query: {}, body: { user_id: U2, active: false } }, denied);
  assert.equal(denied.statusCode, 403);
});

const AGEING = [
  { ward: 1, councillor: "Mahabir", open: 3, a0_3: 1, a4_7: 0, a8_21: 1, a22p: 1, unmapped: 1, overdue: 2, received_7d: 1, resolved_7d: 1, oldest_open_days: 30, last_activity_at: "2026-10-07T00:00:00Z" },
  { ward: 2, councillor: "Y", open: 0, a0_3: 0, a4_7: 0, a8_21: 0, a22p: 0, unmapped: 0, overdue: 0, received_7d: 0, resolved_7d: 2, oldest_open_days: 0, last_activity_at: null }
];
const ACTIVITY = [
  { user_id: U1, name: "Asha", email: "asha@gvf.test", phone: "+919899999999", role: "coordinator", active: true, wards: [{ ward: 1, role: "coordinator" }, { ward: 2, role: "coordinator" }], actions_7d: 0, actions_30d: 4, last_action_at: "2026-09-20T00:00:00Z", open_in_wards: 3, overdue_in_wards: 2 },
  { user_id: U2, name: "Ravi", email: "ravi@gvf.test", phone: null, role: "triage", active: true, wards: [{ ward: 1, role: "lead" }], actions_7d: 3, actions_30d: 5, last_action_at: "2026-10-07T00:00:00Z", open_in_wards: 3, overdue_in_wards: 2 }
];

test("metrics: totals, ageing, people and the brief; managers only", async () => {
  const denied = fakeRes();
  await makeMetrics({ auth: authAs("content"), sb: teamSb({ ageing: AGEING, activity: ACTIVITY }) })({ method: "GET", query: {} }, denied);
  assert.equal(denied.statusCode, 403);
  const res = fakeRes();
  await makeMetrics({ auth: authAs("owner"), sb: teamSb({ ageing: AGEING, activity: ACTIVITY }) })({ method: "GET", query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.totals, { open: 3, unmapped: 1, overdue: 2, received_7d: 1, resolved_7d: 3, a22p: 1 });
  assert.equal(res.body.wards.length, 2);
  assert.equal(res.body.people.length, 2);
  assert.ok(res.body.brief.text.includes("Ward 1 (Mahabir): 3 open, 2 overdue, 1 older than 21 d, oldest 30 d · coord Asha, lead Ravi"));
  assert.ok(res.body.brief.text.includes("No desk activity in 7 days (1): Asha (wards 1, 2)"));
  assert.deepEqual(res.body.brief.idle, [U1]);
});

test("buildBrief: the one-line version fits a WhatsApp template parameter and names idle people", () => {
  const b = buildBrief({ wards: AGEING, people: ACTIVITY, now: Date.parse("2026-10-08T02:30:00Z"), siteUrl: "https://gvf.test" });
  assert.equal(b.date, "8 Oct 2026");
  assert.ok(!/[\n\t]/.test(b.line) && b.line.length < 1000, b.line);
  assert.ok(b.line.startsWith("GVF 8 Oct 2026: open 3, unmapped 1, overdue 2, 21d+ 1; 7 days: 1 new, 3 resolved. Wards: W1 3 open/2 overdue. Idle 7 d: Asha."), b.line);
  assert.ok(b.text.endsWith("Full tracker: https://gvf.test/#/desk (Performance tab)."));
  assert.deepEqual(idlePeople(ACTIVITY).map((p) => p.name), ["Asha"]);
  const empty = buildBrief({ wards: [], people: [], now: 0 });
  assert.ok(empty.text.includes("No open reports in any ward.") && empty.line.includes("No open reports."));
});

test("inbox: list with counts, PATCH status and notes, managers only", async () => {
  const items = [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", source: "email", from_email: "r@example.org", from_name: "R", subject: "Pothole", body_text: "Hi", received_at: "2026-10-08T01:00:00Z", status: "new", notes: null, handled_by: null, updated_at: "2026-10-08T01:00:00Z" },
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", source: "email", from_email: "s@example.org", from_name: null, subject: "Thanks", body_text: "Done", received_at: "2026-10-07T01:00:00Z", status: "done", notes: "x", handled_by: "T", updated_at: "2026-10-07T02:00:00Z" }
  ];
  const denied = fakeRes();
  await makeInbox({ auth: authAs("triage"), sb: teamSb({ inbox: items }) })({ method: "GET", query: {} }, denied);
  assert.equal(denied.statusCode, 403);
  const res = fakeRes();
  await makeInbox({ auth: authAs("coordinator"), sb: teamSb({ inbox: items }) })({ method: "GET", query: { status: "new" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.items.map((i) => i.subject), ["Pothole"]);
  assert.deepEqual(res.body.counts, { new: 1, read: 0, done: 1, total: 2 });
  assert.deepEqual(validateInboxPatch({ status: "read" }).value, { status: "read" });
  assert.deepEqual(validateInboxPatch({ status: "spam" }).errors, ["status"]);
  const sb = teamSb({ inbox: items });
  const p = fakeRes();
  await makeInbox({ auth: authAs("owner"), sb })({ method: "PATCH", query: { id: items[0].id }, body: { status: "done", notes: "Called back" } }, p);
  assert.equal(p.statusCode, 200);
  assert.equal(p.body.item.status, "done");
  const up = sb.calls.find((q) => q.table === "inbox" && q.op === "update");
  assert.equal(up.row.notes, "Called back");
  assert.equal(up.row.handled_by, "T <owner@gvf.test>");
});
