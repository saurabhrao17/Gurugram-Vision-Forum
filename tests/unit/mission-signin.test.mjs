// Mission 2029 MP page, step 2: sign-in, roles and the empty private page. FAKE data only.
// Each test names the line of the voted brief ("How we will know it works", 1 to 10) it proves.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { resolve as routeResolve } from "../../api/index.js";
import { pageList } from "../../lib/seo/audit.js";
import { APP_META } from "../../lib/handlers/shell.js";
import { requireMember, memberFor, MISSION_ROLES } from "../../lib/mission-auth.js";
import { makeHandler as makeLogin } from "../../lib/handlers/mission/login.js";
import { makeHandler as makeRefresh } from "../../lib/handlers/mission/refresh.js";
import { makeHandler as makeMe } from "../../lib/handlers/mission/me.js";
import { makeHandler as makeWithdraw } from "../../lib/handlers/mission/withdraw.js";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const noComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

// ---- a fake world: tokens -> users, a mission_member table, a staff table (desk), one withdraw routine
const U = (id) => ({ id: "u-" + id, email: id + "@example.test" });
function world({ members = {}, staff = [] } = {}) {
  const rpcCalls = [];
  const sb = {
    auth: { getUser: async (tok) => (tok.startsWith("tok-") ? { data: { user: U(tok.slice(4)) }, error: null } : { data: null, error: { message: "bad" } }) },
    from(table) {
      assert.equal(table, "mission_member", "Mission code may only read mission_member");
      let id;
      const c = { select: () => c, eq: (_k, v) => { id = v; return c; }, maybeSingle: async () => ({ data: members["u-" + id.slice(2)] ? { user_id: id, ...members["u-" + id.slice(2)] } : members[id] ? { user_id: id, ...members[id] } : null, error: null }) };
      return c;
    },
    rpc: async (name, args) => {
      rpcCalls.push([name, args]);
      const m = members[args.p_user];
      if (m && m.active) { m.active = false; return { data: true, error: null }; }
      return { data: false, error: null };
    }
  };
  return { sb, rpcCalls, members, staff };
}
const W = () => world({ members: { "u-view": { role: "viewer", active: true }, "u-contrib": { role: "contributor", active: true }, "u-admin": { role: "admin", active: true }, "u-gone": { role: "admin", active: false }, "u-self": { role: "contributor", active: true }, "u-other": { role: "contributor", active: true } }, staff: ["u-deskowner"] });

function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: null };
  res.status = (s) => { res.statusCode = s; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; return res; };
  res.end = (b) => { try { res.body = JSON.parse(b); } catch { res.body = b; } };
  return res;
}
const bearer = (who) => ({ authorization: "Bearer tok-" + who });
async function call(handler, req) { const res = fakeRes(); await handler({ method: "GET", headers: {}, query: {}, ...req }, res); return res; }
const authClient = (users) => ({ auth: {
  signInWithPassword: async ({ email, password }) => { const u = users[email]; return u && u.password === password ? { data: { user: U(u.id), session: { access_token: "tok-" + u.id, refresh_token: "r-" + u.id, expires_at: 9999999999 } }, error: null } : { data: null, error: { message: "no" } }; },
  refreshSession: async ({ refresh_token }) => (refresh_token.startsWith("r-") ? { data: { user: U(refresh_token.slice(2)), session: { access_token: "tok-" + refresh_token.slice(2), refresh_token, expires_at: 9999999999 } }, error: null } : { data: null, error: { message: "no" } })
} });
const USERS = { "view@example.test": { id: "view", password: "pw" }, "admin@example.test": { id: "admin", password: "pw" }, "deskowner@example.test": { id: "deskowner", password: "pw" }, "gone@example.test": { id: "gone", password: "pw" }, "self@example.test": { id: "self", password: "pw" } };

// ---- brief lines 1, 2, 5: who may use each address
test("brief 1+2+5: requireMember refuses no token, a bad token, a non-member, a desk owner who is not a member, and an inactive member", async () => {
  const { sb } = W();
  const t = (who, roles) => requireMember({ headers: who ? bearer(who) : {} }, roles, { sb });
  await assert.rejects(t(null), { status: 401, code: "unauthenticated" });
  await assert.rejects(t("nobody-signed"), { status: 403, code: "not_member" }); // valid account, no member row
  await assert.rejects(t("deskowner"), { status: 403, code: "not_member" });    // the desk owner is not a Mission member
  await assert.rejects(t("gone"), { status: 403, code: "not_member" });         // switched off
  await assert.rejects(requireMember({ headers: { authorization: "Bearer junk" } }, null, { sb }), { status: 401 });
});
test("brief 5: each role is accepted where allowed and refused where not", async () => {
  const { sb } = W();
  for (const [who, role] of [["view", "viewer"], ["contrib", "contributor"], ["admin", "admin"]]) {
    const r = await requireMember({ headers: bearer(who) }, MISSION_ROLES, { sb });
    assert.equal(r.member.role, role);
  }
  await assert.rejects(requireMember({ headers: bearer("view") }, ["contributor", "admin"], { sb }), { status: 403, code: "forbidden" });
  await assert.rejects(requireMember({ headers: bearer("contrib") }, ["admin"], { sb }), { status: 403, code: "forbidden" });
  assert.equal((await requireMember({ headers: bearer("admin") }, ["admin"], { sb })).member.role, "admin");
  assert.deepEqual(MISSION_ROLES, ["viewer", "contributor", "admin"]);
});
test("a database error closes the door (never allows)", async () => {
  const sb = { auth: { getUser: async () => ({ data: { user: U("admin") }, error: null }) }, from: () => { const c = { select: () => c, eq: () => c, maybeSingle: async () => ({ data: null, error: { message: "down" } }) }; return c; } };
  await assert.rejects(requireMember({ headers: bearer("admin") }, null, { sb }), /lookup failed/);
  await assert.rejects(memberFor("x", sb), /lookup failed/);
});

test("brief 1+2+5: /api/mission/me: member 200 with the role only; non-member, desk owner and inactive 403; no token 401", async () => {
  const { sb } = W(); const me = makeMe({ sb });
  const ok = await call(me, { headers: bearer("view") });
  assert.equal(ok.statusCode, 200); assert.deepEqual(ok.body, { ok: true, member: { role: "viewer" } });
  assert.equal((await call(me, { headers: bearer("nobody-signed") })).statusCode, 403);
  const desk = await call(me, { headers: bearer("deskowner") });
  assert.equal(desk.statusCode, 403); assert.deepEqual(desk.body, { ok: false, error: "not_member" });
  assert.equal((await call(me, { headers: bearer("gone") })).statusCode, 403);
  assert.equal((await call(me, {})).statusCode, 401);
  assert.equal((await call(me, { method: "POST", headers: bearer("view") })).statusCode, 405);
});

test("brief 1+2+5: /api/mission/login gives a session only to an active member", async () => {
  const { sb } = W(); const login = makeLogin({ sb, authClient: authClient(USERS) });
  const post = (email, password) => call(login, { method: "POST", body: { email, password } });
  const ok = await post("admin@example.test", "pw");
  assert.equal(ok.statusCode, 200); assert.equal(ok.body.member.role, "admin"); assert.ok(ok.body.session.access_token);
  assert.equal((await post("admin@example.test", "wrong")).statusCode, 401);
  const desk = await post("deskowner@example.test", "pw");   // right password, desk owner, not a member
  assert.equal(desk.statusCode, 403); assert.equal(desk.body.error, "not_member"); assert.equal(desk.body.session, undefined);
  const gone = await post("gone@example.test", "pw");
  assert.equal(gone.statusCode, 403); assert.equal(gone.body.session, undefined);
  assert.equal((await post("not-an-email", "pw")).statusCode, 400);
  assert.equal((await post("admin@example.test", "")).statusCode, 400);
  assert.equal((await call(login, { method: "POST", body: null })).statusCode, 400);
  assert.equal((await call(login, { method: "GET" })).statusCode, 405);
});

test("brief 1+2+5: /api/mission/refresh keeps an active member signed in and refuses a switched-off one", async () => {
  const { sb, members } = W(); const refresh = makeRefresh({ sb, authClient: authClient(USERS) });
  const post = (t) => call(refresh, { method: "POST", body: { refresh_token: t } });
  const ok = await post("r-view"); assert.equal(ok.statusCode, 200); assert.equal(ok.body.member.role, "viewer");
  assert.equal((await post("junk")).statusCode, 401);
  assert.equal((await post("")).statusCode, 400);
  const desk = await post("r-deskowner"); assert.equal(desk.statusCode, 403); assert.equal(desk.body.session, undefined);
  members["u-view"].active = false;
  assert.equal((await post("r-view")).statusCode, 403);
  assert.equal((await call(refresh, { method: "GET" })).statusCode, 405);
});

// ---- brief 3: view-only sees no team data (step 2 has none; the guard and the shapes are what we can prove)
test("brief 3: step 2 returns no data to any role, only { member: { role } }, and a viewer is refused where roles exclude viewer", async () => {
  const { sb } = W();
  for (const who of ["view", "contrib", "admin"]) {
    const r = await call(makeMe({ sb }), { headers: bearer(who) });
    assert.deepEqual(Object.keys(r.body).sort(), ["member", "ok"]);
    assert.deepEqual(Object.keys(r.body.member), ["role"]);
  }
  await assert.rejects(requireMember({ headers: bearer("view") }, ["contributor", "admin"], { sb }), { code: "forbidden" });
});

// ---- brief 4: nothing kept
test("brief 4: every Mission response (success, refusal, error, wrong method) says no-store", async () => {
  const { sb } = W(); const ac = authClient(USERS);
  const cases = [
    [makeMe({ sb }), { headers: bearer("view") }], [makeMe({ sb }), {}], [makeMe({ sb }), { headers: bearer("deskowner") }], [makeMe({ sb }), { method: "POST" }],
    [makeLogin({ sb, authClient: ac }), { method: "POST", body: { email: "admin@example.test", password: "pw" } }], [makeLogin({ sb, authClient: ac }), { method: "POST", body: { email: "x@example.test", password: "no" } }], [makeLogin({ sb, authClient: ac }), { method: "GET" }],
    [makeRefresh({ sb, authClient: ac }), { method: "POST", body: { refresh_token: "r-admin" } }], [makeRefresh({ sb, authClient: ac }), { method: "POST", body: {} }],
    [makeWithdraw({ sb }), { method: "POST", headers: bearer("self") }], [makeWithdraw({ sb }), { method: "POST" }], [makeWithdraw({ sb }), { method: "GET" }],
    [makeMe({ sb: { auth: { getUser: async () => { throw new Error("boom"); } } } }), { headers: bearer("view") }]
  ];
  const quiet = console.error; console.error = () => {};
  try { for (const [h, req] of cases) { const r = await call(h, req); assert.match(r.headers["Cache-Control"], /no-store/); assert.equal(r.headers["Pragma"], "no-cache"); assert.equal(r.headers["Vary"], "Authorization"); } }
  finally { console.error = quiet; }
});
test("brief 4: the page script never writes an answer to storage (only the tab's own session and language) and every fetch is no-store", () => {
  const js = read("site/mission/mission.js");
  assert.doesNotMatch(js, /localStorage|indexedDB|caches\./);
  assert.match(js, /cache: "no-store"/);
  assert.match(js, /sessionStorage/);
});

// ---- brief 8: withdraw
test("brief 8: withdraw switches off only the caller, takes the id from the token, ignores any id in the body", async () => {
  const { sb, rpcCalls, members } = W(); const wd = makeWithdraw({ sb });
  const r = await call(wd, { method: "POST", headers: bearer("self"), body: { p_user: "u-other", user_id: "u-other" } });
  assert.equal(r.statusCode, 200); assert.deepEqual(r.body, { ok: true, withdrawn: true });
  assert.deepEqual(rpcCalls, [["mission_withdraw_self", { p_user: "u-self" }]]);
  assert.equal(members["u-self"].active, false);
  assert.equal(members["u-other"].active, true);
  assert.equal(members["u-admin"].active, true);
  // after withdrawing, the same token is refused everywhere
  assert.equal((await call(wd, { method: "POST", headers: bearer("self") })).statusCode, 403);
  assert.equal((await call(makeMe({ sb }), { headers: bearer("self") })).statusCode, 403);
  assert.equal(rpcCalls.length, 1);
});
test("brief 1+2+8: withdraw refuses a non-member, a desk owner who is not a member, no token, and a wrong method; a failed routine is a 500", async () => {
  const { sb, rpcCalls } = W(); const wd = makeWithdraw({ sb });
  assert.equal((await call(wd, { method: "POST", headers: bearer("deskowner") })).statusCode, 403);
  assert.equal((await call(wd, { method: "POST", headers: bearer("nobody-signed") })).statusCode, 403);
  assert.equal((await call(wd, { method: "POST" })).statusCode, 401);
  assert.equal((await call(wd, { method: "GET", headers: bearer("self") })).statusCode, 405);
  assert.equal(rpcCalls.length, 0);
  const bad = { ...sb, rpc: async () => ({ data: null, error: { message: "x" } }) };
  const quiet = console.error; console.error = () => {};
  try { assert.equal((await call(makeWithdraw({ sb: bad }), { method: "POST", headers: bearer("self") })).statusCode, 500); } finally { console.error = quiet; }
});

// ---- the four new addresses are in the router, and nothing else changed there
test("the router knows the four Mission addresses", () => {
  for (const p of ["login", "refresh", "me", "withdraw"]) assert.ok(routeResolve(["mission", p]), p);
  assert.equal(routeResolve(["mission", "other"]), null);
  assert.equal(routeResolve(["mission"]), null);
});

// ---- brief 6: walls
const MISSION_FILES = ["lib/mission-auth.js", ...walk("lib/handlers/mission"), ...walk("site/mission")];
const BANNED = /(mail|outbox|social|newsletter|audience|replies|reports?|visitors?|brief|inbound|notify|resend)(\.js)?["']/i;
test("brief 6: Mission code imports none of mail, outbox, social, newsletter, audience, replies, reports, visitor, brief code and never names /api/triage", () => {
  for (const f of MISSION_FILES) {
    const src = f.endsWith(".js") ? noComments(read(f)) : read(f);
    for (const m of src.matchAll(/(?:import\s[^;]*?from\s*|import\s*\(|require\s*\()\s*["']([^"']+)["']/g)) assert.doesNotMatch(m[1] + '"', BANNED, `${f} imports ${m[1]}`);
    assert.doesNotMatch(src, /\/api\/triage|triage\//, f);
    assert.doesNotMatch(src, /requireStaff|staffFor|from\("staff"\)|\.from\('staff'\)/, f + " touches the desk's sign-in");
    assert.doesNotMatch(src, /outbox|sendMail|nodemailer|RESEND|api\.resend|newsletter|subscribers?\b|\bvisitor_events\b|from\("reports"\)|\bsocial_posts\b/i, f);
  }
  // the only things Mission server code imports are the shared helpers
  for (const f of MISSION_FILES.filter((x) => x.endsWith(".js") && x.startsWith("lib/"))) {
    for (const m of noComments(read(f)).matchAll(/from\s*["']([^"']+)["']/g)) assert.match(m[1], /(^|\/)(supabase|auth|http|mission-auth)\.js$/, `${f} imports ${m[1]}`);
  }
});
test("the Mission handlers talk to the database only through mission_member and mission_withdraw_self", () => {
  const src = MISSION_FILES.filter((f) => f.startsWith("lib/")).map((f) => noComments(read(f))).join("\n");
  const froms = [...src.matchAll(/\.from\(\s*["'](\w+)["']/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(froms)], ["mission_member"]);
  const rpcs = [...src.matchAll(/\.rpc\(\s*["'](\w+)["']/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(rpcs)], ["mission_withdraw_self"]);
  assert.doesNotMatch(src, /\.(insert|update|upsert|delete)\(/);
});

// ---- brief 7: English and Hindi
const loadStrings = () => { const sb = { window: {} }; vm.runInNewContext(read("site/mission/strings.js"), sb); return sb.window.MISSION_STR; };
const LATIN_OK = new Set(["EN"]);
test("brief 7: every English string has a Hindi one, and Hindi has no Latin word except the allow-list", () => {
  const S = loadStrings();
  assert.deepEqual(Object.keys(S.hi).sort(), Object.keys(S.en).sort());
  for (const [k, v] of Object.entries(S.hi)) {
    assert.ok(v.trim(), k);
    for (const w of v.match(/[A-Za-z][A-Za-z']*/g) || []) assert.ok(LATIN_OK.has(w), `Hindi "${k}" has Latin word ${w}`);
  }
  for (const [k, v] of Object.entries(S.en)) if (!["langLabel", "pageTitle"].includes(k)) assert.doesNotMatch(v, /[ऀ-ॿ]/, `English "${k}" holds Hindi`);
  for (const k of ["signinTitle", "email", "password", "signin", "errBad", "errNotMember", "errNetwork", "errServer", "errInvalid", "withdraw", "confirmBody", "confirmYes", "cancel", "withdrawn", "signout", "role_viewer", "role_contributor", "role_admin"]) assert.ok(S.hi[k] && S.en[k], k);
});
test("brief 7: every key the page and the script use exists, and the page's English fallback text equals the dictionary", () => {
  const S = loadStrings(); const html = read("site/mission/index.html"); const js = read("site/mission/mission.js");
  for (const m of html.matchAll(/<([a-z0-9]+)[^>]*\sdata-m="(\w+)"[^>]*>([^<]*)</g)) { assert.ok(S.en[m[2]], m[2]); assert.equal(m[3].trim(), S.en[m[2]], `fallback text of ${m[2]}`); }
  for (const m of js.matchAll(/\bt\("(\w+)"|\bshowErr\("\w+", "(\w+)"|\bbusy\([^)]*?, "(\w+)"\)|\bout\("(\w+)"/g)) { m[1] = m[1] || m[2] || m[3] || m[4]; if (!m[1].endsWith("_")) assert.ok(S.en[m[1]], "script key " + m[1]); }
  for (const m of js.matchAll(/return "(err\w+)"/g)) assert.ok(S.en[m[1]], m[1]);
  for (const r of MISSION_ROLES) assert.ok(S.en["role_" + r] && S.hi["role_" + r], r);
  assert.equal(S.en.role_viewer, "View only");
});

// ---- brief 9: no visitor gate; the page's own head
test("brief 9: the page is its own file, noindex, same CSP, and loads none of app.js, data.js, boot.js, the service worker or the manifest", () => {
  const html = read("site/mission/index.html"); const site = read("site/index.html");
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  const csp = (h) => /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(h)[1];
  assert.equal(csp(html), csp(site));
  assert.doesNotMatch(html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ""), /app\.js|data\.js|boot\.js|manifest|sw\.js|serviceWorker|<script(?![^>]*\ssrc=)/i);
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(scripts, ["/mission/strings.js", "/mission/mission.js"]);
  assert.doesNotMatch(read("site/mission/mission.js"), /serviceWorker|GATE|visitor|gate/i);
  assert.doesNotMatch(html, /\son[a-z]+=|javascript:|<link[^>]+https?:\/\//i);
  assert.match(html, /<html lang="en">/); assert.match(html, /name="viewport"/);
  // labels tied to inputs, errors announced
  assert.match(html, /<label for="email"/); assert.match(html, /<label for="password"/);
  assert.match(html, /id="err"[^>]*role="alert"/);
});
test("the page names no political party and holds no email, phone or person's name", () => {
  for (const f of walk("site/mission")) {
    const src = read(f);
    assert.doesNotMatch(src, /\b(BJP|Bharatiya|Congress|INC|Aam Aadmi|AAP|JJP|INLD|party|पार्टी|दल)\b/i, f);
    assert.doesNotMatch(src, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\b[6-9]\d{9}\b/, f);
  }
});
test("the stylesheet keeps the Forum's rules: 44 px targets, visible focus, reduced motion, no saffron text", () => {
  const css = read("site/mission/mission.css");
  assert.match(css, /min-height:44px/); assert.match(css, /focus-visible/); assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /[^-]color:\s*var\(--saffron\)|[^-]color:\s*#FF9933/i);
});

// ---- brief 10: service worker
test("brief 10: sw.js skips /mission and /mission/*, and CACHE went from v22 to v23; no Mission file is pre-cached", () => {
  const sw = read("site/sw.js");
  assert.match(sw, /var CACHE = "gvf-shell-v23";/);
  assert.doesNotMatch(sw, /gvf-shell-v22/);
  assert.match(sw, /url\.pathname === "\/mission" \|\| url\.pathname\.indexOf\("\/mission\/"\) === 0\) return;/);
  // the skip comes before the first respondWith, so no branch can cache or answer it
  assert.ok(sw.indexOf('"/mission/"') < sw.indexOf("respondWith"));
  assert.match(sw, /var SHELL = \[[^\]]*\];/);
  assert.doesNotMatch(/var SHELL = \[([^\]]*)\]/.exec(sw)[1], /mission/i);
  // run the real fetch handler: a /mission navigation and its script get no response from the worker
  const handlers = {}; const ctx = { self: { location: { origin: "https://x.test" }, addEventListener: (n, f) => { handlers[n] = f; }, skipWaiting() {}, clients: { claim() {} } }, caches: { match: () => Promise.resolve(null), open: () => Promise.resolve({}) }, URL, Response: { error: () => null }, fetch: () => Promise.reject(new Error("offline")) };
  vm.runInNewContext(sw, ctx);
  for (const u of ["/mission", "/mission/", "/mission/mission.js", "/mission/mission.css"]) {
    let answered = false; ctx.fetch = () => { throw new Error("worker fetched " + u); }; handlers.fetch({ request: { method: "GET", url: "https://x.test" + u, mode: u.endsWith("/") || u === "/mission" ? "navigate" : "no-cors" }, respondWith: () => { answered = true; } });
    assert.equal(answered, false, u);
  }
  ctx.fetch = () => Promise.reject(new Error("offline"));
  let home = false; handlers.fetch({ request: { method: "GET", url: "https://x.test/rights", mode: "navigate" }, respondWith: () => { home = true; } });
  assert.equal(home, true, "other pages still go through the worker");
});

// ---- the page is in no public list
test("brief 9+10: /mission is in no robots file, sitemap list, app route list, page head list, nav or view list", () => {
  assert.ok(!pageList([], "https://x.test").some((p) => /mission/i.test(p.path)));
  assert.ok(!Object.keys(APP_META).some((k) => /mission/i.test(k)));
  for (const f of ["site/robots.txt", "site/index.html", "site/app.js", "site/boot.js", "site/data.js", "site/manifest.webmanifest", "vercel.json", "lib/handlers/sitemap.js", "lib/handlers/shell.js", "lib/handlers/llms.js", ...walk("lib/seo")]) assert.doesNotMatch(read(f), /\/mission\b/, f);
  assert.doesNotMatch(read("site/sw.js").split("\n").filter((l) => /SHELL/.test(l)).join("\n"), /mission/i);
});
test("no routing line was needed: vercel.json is unchanged by this step, and the page is a directory index Vercel and the smoke server can serve", () => {
  assert.ok(fs.existsSync(path.join(ROOT, "site/mission/index.html")));
  assert.doesNotMatch(read("vercel.json"), /\/mission|mission\//i);
});

// ---- the migration
test("migration 20261114010000: one security-definer function, empty search_path, only the service role may run it, nothing else touched", () => {
  const sql = read("supabase/migrations/20261114010000_mission_withdraw.sql");
  const code = sql.replace(/--[^\n]*/g, ""); const flat = code.replace(/\s+/g, " ");
  assert.equal([...flat.matchAll(/create (?:or replace )?function/gi)].length, 1);
  assert.match(flat, /create function public\.mission_withdraw_self\(p_user uuid\) returns boolean language plpgsql security definer set search_path = ''/);
  assert.match(flat, /revoke execute on function public\.mission_withdraw_self\(uuid\) from public, anon, authenticated;/);
  assert.match(flat, /grant execute on function public\.mission_withdraw_self\(uuid\) to service_role;/);
  assert.doesNotMatch(flat, /create table|alter table|drop |create policy|create trigger|truncate|delete from|insert into/i);
  assert.match(flat, /update public\.mission_member set active = false where user_id = p_user and active = true/);
  assert.match(sql, /ROLLBACK/);
  assert.ok("20261114010000" > "20261114000000");
});
test("the owner's doc: placeholders only, 'Create new user', never 'Send invitation' as the way, no real email", () => {
  const d = read("docs/mission-step2-owner-steps.md");
  assert.match(d, /Create new user/); assert.match(d, /<your-user-id>/);
  assert.match(d, /not "Send invitation"/);
  assert.doesNotMatch(d, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
});
