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
  let p = req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0];
  if (!extname(p) && !p.startsWith("/api/")) p = "/index.html"; else if (extname(p)) p = "/" + p.split("/").pop();
  try {
    const body = await readFile(resolve("site" + p));
    res.writeHead(200, { "Content-Type": MIME[extname(p)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const httpUrl = `http://127.0.0.1:${server.address().port}/`;
const routes = ["", "report", "track", "directory", "rights", "who", "wards", "charter", "dashboard", "updates", "join", "about", "accessibility", "privacy", "map", "news"];

// Latin tokens that are allowed to remain in Hindi mode: agency acronyms, product names, codes.
const LATIN_OK = new Set("GMDA MCG DHBVN HRERA DTCP HSVP HSPCB NHAI CAQM CPGRAMS HERC GRAP RERA RWA UPI FIR AQI PIO BPL ECI MPLADS MoSPI CPCB SDM DC OneMap GGM Daakhil Sameer myGurugram Swachhata Saral MyGov RTI NH GVF EN WCAG WhatsApp MLA MP MC Manesar ULB HSIIDC HUDA IC PDF MB NCR Lok Sabha SMS ID OTP JJP INLD AAP BJP INC CSR DLF SPR MG HSVP MCG NIT DMRC RRTS CM Window ABCDE HTML Haryana Online Form Zero GIS".split(" "));
function latinWords(text) {
  const t = String(text).replace(/\S+@\S+/g, " ").replace(/https?:\/\/\S+|www\.\S+/g, " ").replace(/GVF-\d{4}-[A-Z0-9]{5}/g, " ").replace(/\S+\.(gov|nic|org|com|in)(\.in)?(\/\S*)?/g, " ");
  return (t.match(/[A-Za-z][A-Za-z'’]{2,}/g) || []).filter((w) => !LATIN_OK.has(w) && !LATIN_OK.has(w.replace(/[’'].*$/, "")));
}
const DEVANAGARI = /[\u0900-\u097F]/;
let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log("  FAIL", msg); } else console.log("  ok  ", msg); };

const browser = await chromium.launch();
for (const vp of [{ w: 390, h: 844 }, { w: 1366, h: 860 }]) {
  console.log(`\nViewport ${vp.w}x${vp.h}`);
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
  await ctx.addInitScript(() => { try { if (!localStorage.getItem("gvf_visitor")) localStorage.setItem("gvf_visitor", JSON.stringify({ token: "smoke_visitor_token_0001", done: true, views: 9 })); } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  // Google Fonts and the map library are not reachable offline; ignore those network failures.
  page.on("requestfailed", (r) => { if (!/fonts\.g|unpkg\.com|openstreetmap/.test(r.url())) errors.push("request failed: " + r.url()); });

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
  check(!(await page.locator("#filingBox").isHidden()) && (await page.locator("#filingTitle").innerText()).includes("GMDA"), "step 3 shows what the official portal needs for the issue");
  check((await page.locator("#filingFields select[data-x=where]").count()) === 1 && (await page.locator("#filingFields input[type=file][data-doc=photo]").count()) === 1, "filing box lists the portal's fields and documents");
  await page.selectOption("#filingFields select[data-x=where]", "Street or lane");
  await page.fill("#fDesc", "Garbage not collected for four days.");
  await page.fill("#fName", "Test Reporter");
  await page.fill("#fPhone", "9999999999");
  await page.fill("#fEmail", "test@example.org");
  await page.fill("#fPincode", "122001");
  await page.check("#fConsent");
  await page.click('[data-go="4"]');
  check((await page.locator("#summary .sl").count()) > 0 || (await page.locator("#summary").innerText()).includes("Sector 29"), "step 4 shows the summary");
  await page.click("#reportForm button[type=submit]");
  await page.waitForTimeout(100);
  const ref = (await page.locator("#confirm .ref").innerText()).trim();
  check(/^GVF-\d{4}-[A-Z2-9]{5}$/.test(ref), `confirmation shows a reference (${ref})`);
  check((await page.locator("#confirm .notice").innerText()).includes("Photo of the garbage"), "confirmation lists what is still needed for the official filing");

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
  await page.keyboard.press("Escape");

  // Hindi mode: every public view, panel and sheet must read in Hindi (acronyms and codes aside)
  const hiRoutes = routes.concat(["fix/waste", "rights/rts", "who/mp", "updates/complaint-that-gets-acted-on", "r/GVF-2026-SRV01"]);
  const visibleText = () => page.evaluate(() => {
    const parts = [document.querySelector("header"), document.querySelector("section.view.on"), document.querySelector("footer"), document.querySelector("#sheet.open"), document.querySelector("#panel.show")];
    return parts.filter(Boolean).map((el) => el.innerText).join("\n");
  });
  for (const r of hiRoutes) {
    await page.goto(url + "#/" + r);
    await page.waitForTimeout(120);
    if (r === "report") { await page.selectOption("#fCat", "waste"); await page.selectOption("#fScope", { index: 1 }); await page.click('[data-go="2"]'); await page.fill("#fWhere", "सेक्टर 29"); await page.fill("#fSpot", "गेट के पास"); await page.click('[data-go="3"]'); await page.waitForTimeout(80); }
    const txt = await visibleText();
    if (r === "report") { await page.click('.fstep.on [data-go="2"]'); await page.click('.fstep.on [data-go="1"]'); await page.waitForTimeout(40); }
    const latin = latinWords(txt);
    check(DEVANAGARI.test(txt) && latin.length === 0, `#/${r || ""} reads in Hindi` + (latin.length ? " (English left: " + [...new Set(latin)].slice(0, 12).join(", ") + ")" : ""));
  }
  check(await page.evaluate(() => document.title.includes("गुरुग्राम")), "document title is in Hindi");
  await page.goto(url + "#/report");
  await page.waitForTimeout(100);
  check((await page.locator("#areaList option").first().getAttribute("value")) === "सेक्टर 1", "area suggestions are in Hindi");
  await page.selectOption("#fCat", "waste");
  await page.waitForTimeout(60);
  check((await page.locator("#filingFields select[data-x=where] option").nth(1).getAttribute("value")) === "Street or lane" && DEVANAGARI.test(await page.locator("#filingFields select[data-x=where] option").nth(1).innerText()), "filing options show Hindi but keep English values");
  await page.goto(url + "#/wards");
  await page.fill("#wardSearch", "यादव");
  await page.waitForTimeout(60);
  check((await page.locator("#wardBody tr").count()) > 0 && !(await page.locator("#wardBody tr td").first().innerText()).includes("No ward"), "ward search works with Hindi names");
  await page.fill("#wardSearch", "");

  // Back to English: nothing Devanagari remains except the language toggle itself
  await page.keyboard.press("Escape");
  await page.goto(url + "#/");
  await page.waitForTimeout(80);
  if (vp.w < 1024) { await page.click("#menuBtn"); await page.waitForTimeout(60); }
  await page.click(langBtn);
  await page.waitForTimeout(80);
  await page.keyboard.press("Escape");
  check((await page.evaluate(() => document.documentElement.lang)) === "en", "toggle returns to English");
  for (const r of ["", "directory", "rights", "wards", "join"]) {
    await page.goto(url + "#/" + r);
    await page.waitForTimeout(80);
    const txt = (await visibleText()).replace(/हिं/g, "");
    check(!DEVANAGARI.test(txt), `#/${r} reads in English again`);
  }
  check((await page.locator("#tiles .tile").first().innerText()).trim() === "Roads, footpaths", "tiles are English again");

  check(errors.length === 0, "zero console or page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
// ---- API wiring over http with mocked endpoints ----
{
  console.log("\nAPI wiring (mocked /api over http, 390x844)");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => { try { if (!localStorage.getItem("gvf_visitor")) localStorage.setItem("gvf_visitor", JSON.stringify({ token: "smoke_visitor_token_0001", done: true, views: 9 })); } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  // The mocked API deliberately answers 404, 429 and aborted requests; the browser logs those as resource errors.
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  const calls = [];
  const uploadCalls = [];
  const attachCalls = [];
  let reportMode = "ok";
  await page.route("**/api/report", async (route) => {
    calls.push(JSON.parse(route.request().postData() || "{}"));
    if (reportMode === "down") return route.abort();
    if (reportMode === "limit") return route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ ok: false, error: "too_many_reports" }) });
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, ref: "GVF-2026-SRV01", stage: 0, created_at: "2026-10-07T10:00:00Z", upload_token: "a".repeat(48) }) });
  });
  await page.route("**/api/report/upload-url", async (route) => {
    const b = JSON.parse(route.request().postData() || "{}"); uploadCalls.push(b);
    const uploads = (b.files || []).map((f, i) => ({ url: httpUrl + "/_up/" + i, path: "GVF-2026-SRV01/1-" + i + "-" + f.name, name: f.name, size: f.size, type: f.type, kind: f.kind }));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, uploads }) });
  });
  await page.route("**/_up/**", (route) => route.fulfill({ status: 200, body: "" }));
  await page.route("**/api/report/attach", async (route) => {
    const b = JSON.parse(route.request().postData() || "{}"); attachCalls.push(b);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, attached: (b.files || []).length }) });
  });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
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
  const visitorCalls = [];
  await page.route("**/api/visitor", (route) => { try { visitorCalls.push(JSON.parse(route.request().postData() || "{}")); } catch { visitorCalls.push({ raw: true }); } return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }); });
  const samplePosts = [
    { id: "p1", kind: "story", slug: "sewa-drive-sector-45-ab12c", title: "Sewa drive cleans Sector 45 park", title_hi: "सेक्टर 45 पार्क की सफ़ाई", summary: "Forty volunteers, two tonnes of waste.", body: "<p>Forty volunteers joined on Sunday.</p>", source: "Forum team", published: true, published_at: "2026-10-07T06:00:00Z", pinned: false, tags: ["sewa"] },
    { id: "p2", kind: "popup", slug: "townhall-ab12d", title: "First townhall on 20 October", summary: "Sector 29 community centre, 6 pm.", link_url: "https://example.org/townhall", published: true, published_at: "2026-10-07T06:00:00Z", pinned: true, starts_at: null, ends_at: null },
    { id: "p3", kind: "social", slug: "x-post-ab12e", title: "Our first post on X", summary: "Follow along.", embed_url: "https://x.com/gvf/status/1", published: true, published_at: "2026-10-06T06:00:00Z" },
    { id: "p4", kind: "testimonial", slug: "voice-ab12f", title: "Resident voice", summary: "The pothole was fixed in a week.", quote_by: "Resident, Sector 10", published: true, published_at: "2026-10-05T06:00:00Z" }
  ];
  await page.route("**/api/content**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, posts: samplePosts, settings: { social: { x: "https://x.com/gvf", facebook: "", instagram: "", youtube: "", whatsapp: "" } } }) }));
  await page.route("**/api/news**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, items: [{ title: "Public notice: water supply schedule", url: "https://www.gmda.gov.in/notice/1", published_at: "2026-10-07T04:00:00Z", fetched_at: "2026-10-07T05:00:00Z", source_id: "gmda", source_name: "GMDA", home: "https://www.gmda.gov.in/" }, { title: "Ward committee meetings announced", url: "https://www.mcg.gov.in/news/2", published_at: "2026-10-06T04:00:00Z", fetched_at: "2026-10-07T05:00:00Z", source_id: "mcg", source_name: "MCG", home: "https://www.mcg.gov.in/" }], sources: [{ id: "gmda" }, { id: "mcg" }] }) }));
  const follows = [];
  await page.route("**/api/follow", (route) => { follows.push(JSON.parse(route.request().postData() || "{}")); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }); });
  await page.route("**/api/public/report?**", (route) => {
    const ref = new URL(route.request().url()).searchParams.get("ref");
    if (ref !== "GVF-2026-SRV01") return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: "not_found" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, report: { ref, issue_type: "waste", issue_label: "Garbage", area: "Sector 29", ward: 30, stage: 2, created_at: "2026-10-07T10:00:00Z", official_filed_at: "2026-10-09T10:00:00Z", resolved_at: null, desk: "MCG sanitation wing", official_channel: "GMDA portal", lat: 28.46, lng: 77.07, source: "web",
      events: [{ stage: 0, created_at: "2026-10-07T10:00:00Z" }, { stage: 1, created_at: "2026-10-08T10:00:00Z" }, { stage: 2, created_at: "2026-10-09T10:00:00Z" }], followers: 3 } }) });
  });
  await page.route("**/api/public/reports**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, reports: [{ ref: "GVF-2026-SRV01", issue_type: "waste", stage: 2, ward: 30, lat: 28.46, lng: 77.07, created_at: "2026-10-07T10:00:00Z" }], counts: { total: 5, with_location: 1 }, computed_at: "2026-10-07T10:00:00Z" }) }));
  await page.route("**/api/ward**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, ward: 30, source: "table" }) }));
  await page.route("**/api/geocode**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, results: [{ name: "Sector 29, Gurugram", lat: 28.46, lng: 77.07 }] }) }));

  const fillReport = async (withFile) => {
    await page.goto(httpUrl + "#/report");
    await page.waitForTimeout(100);
    await page.selectOption("#fCat", "waste");
    await page.selectOption("#fScope", { index: 1 });
    await page.click('[data-go="2"]');
    await page.fill("#fWhere", "Sector 29");
    await page.locator("#fWhere").dispatchEvent("change");
    await page.waitForTimeout(400);
    await page.fill("#fSpot", "Near the main gate");
    await page.click('[data-go="3"]');
    await page.selectOption("#filingFields select[data-x=where]", "Street or lane");
    if (withFile) await page.setInputFiles("#filingFields input[type=file][data-doc=photo]", { name: "spot.png", mimeType: "image/png", buffer: png });
    await page.fill("#fDesc", "Garbage not collected for four days.");
    await page.fill("#fName", "Test Reporter");
    await page.fill("#fPhone", "9899 999999");
    await page.fill("#fEmail", "test@example.org");
    await page.fill("#fPincode", "122001");
    await page.check("#fConsent");
    await page.click('[data-go="4"]');
    // Hide the previous confirmation so the wait below sees the new one.
    await page.evaluate(() => document.getElementById("confirm").classList.remove("show"));
    await page.click("#reportForm button[type=submit]");
    await page.waitForSelector("#confirm.show");
  };

  await fillReport(true);
  check((await page.locator("#confirm .ref").innerText()).trim() === "GVF-2026-SRV01", "report uses the server reference");
  check(calls[0] && calls[0].extra && calls[0].extra.where === "Street or lane", "portal fields travel with the report as extra");
  await page.waitForFunction(() => /attached/.test((document.getElementById("upStatus") || {}).textContent || ""), null, { timeout: 5000 }).catch(() => {});
  check(uploadCalls.length === 1 && uploadCalls[0].ref === "GVF-2026-SRV01" && uploadCalls[0].token === "a".repeat(48) && uploadCalls[0].files.length === 1 && uploadCalls[0].files[0].kind === "photo", "asks the API for a signed upload URL with the one-hour token");
  check(attachCalls.length === 1 && attachCalls[0].files[0].path === "GVF-2026-SRV01/1-0-spot.png" && attachCalls[0].files[0].kind === "photo", "attaches the uploaded file to the report");
  check((await page.locator("#upStatus").innerText()).includes("1 files attached"), "confirmation reports the attached file");
  check((await page.locator("#confirm .notice").count()) === 0, "nothing listed as missing when the portal's needs are met");
  check(calls[0] && calls[0].ward === "30", "ward suggested from the sector table is sent with the report");
  check(calls[0] && calls[0].issue_type === "waste" && calls[0].ward === "30" && calls[0].consent === true && calls[0].phone === "9899 999999" && calls[0].email === "test@example.org" && calls[0].pincode === "122001" && calls[0].city === "Gurugram" && /^[A-Za-z0-9_-]{20,64}$/.test(calls[0].visitor_token), "report posts the expected payload including email, PIN code, city and the visitor token");
  check((await page.locator("#confirm .err").count()) === 0, "no offline notice when the server answered");

  reportMode = "down";
  await fillReport();
  check(/^GVF-\d{4}-[A-Z2-9]{5}$/.test((await page.locator("#confirm .ref").innerText()).trim()), "falls back to a local reference when the API is down");
  check((await page.locator("#confirm .err.show").count()) === 1, "shows the saved-on-this-device notice when the API is down");
  check((await page.locator("#confirm .notice").innerText()).includes("Photo of the garbage"), "lists the photo as still needed when it could not be uploaded");

  reportMode = "limit";
  await fillReport();
  check((await page.locator("#confirm .err.show").innerText()).includes("Too many reports"), "shows the rate-limit notice on 429");

  // Hindi mode sends English values to the API
  reportMode = "ok";
  await page.goto(httpUrl + "#/");
  await page.evaluate(() => localStorage.setItem("gvf_lang", JSON.stringify("hi")));
  await page.reload();
  await page.waitForTimeout(150);
  await page.goto(httpUrl + "#/report");
  await page.waitForTimeout(100);
  await page.selectOption("#fCat", "waste");
  await page.selectOption("#fScope", { index: 1 });
  await page.click('[data-go="2"]');
  await page.fill("#fWhere", "सेक्टर 29");
  await page.locator("#fWhere").dispatchEvent("change");
  await page.waitForTimeout(400);
  await page.fill("#fSpot", "मुख्य गेट के पास");
  await page.click('[data-go="3"]');
  await page.selectOption("#filingFields select[data-x=where]", "Street or lane");
  await page.fill("#fDesc", "चार दिन से कचरा नहीं उठा।");
  await page.fill("#fName", "Test Reporter");
  await page.fill("#fPhone", "9899 999999");
  await page.fill("#fEmail", "test@example.org");
  await page.fill("#fPincode", "122001");
  await page.check("#fConsent");
  await page.click('[data-go="4"]');
  check(DEVANAGARI.test(await page.locator("#summary").innerText()) && latinWords(await page.locator("#summary dt").allInnerTexts().then((a) => a.join(" "))).length === 0, "step 4 summary labels are in Hindi");
  await page.evaluate(() => document.getElementById("confirm").classList.remove("show"));
  await page.click("#reportForm button[type=submit]");
  await page.waitForSelector("#confirm.show");
  const hiCall = calls[calls.length - 1];
  check(hiCall.area === "Sector 29" && hiCall.affects === "Me or my family" && hiCall.extra.where === "Street or lane", "Hindi report sends English area, scope and filing values (" + JSON.stringify({ area: hiCall.area, affects: hiCall.affects, where: hiCall.extra && hiCall.extra.where }) + ")");
  check(hiCall.ward === "30", "ward lookup still works with a Hindi area");
  const confirmTxt = await page.locator("#confirm").innerText();
  check(DEVANAGARI.test(confirmTxt) && latinWords(confirmTxt).length === 0, "confirmation reads in Hindi" + (latinWords(confirmTxt).length ? " (English left: " + [...new Set(latinWords(confirmTxt))].slice(0, 10).join(", ") + ")" : ""));
  await page.evaluate(() => localStorage.setItem("gvf_lang", JSON.stringify("en")));
  await page.reload();
  await page.waitForTimeout(150);

  // Visitor gate: a fresh device sees the registration form on its second page view, and the report registers the reporter
  check(visitorCalls.some((c) => c.event === "report_submit") && visitorCalls.some((c) => c.name === "Test Reporter" && c.email === "test@example.org" && c.pincode === "122001" && c.consent === true), "a submitted report registers the visitor and logs the event");
  await page.evaluate(() => localStorage.setItem("gvf_visitor", JSON.stringify({ token: "smoke_fresh_device_00001", done: false, views: 0 })));
  await page.goto(httpUrl + "#/rights");
  await page.reload();
  await page.waitForTimeout(200);
  check(!(await page.locator("#gate.open").isVisible()), "first page view shows no gate");
  await page.goto(httpUrl + "#/directory");
  await page.waitForTimeout(150);
  check(await page.locator("#gate.open").isVisible(), "second page view opens the visitor gate");
  await page.click("#gateSkip");
  await page.waitForTimeout(80);
  check(!(await page.locator("#gate.open").isVisible()) && visitorCalls.some((c) => c.event === "gate_skipped"), "Not now closes the soft gate and logs the skip");
  await page.goto(httpUrl + "#/who");
  await page.waitForTimeout(150);
  check(!(await page.locator("#gate.open").isVisible()), "a snoozed device is not asked again for a week");
  await page.evaluate(() => { const v = JSON.parse(localStorage.getItem("gvf_visitor")); delete v.snoozed_until; localStorage.setItem("gvf_visitor", JSON.stringify(v)); });
  await page.reload();
  await page.waitForTimeout(200);
  check(await page.locator("#gate.open").isVisible(), "the gate returns once the snooze ends");
  await page.click("#gateForm button[type=submit]");
  await page.waitForTimeout(80);
  check(await page.locator("#gErr.show").isVisible() && !visitorCalls.some((c) => c.name === "Gate Person"), "the gate refuses an empty form");
  await page.fill("#gName", "Gate Person");
  await page.fill("#gPhone", "9811111111");
  await page.check("#gConsent");
  await page.click("#gateForm button[type=submit]");
  await page.waitForTimeout(250);
  const gateCall = visitorCalls.find((c) => c.name === "Gate Person");
  check(!(await page.locator("#gate.open").isVisible()) && gateCall && gateCall.phone === "9811111111" && gateCall.city === "Gurugram" && gateCall.consent === true && gateCall.notice_version && !gateCall.email, "name, mobile and consent are enough to register");
  await page.goto(httpUrl + "#/wards");
  await page.waitForTimeout(120);
  check(!(await page.locator("#gate.open").isVisible()), "a registered device is not asked again");

  // Team-published content: pop-up, social links, updates feed, story page, official news
  await page.goto(httpUrl + "#/");
  await page.waitForTimeout(300);
  check(!(await page.locator("#popups").isHidden()) && (await page.locator("#popups").innerText()).includes("First townhall"), "a published pop-up shows on the home page");
  await page.click("#popups [data-dismiss]");
  await page.waitForTimeout(60);
  check(await page.locator("#popups").isHidden(), "a dismissed pop-up stays hidden");
  check(!(await page.locator("#ftSocial").isHidden()) && (await page.locator("#ftSocial a[href='https://x.com/gvf']").count()) === 1, "footer shows the social links set from the desk");
  await page.goto(httpUrl + "#/updates");
  await page.waitForTimeout(250);
  check((await page.locator("#uBody").innerText()).includes("Sewa drive cleans Sector 45 park") && (await page.locator("#uBody").innerText()).includes("The pothole was fixed in a week."), "updates show the team's story and a testimonial");
  await page.click('[data-utab="social"]');
  await page.waitForTimeout(80);
  check((await page.locator("#uBody a[href='https://x.com/gvf/status/1']").count()) === 1, "social tab links to the post");
  await page.goto(httpUrl + "#/updates/sewa-drive-sector-45-ab12c");
  await page.waitForTimeout(150);
  check((await page.locator("#postBody").innerText()).includes("Forty volunteers joined on Sunday."), "a story page renders the published body");
  await page.goto(httpUrl + "#/news");
  await page.waitForTimeout(250);
  check((await page.locator("#newsBody a[href='https://www.gmda.gov.in/notice/1']").count()) === 1 && (await page.locator("#newsBody").innerText()).includes("GMDA"), "official news page lists collected notices with their source");

  // Public anonymised report page, follow form, share, real URL
  await page.goto(httpUrl + "#/r/GVF-2026-SRV01");
  await page.waitForTimeout(250);
  const pubTxt = await page.locator("#pubBody").innerText();
  check(pubTxt.includes("GVF-2026-SRV01") && pubTxt.includes("Garbage") && pubTxt.includes("ward 30") && pubTxt.includes("3 people follow"), "public report page shows issue, ward, stage and followers");
  check(!pubTxt.includes("Test Reporter") && !pubTxt.includes("9899"), "public report page shows no reporter details");
  check((await page.locator("#pubBody .tl li.done").count()) === 2 && (await page.locator("#pubBody .tl li.now").count()) === 1, "public timeline marks two stages done and one current");
  await page.fill("#fwEmail", "nope");
  await page.click("#followForm button[type=submit]");
  await page.waitForTimeout(80);
  check(await page.locator("#fwErr.show").isVisible(), "follow form rejects a bad email");
  await page.fill("#fwEmail", "friend@example.org");
  await page.click("#followForm button[type=submit]");
  await page.waitForTimeout(200);
  check(follows.length === 1 && follows[0].ref === "GVF-2026-SRV01" && follows[0].email === "friend@example.org" && !(await page.locator("#fwOk").isHidden()), "follow form posts the reference and email");
  check((await page.locator("#pubBody a[href^='https://wa.me/']").count()) === 1 && (await page.locator("#pubBody a[href='#/report/waste']").count()) === 1, "public page offers WhatsApp share and me-too");
  await page.goto(httpUrl + "#/r/GVF-2026-NOPE1");
  await page.waitForTimeout(200);
  check((await page.locator("#pubBody").innerText()).includes("No report has this reference"), "unknown reference shows a clear message");
  await page.goto(httpUrl + "r/GVF-2026-SRV01");
  await page.waitForTimeout(300);
  check((await page.evaluate(() => location.hash)) === "#/r/GVF-2026-SRV01" && (await page.locator("#pubBody").innerText()).includes("Garbage"), "a real URL like /r/REF opens the public page");
  await page.goto(httpUrl + "map");
  await page.waitForTimeout(300);
  check((await page.evaluate(() => location.hash)) === "#/map" && (await page.locator("#pubLegend span .sw").count()) === 5 && (await page.locator("#pubCount").innerText()).length > 0, "/map opens the public map with a stage legend");

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
  console.log("\nVolunteer desk at #/desk (mocked /api/triage over http, 1366x860)");
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  await ctx.addInitScript(() => { try { if (!localStorage.getItem("gvf_visitor")) localStorage.setItem("gvf_visitor", JSON.stringify({ token: "smoke_visitor_token_0001", done: true, views: 9 })); } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  const session = { access_token: "tok", refresh_token: "ref", expires_at: 9999999999 };
  const staff = { user_id: "u1", name: "Coordinator", role: "coordinator", email: "coord@example.org" };
  const report = (over) => Object.assign({ ref: "GVF-2026-SRV01", issue_type: "waste", issue_label: "Garbage", affects: "My society or RWA", area: "Sector 29", ward: 30, councillor: "Madhu Batra", spot: "Near the gate", lat: null, lng: null,
    stage: 0, desk: null, official_channel: null, official_ticket: null, official_filed_at: null, escalated_to: null, resolved_at: null, resolution_note: null, source: "web",
    reporter_name: "Test Reporter", reporter_phone: "+919899999999", reporter_email: null, consent_at: "2026-10-07T10:00:00Z", description: "Garbage not collected.",
    created_at: "2026-10-07T10:00:00Z", updated_at: "2026-10-07T10:00:00Z", unmapped_overdue: false, filed_overdue: false, events_count: 1, last_event_at: "2026-10-07T10:00:00Z", extra: { where: "Street or lane" }, attachments: [] }, over);
  const filing = { portal: "GMDA integrated grievance portal or Swachhata app", url: "https://services.gmda.gov.in/", note: "A geo-tagged photo routes the complaint.",
    fields: [{ key: "where", label: "Type of place", required: true, value: "Street or lane", missing: false }, { key: "since", label: "Since when", required: false, value: "", missing: false }],
    docs: [{ key: "photo", label: "Photo of the garbage", required: true, files: [], have: false, missing: true }], missing: ["Photo of the garbage"], complete: false };
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
    return json(route, 200, { ok: true, report: state, events, volunteers: { lead_name: "Vol One", lead_email: "vol@example.org", support_name: null, support_email: null }, filing });
  });
  await page.route("**/api/triage/staff", (route) => json(route, 200, { ok: true, staff: [{ ...staff, wards: [] }, { user_id: "u2", name: "Vol One", role: "triage", email: "vol@example.org", wards: [{ ward: 10, role: "lead" }] }] }));
  const wardPuts = [];
  await page.route("**/api/triage/wards", (route) => {
    if (route.request().method() === "PUT") { wardPuts.push(JSON.parse(route.request().postData() || "{}")); return json(route, 200, { ok: true, ward: { ward: wardPuts[wardPuts.length - 1].ward } }); }
    return json(route, 200, { ok: true, wards: [{ ward: 10, councillor: "Mahabir", lead_user_id: "u2", lead_name: "Vol One", support_user_id: null, support_name: null }, { ward: 30, councillor: "Madhu Batra", lead_user_id: null, lead_name: null, support_user_id: null, support_name: null }] });
  });

  await page.goto(httpUrl + "#/desk");
  await page.waitForTimeout(150);
  check(await page.locator("#v-desk.on").isVisible() && !(await page.locator("#deskLogin").isHidden()), "desk route starts on the sign-in form");
  check(await page.locator("#navDesk").isHidden(), "Desk nav item is hidden before sign-in");
  await page.fill("#lEmail", "coord@example.org");
  await page.fill("#lPass", "wrong");
  await page.click("#lBtn");
  await page.waitForTimeout(150);
  check((await page.locator("#lErr").innerText()).includes("Wrong email or password"), "wrong password shows an error");
  await page.fill("#lPass", "secret-pass");
  await page.click("#lBtn");
  await page.waitForSelector("#deskMain:not([hidden])");
  await page.waitForTimeout(200);
  check(!(await page.locator("#navDesk").isHidden()), "Desk nav item appears after sign-in");
  await page.click('#nav a[data-v="directory"]');
  await page.waitForTimeout(80);
  check(await page.locator("#v-directory.on").isVisible(), "public pages stay reachable while signed in");
  await page.click('#nav a[data-v="desk"]');
  await page.waitForTimeout(80);
  check(await page.locator("#deskMain").isVisible(), "returning to the desk keeps the session");
  check((await page.locator("#whoAmI").innerText()).includes("Coordinator"), "header shows who is signed in");
  check((await page.locator("#tList .row").count()) === 2, "list shows two reports");
  check((await page.locator("#tList .tag-danger").count()) === 1, "overdue report carries a past-due flag");
  check((await page.locator("#tSummary").innerText()).includes("past due: 1 unmapped"), "summary line shows the counts");
  check(!(await page.locator("#teamTab").isHidden()), "coordinator sees the Team tab");

  await page.click('[data-open="GVF-2026-SRV01"]');
  await page.waitForSelector("#editForm");
  check((await page.locator("#sheetBody").innerText()).includes("Test Reporter"), "detail shows the reporter to signed-in staff");
  check((await page.locator("#sheetBody").innerText()).includes("Lead: Vol One"), "detail shows the ward's lead volunteer");
  check((await page.locator("#sheetBody .tl li").count()) === 1, "detail shows the event timeline");
  check((await page.locator("#sheetBody").innerText()).includes("Filing checklist: GMDA"), "detail shows the filing checklist for the portal");
  check((await page.locator("#sheetBody .chk .tag-danger").count()) === 1 && (await page.locator("#askMissing").count()) === 1, "checklist flags the missing photo and offers to ask the reporter");
  check((await page.locator("#ex_where").inputValue()) === "Street or lane", "filing details are editable at the desk");
  await page.fill("#ex_since", "2026-10-01");
  await page.fill("#eDesk", "MCG sanitation wing");
  await page.selectOption("#eChan", "GMDA portal");
  await page.fill("#eTicket", "GMDA-4471");
  await page.fill("#eNote", "Filed on the portal.");
  await page.click("#eSave");
  await page.waitForTimeout(250);
  check(patches.length === 1 && patches[0].desk === "MCG sanitation wing" && patches[0].official_ticket === "GMDA-4471" && patches[0].official_channel === "GMDA portal" && patches[0].note === "Filed on the portal." && !("stage" in patches[0]) && patches[0].extra && patches[0].extra.since === "2026-10-01" && !("where" in patches[0].extra), "save sends only the changed fields, including the filing detail");
  check((await page.locator("#sheetBody .tl li").count()) === 3, "timeline refreshes after saving");
  check((await page.locator("#row_GVF-2026-SRV01 .tag").first().innerText()).includes("Filed officially"), "list row updates to the new stage");
  await page.click("#sheetClose");

  const contentCalls = [];
  const deskPosts = [{ id: "p9", kind: "news", slug: "x", title: "Existing draft", published: false, pinned: false, created_at: "2026-10-07T10:00:00Z", created_by: "Coordinator" }];
  await page.route("**/api/triage/content", (route) => { const mth = route.request().method(); if (mth === "GET") return json(route, 200, { ok: true, posts: deskPosts, settings: { social: { x: "https://x.com/gvf" } } }); const b = JSON.parse(route.request().postData() || "{}"); contentCalls.push({ method: mth, body: b }); return json(route, mth === "POST" ? 201 : 200, { ok: true, post: { id: "p10", ...b } }); });
  await page.route("**/api/triage/draft", (route) => json(route, 503, { ok: false, error: "draft_unavailable" }));
  await page.route("**/api/triage/visitors**", (route) => json(route, 200, { ok: true, stats: { visitors_total: 12, visitors_new: 5, events_by_type: { page_view: 340, report_start: 9, report_submit: 4, gate_shown: 20, gate_done: 12 }, top_paths: [{ path: "#/", n: 120 }] }, visitors: [{ name: "Gate Person", phone: "+919811111111", email: "gate@example.org", area: "Sector 45", pincode: "122003", city: "Gurugram", created_at: "2026-10-07T10:00:00Z", visits: 2 }], total: 12 }));
  await page.route("**/api/health", (route) => json(route, 200, { ok: false, checks: { db: { ok: true, ms: 12 }, storage: { ok: true }, cron: { ok: true, last_run_at: "2026-10-07T03:30:00Z", hours_since: 5 }, outbox: { pending: 2, failed: 0 }, links: { checked: 61, broken: [{ url: "https://example.org/dead", status: 404, where_used: "PORTALS" }] }, news: { sources: 20, items: 150, stale_sources: [] } }, version: "0ab1cd3" }));
  await page.click('[data-tab="content"]');
  await page.waitForTimeout(250);
  check((await page.locator("#postList").innerText()).includes("Existing draft") && (await page.locator("#sX").inputValue()) === "https://x.com/gvf", "content tab lists posts and loads the social links");
  await page.click("#draftBtn");
  await page.waitForTimeout(60);
  await page.fill("#draftBrief", "Sewa drive in Sector 45 park with forty volunteers on Sunday");
  await page.click("#draftBtn");
  await page.waitForTimeout(150);
  check((await page.locator("#draftMsg").innerText()).includes("GEMINI_API_KEY"), "draft helper explains which free key to add");
  await page.selectOption("#pKind", "story");
  await page.fill("#pTitle", "Sewa drive cleans Sector 45 park");
  await page.fill("#pSummary", "Forty volunteers, two tonnes of waste.");
  await page.fill("#pBody", "<p>Forty volunteers joined on Sunday.</p>");
  await page.check("#pPublished");
  await page.click("#pSave");
  await page.waitForTimeout(250);
  check(contentCalls.length === 1 && contentCalls[0].method === "POST" && contentCalls[0].body.kind === "story" && contentCalls[0].body.title === "Sewa drive cleans Sector 45 park" && contentCalls[0].body.published === true, "saving a post sends it to the content API");
  await page.click('#postList [data-ppub="p9"]');
  await page.waitForTimeout(150);
  check(contentCalls.length === 2 && contentCalls[1].method === "PATCH" && contentCalls[1].body.id === "p9" && contentCalls[1].body.published === true, "publish toggles through a PATCH");
  await page.click('[data-tab="visitors"]');
  await page.waitForTimeout(200);
  check((await page.locator("#visitorStats").innerText()).includes("12 registered visitors") && (await page.locator("#visitorList").innerText()).includes("Gate Person"), "visitors tab shows the registration count and the list");
  await page.click('[data-tab="health"]');
  await page.waitForTimeout(200);
  check((await page.locator("#healthBody .tag-green").count()) >= 3 && (await page.locator("#healthBody .tag-danger").count()) === 1 && (await page.locator("#healthBody").innerText()).includes("example.org/dead"), "health tab flags the broken link and passes the rest");
  await page.click('[data-tab="reports"]');
  await page.waitForTimeout(100);
  const pwCalls = [];
  await page.route("**/api/triage/password", (route) => { pwCalls.push(JSON.parse(route.request().postData() || "{}")); return json(route, 200, { ok: true }); });
  await page.click("#pwBtn");
  check(!(await page.locator("#pwForm").isHidden()), "change-password form opens");
  await page.fill("#pwNew", "gurugram2026x");
  await page.fill("#pwNew2", "different");
  await page.click("#pwForm button[type=submit]");
  await page.waitForTimeout(80);
  check(await page.locator("#pwErr.show").isVisible() && pwCalls.length === 0, "mismatched passwords are refused locally");
  await page.fill("#pwNew2", "gurugram2026x");
  await page.click("#pwForm button[type=submit]");
  await page.waitForTimeout(200);
  check(pwCalls.length === 1 && pwCalls[0].password === "gurugram2026x" && (await page.locator("#pwForm").isHidden()), "password change posts to the API and closes the form");

  await page.click('[data-tab="team"]');
  await page.waitForTimeout(250);
  check((await page.locator("#staffList .row").count()) === 2, "team tab lists the accounts");
  check((await page.locator("#staffList [data-remove]").count()) === 0, "coordinator cannot remove accounts");
  check((await page.locator("#wardBody2 tr").count()) === 2, "ward grid lists the wards");
  check((await page.locator('#wardBody2 select[data-ward="10"][data-role="lead"]').inputValue()) === "u2", "ward grid shows the current lead");
  await page.selectOption('#wardBody2 select[data-ward="30"][data-role="support"]', "u2");
  await page.waitForTimeout(150);
  check(wardPuts.length === 1 && wardPuts[0].ward === 30 && wardPuts[0].role === "support" && wardPuts[0].user_id === "u2", "changing a ward select saves the assignment");

  await page.click("#signOut");
  await page.waitForTimeout(100);
  check(!(await page.locator("#deskLogin").isHidden()) && (await page.locator("#deskMain").isHidden()), "sign out returns to the sign-in form");
  check((await page.evaluate(() => localStorage.getItem("gvf_staff"))) === null, "sign out clears the stored session");

  check(errors.length === 0, "zero console or page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
