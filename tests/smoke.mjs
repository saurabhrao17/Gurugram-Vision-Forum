// Playwright smoke test for the GVF site. Run: node tests/smoke.mjs
// Uses the globally installed playwright if a local one is missing.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch { ({ chromium } = require(resolve(execSync("npm root -g").toString().trim(), "playwright"))); }

const url = pathToFileURL(resolve("site/index.html")).href;

// Serve site/ over http so the API wiring runs (it stays off under file://).
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
const server = http.createServer(async (req, res) => {
  const p = req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0];
  try {
    const body = await readFile(resolve("site" + p));
    res.writeHead(200, { "Content-Type": MIME[extname(p)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const httpUrl = `http://127.0.0.1:${server.address().port}/`;
const routes = ["", "report", "track", "directory", "rights", "who", "wards", "charter", "dashboard", "updates", "join", "about", "accessibility"];
let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log("  FAIL", msg); } else console.log("  ok  ", msg); };

const browser = await chromium.launch();
for (const vp of [{ w: 390, h: 844 }, { w: 1366, h: 860 }]) {
  console.log(`\nViewport ${vp.w}x${vp.h}`);
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  // Google Fonts are not reachable offline; ignore those network failures.
  page.on("requestfailed", (r) => { if (!/fonts\.g/.test(r.url())) errors.push("request failed: " + r.url()); });

  await page.goto(url);
  check((await page.locator("#tiles .tile").count()) === 17, "17 issue tiles on home");

  for (const r of routes) {
    await page.goto(url + "#/" + r);
    await page.waitForTimeout(60);
    const on = await page.locator("section.view.on").count();
    check(on === 1, `route #/${r} shows one view`);
  }

  // Tile selection opens the panel
  await page.goto(url + "#/fix/waste");
  await page.waitForTimeout(100);
  check(await page.locator("#panel.show").isVisible(), "#/fix/waste opens the result panel");

  // Report flow to a reference
  await page.goto(url + "#/report/waste");
  await page.waitForTimeout(100);
  check((await page.locator("#fCat").inputValue()) === "waste", "report form pre-fills the issue");
  await page.selectOption("#fScope", { index: 1 });
  await page.click('[data-go="2"]');
  await page.fill("#fWhere", "Sector 29");
  await page.selectOption("#fWard", "30");
  await page.fill("#fSpot", "Near the main gate");
  await page.click('[data-go="3"]');
  await page.fill("#fDesc", "Garbage not collected for four days.");
  await page.fill("#fName", "Test Reporter");
  await page.fill("#fPhone", "9999999999");
  await page.check("#fConsent");
  await page.click('[data-go="4"]');
  check((await page.locator("#summary .sl").count()) > 0 || (await page.locator("#summary").innerText()).includes("Sector 29"), "step 4 shows the summary");
  await page.click("#reportForm button[type=submit]");
  await page.waitForTimeout(100);
  const ref = (await page.locator("#confirm .ref").innerText()).trim();
  check(/^GVF-\d{4}-[A-Z2-9]{5}$/.test(ref), `confirmation shows a reference (${ref})`);

  // Track the reference
  await page.goto(url + "#/track/" + ref);
  await page.waitForTimeout(100);
  check((await page.locator("#trOut .tl li").count()) === 5, "track page shows the five stages");

  // Sheets
  await page.goto(url + "#/rights/rti");
  await page.waitForTimeout(100);
  check(await page.locator("#sheet.open").isVisible(), "rights sheet opens");
  await page.click("#sheetClose");
  await page.goto(url + "#/who/mcg");
  await page.waitForTimeout(100);
  check(await page.locator("#sheet.open").isVisible(), "role sheet opens");
  await page.click("#sheetClose");

  // Wards table
  await page.goto(url + "#/wards");
  await page.waitForTimeout(60);
  check((await page.locator("#wardBody tr").count()) === 36, "36 ward rows");

  // Search
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(60);
  await page.fill("#cmdIn", "cyber");
  await page.waitForTimeout(60);
  check((await page.locator("#cmdList li a").count()) >= 1, "search finds results for 'cyber'");
  await page.keyboard.press("Escape");

  // Theme and language toggles
  const themeBtn = vp.w < 1024 ? "#themeBtn2" : "#themeBtn";
  if (vp.w < 1024) { await page.goto(url + "#/"); await page.click("#menuBtn"); await page.waitForTimeout(60); }
  await page.click(themeBtn);
  check(["dark", "light"].includes(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))), "theme toggle sets data-theme");
  const langBtn = vp.w < 1024 ? "#langBtn2" : "#langBtn";
  await page.click(langBtn);
  await page.waitForTimeout(60);
  check((await page.evaluate(() => document.documentElement.lang)) === "hi", "Hindi toggle switches <html lang>");

  check(errors.length === 0, "zero console or page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
// ---- API wiring over http with mocked endpoints ----
{
  console.log("\nAPI wiring (mocked /api over http, 390x844)");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  // The mocked API deliberately answers 404, 429 and aborted requests; the browser logs those as resource errors.
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  const calls = [];
  let reportMode = "ok";
  await page.route("**/api/report", async (route) => {
    calls.push(JSON.parse(route.request().postData() || "{}"));
    if (reportMode === "down") return route.abort();
    if (reportMode === "limit") return route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ ok: false, error: "too_many_reports" }) });
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, ref: "GVF-2026-SRV01", stage: 0, created_at: "2026-10-07T10:00:00Z" }) });
  });
  await page.route("**/api/status**", async (route) => {
    const u = new URL(route.request().url());
    if (u.searchParams.get("ref") === "GVF-2026-SRV01" && u.searchParams.get("last4") === "9999") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, report: {
        ref: "GVF-2026-SRV01", issue_type: "waste", area: "Sector 29", ward: 30, stage: 2, desk: "MCG sanitation wing",
        official_ticket: "GMDA-4471", created_at: "2026-10-07T10:00:00Z", updated_at: "2026-10-09T10:00:00Z",
        events: [{ stage: 0, at: "2026-10-07T10:00:00Z" }, { stage: 1, at: "2026-10-08T10:00:00Z" }, { stage: 2, at: "2026-10-09T10:00:00Z" }] } }) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: "not_found" }) });
  });
  let dashMode = "unpublished";
  await page.route("**/api/dashboard", async (route) => {
    if (dashMode === "unpublished") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, published: false, publish_at: 50, total: 12, updated_at: "2026-10-07T10:00:00Z" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, published: true, publish_at: 50, total: 61, updated_at: "2026-11-01T10:00:00Z", source: "Gurugram Vision Forum case system",
      summary: { total: 61, received: 10, filed: 30, escalated: 6, resolved: 15, mapped_in_3_days_pct: 92, acted_in_21_days_pct: 71, computed_at: "2026-11-01T10:00:00Z" },
      by_issue: [{ issue_type: "waste", label: "Garbage", received: 4, filed: 12, escalated: 3, resolved: 8, total: 27 }, { issue_type: "roads", label: "Roads, footpaths", received: 6, filed: 18, escalated: 3, resolved: 7, total: 34 }],
      by_ward: [] }) });
  });
  await page.route("**/api/join", (route) => route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true }) }));

  const fillReport = async () => {
    await page.goto(httpUrl + "#/report");
    await page.waitForTimeout(100);
    await page.selectOption("#fCat", "waste");
    await page.selectOption("#fScope", { index: 1 });
    await page.click('[data-go="2"]');
    await page.fill("#fWhere", "Sector 29");
    await page.selectOption("#fWard", "30");
    await page.fill("#fSpot", "Near the main gate");
    await page.click('[data-go="3"]');
    await page.fill("#fDesc", "Garbage not collected for four days.");
    await page.fill("#fName", "Test Reporter");
    await page.fill("#fPhone", "9899 999999");
    await page.check("#fConsent");
    await page.click('[data-go="4"]');
    // Hide the previous confirmation so the wait below sees the new one.
    await page.evaluate(() => document.getElementById("confirm").classList.remove("show"));
    await page.click("#reportForm button[type=submit]");
    await page.waitForSelector("#confirm.show");
  };

  await fillReport();
  check((await page.locator("#confirm .ref").innerText()).trim() === "GVF-2026-SRV01", "report uses the server reference");
  check(calls[0] && calls[0].issue_type === "waste" && calls[0].ward === "30" && calls[0].consent === true && calls[0].phone === "9899 999999", "report posts the expected payload");
  check((await page.locator("#confirm .err").count()) === 0, "no offline notice when the server answered");

  reportMode = "down";
  await fillReport();
  check(/^GVF-\d{4}-[A-Z2-9]{5}$/.test((await page.locator("#confirm .ref").innerText()).trim()), "falls back to a local reference when the API is down");
  check((await page.locator("#confirm .err.show").count()) === 1, "shows the saved-on-this-device notice when the API is down");

  reportMode = "limit";
  await fillReport();
  check((await page.locator("#confirm .err.show").innerText()).includes("Too many reports"), "shows the rate-limit notice on 429");

  // Track: server record wins and shows dates
  await page.goto(httpUrl + "#/track");
  await page.fill("#trRef", "gvf-2026-srv01");
  await page.fill("#trLast4", "9999");
  await page.click("#trGo");
  await page.waitForTimeout(150);
  check((await page.locator("#trOut .tl li.now b").innerText()).includes("Filed officially"), "track shows the server stage (Filed officially)");
  check((await page.locator("#trOut").innerText()).includes("GMDA-4471"), "track shows the official ticket number");
  await page.fill("#trLast4", "0000");
  await page.click("#trGo");
  await page.waitForTimeout(150);
  check((await page.locator("#trOut").innerText()).includes("No report matches"), "track refuses a wrong last-4");
  await page.fill("#trRef", "GVF-2026-NOWHR");
  await page.fill("#trLast4", "");
  await page.click("#trGo");
  await page.waitForTimeout(100);
  check((await page.locator("#trOut").innerText()).includes("last 4 digits"), "track asks for the last 4 when missing");

  // Dashboard: unpublished shows the running total only; published renders live rows
  await page.goto(httpUrl + "#/dashboard");
  await page.waitForTimeout(200);
  check((await page.locator("#kpis").innerText()).includes("—"), "dashboard hides KPIs before 50 reports");
  check((await page.locator("#dashBody").innerText()).includes("received 12 so far"), "dashboard shows the running total before publishing");
  dashMode = "published";
  await page.goto(httpUrl + "#/");
  await page.evaluate(() => { location.hash = "#/dashboard"; });
  await page.reload();
  await page.waitForTimeout(250);
  check((await page.locator("#kpis .kpi b").first().innerText()) === "61", "published dashboard shows live KPIs");
  check((await page.locator("#dashBody").innerText()).includes("92% on time"), "published dashboard shows commitment actuals");
  check((await page.locator("#dashBody .bar").count()) === 2, "published dashboard draws one bar per cause");
  check((await page.locator("#sampleBtn").count()) === 0, "published dashboard has no sample toggle");

  // Join posts to the API
  await page.goto(httpUrl + "#/join");
  await page.fill("#jName", "Test Volunteer");
  await page.fill("#jPhone", "9899999999");
  await page.fill("#jEmail", "t@example.org");
  await page.click("#joinForm button[type=submit]");
  await page.waitForSelector("#jConfirm.show");
  check((await page.locator("#jConfirm").innerText()).includes("Thank you, Test"), "join form confirms after posting");
  check((await page.locator("#jConfirm .err").count()) === 0, "join form shows no offline notice when the server answered");

  check(errors.length === 0, "zero console or page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

// ---- Volunteer desk (triage.html) with mocked /api/triage ----
{
  console.log("\nVolunteer desk (mocked /api/triage over http, 1366x860)");
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  const session = { access_token: "tok", refresh_token: "ref", expires_at: 9999999999 };
  const staff = { user_id: "u1", name: "Coordinator", role: "coordinator", email: "coord@example.org" };
  const report = (over) => Object.assign({ ref: "GVF-2026-SRV01", issue_type: "waste", issue_label: "Garbage", affects: "My society or RWA", area: "Sector 29", ward: 30, councillor: "Madhu Batra", spot: "Near the gate", lat: null, lng: null,
    stage: 0, desk: null, official_channel: null, official_ticket: null, official_filed_at: null, escalated_to: null, resolved_at: null, resolution_note: null, source: "web",
    reporter_name: "Test Reporter", reporter_phone: "+919899999999", reporter_email: null, consent_at: "2026-10-07T10:00:00Z", description: "Garbage not collected.",
    created_at: "2026-10-07T10:00:00Z", updated_at: "2026-10-07T10:00:00Z", unmapped_overdue: false, filed_overdue: false, events_count: 1, last_event_at: "2026-10-07T10:00:00Z" }, over);
  let events = [{ stage: 0, note: "Report received", actor: "system", created_at: "2026-10-07T10:00:00Z" }];
  let state = report();
  const patches = [];
  const authed = (route) => (route.request().headers()["authorization"] || "") === "Bearer tok";
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/triage/login", (route) => {
    const b = JSON.parse(route.request().postData() || "{}");
    return b.password === "secret-pass" ? json(route, 200, { ok: true, session, staff }) : json(route, 401, { ok: false, error: "bad_credentials" });
  });
  await page.route("**/api/triage/reports?**", (route) => authed(route) ? json(route, 200, { ok: true, reports: [state, report({ ref: "GVF-2026-OLD02", stage: 0, created_at: "2026-09-20T10:00:00Z", unmapped_overdue: true })], total: 2, offset: 0, limit: 50,
    summary: { total: 2, received: 2, filed: 0, escalated: 0, resolved: 0, unmapped_past_due: 1, filed_past_due: 0 } }) : json(route, 401, { ok: false, error: "unauthenticated" }));
  await page.route("**/api/triage/reports/GVF-2026-SRV01", (route) => {
    if (!authed(route)) return json(route, 401, { ok: false, error: "unauthenticated" });
    if (route.request().method() === "PATCH") {
      const p = JSON.parse(route.request().postData() || "{}"); patches.push(p);
      state = report({ stage: p.official_ticket ? 2 : (p.stage ?? state.stage), desk: p.desk ?? state.desk, official_ticket: p.official_ticket ?? state.official_ticket, official_channel: p.official_channel ?? state.official_channel, events_count: 3 });
      events = events.concat([{ stage: 2, note: "Filed officially, ticket " + p.official_ticket, actor: "Coordinator <coord@example.org>", created_at: "2026-10-08T10:00:00Z" }, { stage: 2, note: p.note, actor: "Coordinator <coord@example.org>", created_at: "2026-10-08T10:00:01Z" }]);
    }
    return json(route, 200, { ok: true, report: state, events });
  });
  await page.route("**/api/triage/staff", (route) => json(route, 200, { ok: true, staff: [staff, { user_id: "u2", name: "Vol One", role: "triage", email: "vol@example.org" }] }));

  await page.goto(httpUrl + "triage.html");
  check(await page.locator("#v-login.on").isVisible(), "desk starts on the sign-in form");
  await page.fill("#lEmail", "coord@example.org");
  await page.fill("#lPass", "wrong");
  await page.click("#lBtn");
  await page.waitForTimeout(150);
  check((await page.locator("#lErr").innerText()).includes("Wrong email or password"), "wrong password shows an error");
  await page.fill("#lPass", "secret-pass");
  await page.click("#lBtn");
  await page.waitForSelector("#v-desk.on");
  await page.waitForTimeout(200);
  check((await page.locator("#whoAmI").innerText()).includes("Coordinator"), "header shows who is signed in");
  check((await page.locator("#tList .row").count()) === 2, "list shows two reports");
  check((await page.locator("#tList .tag-danger").count()) === 1, "overdue report carries a past-due flag");
  check((await page.locator("#tSummary").innerText()).includes("past due: 1 unmapped"), "summary line shows the counts");
  check(!(await page.locator("#teamTab").isHidden()), "coordinator sees the Team tab");

  await page.click('[data-open="GVF-2026-SRV01"]');
  await page.waitForSelector("#editForm");
  check((await page.locator("#sheetBody").innerText()).includes("Test Reporter"), "detail shows the reporter to signed-in staff");
  check((await page.locator("#sheetBody .tl li").count()) === 1, "detail shows the event timeline");
  await page.fill("#eDesk", "MCG sanitation wing");
  await page.selectOption("#eChan", "GMDA portal");
  await page.fill("#eTicket", "GMDA-4471");
  await page.fill("#eNote", "Filed on the portal.");
  await page.click("#eSave");
  await page.waitForTimeout(250);
  check(patches.length === 1 && patches[0].desk === "MCG sanitation wing" && patches[0].official_ticket === "GMDA-4471" && patches[0].official_channel === "GMDA portal" && patches[0].note === "Filed on the portal." && !("stage" in patches[0]), "save sends only the changed fields");
  check((await page.locator("#sheetBody .tl li").count()) === 3, "timeline refreshes after saving");
  check((await page.locator("#row_GVF-2026-SRV01 .tag").first().innerText()).includes("Filed officially"), "list row updates to the new stage");
  await page.click("#sheetClose");

  await page.click('[data-tab="team"]');
  await page.waitForTimeout(150);
  check((await page.locator("#staffList .row").count()) === 2, "team tab lists the accounts");
  check((await page.locator("#staffList [data-remove]").count()) === 0, "coordinator cannot remove accounts");

  await page.click("#signOut");
  await page.waitForTimeout(100);
  check(await page.locator("#v-login.on").isVisible(), "sign out returns to the sign-in form");
  check((await page.evaluate(() => localStorage.getItem("gvf_staff"))) === null, "sign out clears the stored session");

  check(errors.length === 0, "zero console or page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
