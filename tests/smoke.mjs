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
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
// A host page like an RWA site would have, with the embed widget in English and Hindi.
const EMBED_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>RWA site</title></head><body><h1>Sector 15 RWA</h1>
<script src="/embed.js" data-ward="15" data-lang="en" async></script>
<script src="/embed.js" data-lang="hi" async></script></body></html>`;
const server = http.createServer(async (req, res) => {
  let p = req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0];
  if (p === "/embed-test.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(EMBED_PAGE); }
  if (!extname(p) && !p.startsWith("/api/")) p = "/index.html"; else if (extname(p)) p = "/" + p.split("/").pop();
  try {
    const body = await readFile(resolve("site" + p));
    res.writeHead(200, { "Content-Type": MIME[extname(p)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const httpUrl = `http://127.0.0.1:${server.address().port}/`;
const routes = ["", "report", "track", "directory", "rights", "who", "wards", "charter", "dashboard", "updates", "join", "about", "accessibility", "privacy", "map", "news", "pulse"];

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
  check((await page.evaluate(() => (document.querySelector("link[rel=manifest]") || {}).getAttribute("href"))) === "/manifest.webmanifest" && (await page.locator("link[rel=apple-touch-icon]").count()) === 1, "page links the web app manifest and the touch icon");
  check((await page.locator("footer a[href='/guides']").count()) === 1 && (await page.locator("footer a[href='/blog']").count()) === 1 && (await page.locator("footer a[href='/ward/1']").count()) === 1, "footer links to the guides, blog and ward pages");
  check((await page.locator("#subFooter form[data-sub]").count()) === 1 && (await page.locator("#subFooter").innerText()).includes("One email a week"), "footer carries the weekly digest form");
  check((await page.locator("#ftLinks").innerText()) === "Links checked daily.", "footer shows the static link-check line under file:// (no API, no stale date)");

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
  check((await page.locator("#panel a[href='/guide/waste']").count()) === 1, "result panel links to the full guide page");
  await page.goto(url + "#/directory");
  await page.waitForTimeout(60);
  check((await page.locator("#dGuides a").count()) === 17 && (await page.locator("#dGuides a[href='/guide/waste']").count()) === 1, "directory lists a full guide link per issue");
  await page.goto(url + "#/wards");
  await page.waitForTimeout(60);
  check((await page.locator("#wardBody a[href='/ward/1']").count()) === 1 && (await page.locator("#wardBody a[href='/ward/36']").count()) === 1, "ward rows link to their ward pages");
  await page.goto(url + "#/updates");
  await page.waitForTimeout(60);
  check((await page.locator("#uBody .card .share a[href^='https://wa.me/']").count()) >= 1 && (await page.locator("#uBody .card .share [data-copy]").count()) >= 1, "update cards carry a share row");
  await page.fill("#suEmail", "nope");
  await page.click("#subUpdates button[type=submit]");
  await page.waitForTimeout(60);
  check(await page.locator("#subUpdates .err.show").isVisible(), "digest form refuses a bad email");
  await page.fill("#suEmail", "reader@example.org");
  await page.click("#subUpdates button[type=submit]");
  await page.waitForTimeout(100);
  check((await page.locator("#subUpdates .err.show").innerText()).includes("could not be reached"), "digest form explains when the server is unreachable (file://)");

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
  check((await page.locator("#confirm .share a[href^='https://wa.me/']").count()) === 1 && (await page.locator(`#confirm .share [data-copy='https://gurugramvisionforum.org/track/${ref}']`).count()) === 1, "confirmation offers to share the tracking link");
  check((await page.locator("#pwaCard").count()) === 0, "no install nudge when the browser offered no install prompt");

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
  check((await page.locator("#wardCountsTh").getAttribute("hidden")) !== null && (await page.locator("#wardCounts").isHidden()) && (await page.locator("#wardBody td[data-l='Reports']").count()) === 0, "wards show no counts and no error without the API");

  // Reports are private: the old public links #/r/REF and #/map show the notice and never a reference
  for (const r of ["r/GVF-2026-T4DG5", "map"]) {
    await page.goto(url + "#/" + r);
    await page.waitForTimeout(80);
    const txt = await page.locator("#v-private").innerText();
    check((await page.locator("#v-private.on").isVisible()) && txt.includes("Reports are private") && !txt.includes("GVF-2026") && (await page.locator("#v-private a[href='#/track']").count()) === 1 && (await page.locator("#v-private a[href='#/wards']").count()) === 1, `#/${r} shows the private notice with track and wards links`);
  }
  check((await page.locator("a[href='#/map'], a[href^='#/r/'], [data-copy*='/r/GVF']").count()) === 0, "nothing links to a public map or a public report page");

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
  const hiRoutes = routes.concat(["fix/waste", "rights/rts", "who/mp", "updates/complaint-that-gets-acted-on", "r/GVF-2026-T4DG5"]);
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
    if (r === "map" || r.startsWith("r/")) check(txt.includes("रिपोर्टें निजी हैं") && !txt.includes("GVF-2026"), `#/${r} shows the private notice in Hindi without a reference`);
  }
  check(await page.evaluate(() => document.title.includes("गुरुग्राम")), "document title is in Hindi");
  check((await page.locator("footer a[href='/hi/guides']").count()) === 1 && (await page.locator("footer a[href='/hi/blog']").count()) === 1 && (await page.locator("footer a[href='/hi/ward/1']").count()) === 1 && (await page.locator("#dGuides a[href='/hi/guide/waste']").count()) === 1 && (await page.locator("#wardBody a[href='/hi/ward/36']").count()) === 1, "Hindi mode points the guide, blog and ward links at /hi/…");
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
  check((await page.locator("footer a[href='/guides']").count()) === 1 && (await page.locator("footer a[href='/hi/guides']").count()) === 0, "guide links return to English pages");

  { const html = await page.content(); check(!/mailto:|tel:\+91|contact@|98993 75445|Sidharth/.test(html), "no contact email, phone or name anywhere in the shell: the forms are the only channel"); }
  check(errors.length === 0, "zero console or page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
// ---- Early paint: the home view paints before app.js arrives (boot.js), and nothing else does ----
{
  console.log("\nEarly paint (app.js held back, 390x844)");
  const visitor = () => { try { if (!localStorage.getItem("gvf_visitor")) localStorage.setItem("gvf_visitor", JSON.stringify({ token: "smoke_visitor_token_0001", done: true, views: 9 })); } catch {} };
  const open = async (suffix, { lang, theme, hold } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(visitor);
    if (lang || theme) await ctx.addInitScript(([l, t]) => { try { if (l) localStorage.setItem("gvf_lang", JSON.stringify(l)); if (t) localStorage.setItem("gvf_theme", JSON.stringify(t)); } catch {} }, [lang || null, theme || null]);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    let release = null;
    if (hold) { const held = new Promise((r) => { release = r; }); await page.route("**/app.js", async (route) => { await held; await route.continue(); }); }
    else await page.route("**/app.js", (route) => route.abort());
    await page.goto(httpUrl + suffix, { waitUntil: "commit" });
    await page.waitForSelector("header.hdr", { state: "attached" });
    await page.waitForTimeout(400);
    return { ctx, page, errors, release };
  };
  {
    const { ctx, page, errors, release } = await open("", { hold: true });
    check(await page.locator("#v-home h1").isVisible(), "home heading paints before app.js has loaded");
    check((await page.evaluate(() => document.documentElement.getAttribute("data-boot"))) === "home", "boot.js marks the home URL for the early paint");
    check((await page.evaluate(() => { const t = document.getElementById("tiles"); return t.children.length === 0 && t.getBoundingClientRect().height >= 550; })), "the empty tile grid holds its final height (no jump when the tiles arrive)");
    check((await page.evaluate(() => !document.querySelector('link[rel="stylesheet"][href*="fonts.googleapis"]:not([media])') || [...document.querySelectorAll('link[href*="fonts.googleapis"]')].every((l) => l.parentElement.tagName === "HEAD"))) && (await page.evaluate(() => !!document.querySelector('head link[href*="fonts.googleapis"]'))), "Google Fonts are requested by boot.js, not as a blocking link");
    release();
    await page.waitForFunction(() => window.__booted, null, { timeout: 15000 });
    await page.waitForTimeout(300);
    check((await page.evaluate(() => document.documentElement.hasAttribute("data-boot"))) === false && (await page.locator("#tiles .tile").count()) >= 17 && (await page.locator("#v-home").isVisible()), "after boot the flag is gone, the tiles are in and home stays visible");
    await page.evaluate(() => { location.hash = "#/directory"; });
    await page.waitForTimeout(300);
    check(await page.locator("#v-home").isHidden(), "navigating away hides home (the boot flag no longer forces it)");
    check(!errors.length, "no page errors in the early-paint pass" + (errors.length ? ": " + errors.join(" | ") : ""));
    await ctx.close();
  }
  for (const [suffix, opts, what] of [["#/report", {}, "a #/report link"], ["report", {}, "the /report address"], ["", { lang: "hi" }, "a visitor who chose Hindi"]]) {
    const { ctx, page } = await open(suffix, opts);
    check(await page.locator("#v-home").isHidden(), "home does not flash for " + what + " while app.js loads");
    await ctx.close();
  }
  {
    const { ctx, page } = await open("", { theme: "dark" });
    check((await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) === "dark", "a saved dark theme applies before app.js (no light flash)");
    await ctx.close();
  }
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
  // Counts only, always published: the API has no 50-report threshold any more
  await page.route("**/api/dashboard", async (route) => {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, published: true, total: 61, updated_at: "2026-11-01T10:00:00Z", source: "Gurugram Vision Forum case system",
      links: { checked_at: "2026-10-08T18:30:00Z", total: 36, broken: 0 },
      summary: { total: 61, received: 10, filed: 30, escalated: 6, resolved: 15, mapped_in_3_days_pct: 92, acted_in_21_days_pct: 71, computed_at: "2026-11-01T10:00:00Z" },
      by_issue: [{ issue_type: "waste", label: "Garbage", received: 4, filed: 12, escalated: 3, resolved: 8, total: 27 }, { issue_type: "roads", label: "Roads, footpaths", received: 6, filed: 18, escalated: 3, resolved: 7, total: 34 }],
      by_ward: [{ ward: 30, councillor: "Madhu Batra", received: 4, filed: 12, escalated: 3, resolved: 8, total: 27, median_days_to_resolve: 9 }, { ward: 10, councillor: "Mahabir", received: 6, filed: 18, escalated: 3, resolved: 7, total: 34, median_days_to_resolve: null }] }) });
  });
  // The public report, public feed and follow endpoints no longer exist; the site must never call them
  const gone = [];
  await page.route(/\/api\/(public|follow)/, (route) => { gone.push(route.request().url()); return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: "not_found" }) }); });
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
  await page.route("**/api/pulse", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, generated_at: "2026-10-07T03:30:00Z", pulse: { period: { from: "2026-09-30T00:00:00Z", to: "2026-10-07T00:00:00Z" }, total: 42, headline_en: "Garbage and waterlogging top the week", headline_hi: "कचरा और जलभराव इस सप्ताह सबसे ऊपर", summary_en: "Residents talked most about garbage.", summary_hi: "निवासियों ने कचरे पर सबसे ज़्यादा बात की।",
    topics: [{ issue_type: "waste", label: "Garbage", count: 18, by_source: { reddit: 10, news: 5, reports: 3 }, trend: "up", areas: [{ area: "Sector 45", n: 4 }], examples: [{ title: "Garbage piling up near Sector 45 market", url: "https://www.reddit.com/r/gurgaon/x", source: "reddit", posted_at: "2026-10-06T10:00:00Z" }] }, { issue_type: "drains", label: "Drains, flooding", count: 9, by_source: { reddit: 2, news: 7, reports: 0 }, trend: "flat", areas: [], examples: [] }],
    actions: [{ issue_type: "waste", title: "Sector cleaning drive with MCG's sanitation wing", why: "18 mentions, rising", when: "this weekend" }] } }) }));
  await page.route("**/api/news**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, items: [{ title: "Public notice: water supply schedule", url: "https://www.gmda.gov.in/notice/1", published_at: "2026-10-07T04:00:00Z", fetched_at: "2026-10-07T05:00:00Z", source_id: "gmda", source_name: "GMDA", home: "https://www.gmda.gov.in/" }, { title: "Ward committee meetings announced", url: "https://www.mcg.gov.in/news/2", published_at: "2026-10-06T04:00:00Z", fetched_at: "2026-10-07T05:00:00Z", source_id: "mcg", source_name: "MCG", home: "https://www.mcg.gov.in/" }], sources: [{ id: "gmda" }, { id: "mcg" }] }) }));
  await page.route("**/api/ward**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, ward: 30, source: "table" }) }));
  const subs = [];
  let subMode = "ok";
  await page.route("**/api/subscribe", (route) => { subs.push(JSON.parse(route.request().postData() || "{}")); if (subMode === "down") return route.abort(); return route.fulfill({ status: subMode === "ok" ? 200 : 400, contentType: "application/json", body: JSON.stringify(subMode === "ok" ? { ok: true, pending: true } : { ok: false, error: "invalid", fields: ["email"] }) }); });
  await page.route("**/api/geocode**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, results: [{ name: "Sector 29, Gurugram", lat: 28.46, lng: 77.07 }] }) }));

  let linkDay = "";
  const fillReport = async (withFile) => {
    await page.goto(httpUrl + "#/report");
    await page.waitForTimeout(100);
    if (!linkDay) {
      linkDay = await page.evaluate(() => new Date("2026-10-08T18:30:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }));
      check((await page.locator("#ftLinks").innerText()) === "Links verified " + linkDay + ".", "footer shows the live link-check date from /api/dashboard after boot (" + linkDay + ")");
    }
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

  // The test server is http, not https: the service worker must stay unregistered.
  await page.goto(httpUrl + "#/");
  await page.waitForTimeout(200);
  check((await page.evaluate(() => "serviceWorker" in navigator ? navigator.serviceWorker.getRegistrations().then((r) => r.length) : 0)) === 0, "service worker is not registered on the http test server");
  check((await page.evaluate(() => fetch("/manifest.webmanifest").then((r) => r.ok ? r.json() : null).then((m) => m && m.short_name + "|" + m.display + "|" + m.icons.length))) === "GVF|standalone|2", "manifest is served and names the app, display mode and icons");

  // Pretend the browser offered an install prompt: the nudge appears only after a successful report.
  await page.evaluate(() => { window.__prompted = 0; const ev = new Event("beforeinstallprompt"); ev.prompt = () => { window.__prompted++; }; ev.userChoice = Promise.resolve({ outcome: "accepted" }); window.dispatchEvent(ev); });
  await fillReport(true);
  check((await page.locator("#confirm .ref").innerText()).trim() === "GVF-2026-SRV01", "report uses the server reference");
  check((await page.locator("#pwaCard").count()) === 1 && (await page.locator("#pwaCard").innerText()).includes("Add the Forum to your phone"), "install nudge appears after a successful report");
  await page.click("#pwaInstall");
  await page.waitForTimeout(80);
  check((await page.evaluate(() => window.__prompted)) === 1 && (await page.locator("#pwaCard").count()) === 0, "Install calls the browser prompt and removes the card");
  check((await page.locator("#confirm .share [data-copy='https://gurugramvisionforum.org/track/GVF-2026-SRV01']").count()) === 1, "confirmation shares the tracking link");
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
  // Hindi mode: post cards point at /hi/blog/…, and the digest form confirms in Hindi
  await page.goto(httpUrl + "#/updates");
  await page.waitForTimeout(250);
  check((await page.locator("#uBody a[href='/hi/blog/sewa-drive-sector-45-ab12c']").count()) >= 1 && (await page.locator("footer a[href='/hi/blog']").count()) === 1, "Hindi mode links post cards and the footer to /hi/blog");
  check(await page.locator("#subUpdates input[value='hi']").isChecked(), "digest form preselects Hindi in Hindi mode");
  await page.fill("#suEmail", "hindi@example.org");
  await page.click("#subUpdates button[type=submit]");
  await page.waitForTimeout(200);
  check(subs.length === 1 && subs[0].email === "hindi@example.org" && subs[0].lang === "hi" && (await page.locator("#subUpdates .subok").innerText()).includes("इनबॉक्स"), "Hindi digest subscription posts lang=hi and confirms in Hindi");
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
  check((await page.locator("#dVerified").innerText()).startsWith("Links and numbers verified " + linkDay + "."), "Directory line prefers the live link-check date over the static one");
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
  // Wards: per-ward counts from /api/dashboard (by_ward), counts only
  await page.waitForTimeout(150);
  const ward30 = await page.locator("#wardBody tr").nth(29).innerText(), ward10 = await page.locator("#wardBody tr").nth(9).innerText(), ward1 = await page.locator("#wardBody tr").nth(0).innerText();
  check((await page.locator("#wardCountsTh").getAttribute("hidden")) === null && (await page.locator("#wardBody td[data-l='Reports']").count()) === 36, "wards table gains a Reports column when the API answers");
  check(ward30.includes("27 reports") && ward30.includes("19 open") && ward30.includes("8 resolved") && ward30.includes("9 days to resolve"), "ward 30 shows total, open, resolved and median days");
  check(ward10.includes("34 reports") && !ward10.includes("days to resolve") && ward1.includes("0 reports") && ward1.includes("0 open"), "a ward without a median omits it and a ward without reports shows zero");
  check((await page.locator("#wardCounts").innerText()).includes("Counts only") && !(await page.locator("#v-wards").innerText()).includes("GVF-2026"), "wards page explains the counts and names no report");

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
  check((await page.locator("#uBody h3 a[href='/blog/sewa-drive-sector-45-ab12c']").count()) === 1 && (await page.locator("#uBody a.btn[href='/blog/sewa-drive-sector-45-ab12c']").count()) === 1, "post card title and Read link go to the server page /blog/{slug}");
  check((await page.locator("#uBody .card .share [data-copy='https://gurugramvisionforum.org/blog/sewa-drive-sector-45-ab12c']").count()) === 1 && (await page.locator("#uBody .card .share a[href^='https://wa.me/?text=']").first().getAttribute("href")).includes(encodeURIComponent("/blog/sewa-drive-sector-45-ab12c")), "post card shares the canonical post URL");
  // Weekly digest: subscribe from the Updates page, then the error branch and the footer form
  await page.fill("#suEmail", "reader@example.org");
  await page.check("#subUpdates input[value='en']");
  await page.click("#subUpdates button[type=submit]");
  await page.waitForTimeout(200);
  check(subs.length === 2 && subs[1].email === "reader@example.org" && subs[1].lang === "en" && (await page.locator("#subUpdates .subok").innerText()).includes("Check your inbox to confirm.") && visitorCalls.some((c) => c.event === "subscribe"), "digest form posts email and language and confirms");
  subMode = "fail";
  await page.fill("#sfEmail", "footer@example.org");
  await page.click("#subFooter button[type=submit]");
  await page.waitForTimeout(200);
  check(subs.length === 3 && (await page.locator("#subFooter .err.show").innerText()).includes("Could not subscribe"), "footer digest form shows the error when the API refuses");
  subMode = "down";
  await page.click("#subFooter button[type=submit]");
  await page.waitForTimeout(300);
  check((await page.locator("#subFooter .err.show").innerText()).includes("could not be reached"), "digest form explains an unreachable server");
  subMode = "ok";
  await page.click('[data-utab="social"]');
  await page.waitForTimeout(80);
  check((await page.locator("#uBody a[href='https://x.com/gvf/status/1']").count()) === 1, "social tab links to the post");
  await page.goto(httpUrl + "#/updates/sewa-drive-sector-45-ab12c");
  await page.waitForTimeout(150);
  check((await page.locator("#postBody").innerText()).includes("Forty volunteers joined on Sunday."), "a story page renders the published body");
  await page.goto(httpUrl + "#/news");
  await page.waitForTimeout(250);
  check((await page.locator("#newsBody a[href='https://www.gmda.gov.in/notice/1']").count()) === 1 && (await page.locator("#newsBody").innerText()).includes("GMDA"), "official news page lists collected notices with their source");
  await page.goto(httpUrl + "#/pulse");
  // The pulse view renders after its API call; wait for the content, not a fixed delay (a slow runner raced the 250 ms).
  await page.waitForSelector("#pulseBody a[href='https://www.reddit.com/r/gurgaon/x']", { timeout: 5000 }).catch(() => null);
  const pulseTxt = await page.locator("#pulseBody").innerText();
  check(pulseTxt.includes("Garbage and waterlogging top the week") && pulseTxt.includes("Garbage") && pulseTxt.includes("18") && pulseTxt.includes("Sector cleaning drive") && (await page.locator("#pulseBody a[href='https://www.reddit.com/r/gurgaon/x']").count()) === 1, "pulse page shows the week's topics, an example link and the suggested action");
  check((await page.locator("#pulseBody .share a[href^='https://wa.me/']").count()) === 1 && (await page.locator("#pulseBody .share [data-copy='https://gurugramvisionforum.org/pulse']").count()) === 1, "pulse page carries a share row");
  // Copy link: stub the clipboard, click, and watch the label flip to Copied and back
  await page.evaluate(() => { window.__copied = ""; const stub = { writeText: (t) => { window.__copied = t; return Promise.resolve(); } }; try { Object.defineProperty(navigator, "clipboard", { value: stub, configurable: true }); } catch { navigator.clipboard.writeText = stub.writeText; } });
  const shareEvents = visitorCalls.filter((c) => c.event === "share").length;
  await page.click("#pulseBody .share [data-copy]");
  await page.waitForTimeout(100);
  check((await page.evaluate(() => window.__copied)) === "https://gurugramvisionforum.org/pulse" && (await page.locator("#pulseBody .share [data-copy]").innerText()).includes("Copied"), "Copy link writes the URL and shows Copied");
  check(visitorCalls.filter((c) => c.event === "share").length === shareEvents + 1, "sharing logs a first-party share event");
  await page.waitForTimeout(2200);
  check((await page.locator("#pulseBody .share [data-copy]").innerText()).includes("Copy link"), "Copied label returns to Copy link after two seconds");

  // Reports are private: #/r/REF and #/map show the notice, name no report and call no public endpoint
  await page.goto(httpUrl + "#/r/GVF-2026-T4DG5");
  await page.waitForTimeout(250);
  const privTxt = await page.locator("#v-private").innerText();
  check((await page.locator("#v-private.on").isVisible()) && privTxt.includes("Reports are private") && !privTxt.includes("GVF-2026") && !privTxt.includes("Garbage"), "#/r/REF shows the private notice and nothing about the report");
  check((await page.locator("#v-private a[href='#/track']").count()) === 1 && (await page.locator("#v-private a[href='#/wards']").count()) === 1, "private notice offers Track and the ward counts");
  await page.goto(httpUrl + "r/GVF-2026-T4DG5");
  await page.waitForTimeout(300);
  check((await page.evaluate(() => location.hash)) === "#/r/GVF-2026-T4DG5" && (await page.locator("#v-private.on").isVisible()), "a real URL like /r/REF still opens, on the private notice");
  await page.goto(httpUrl + "map");
  await page.waitForTimeout(300);
  check((await page.evaluate(() => location.hash)) === "#/map" && (await page.locator("#v-private.on").isVisible()) && (await page.locator("#v-private .mapbox").count()) === 0, "/map opens the private notice, not a map");
  check(gone.length === 0, "no request goes to /api/public/* or /api/follow" + (gone.length ? ": " + gone.join(", ") : ""));


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

  // Dashboard: counts render whenever the API answers (no 50-report threshold)
  await page.goto(httpUrl + "#/dashboard");
  await page.waitForTimeout(250);
  check((await page.locator("#kpis .kpi b").first().innerText()) === "61", "dashboard shows live KPIs");
  check((await page.locator("#dashBody").innerText()).includes("92% on time"), "dashboard shows commitment actuals");
  check((await page.locator("#dashBody .bar").count()) === 2, "dashboard draws one bar per cause");
  check((await page.locator("#sampleBtn").count()) === 0 && !(await page.locator("#dashBody").innerText()).includes("50 reports"), "dashboard has no sample toggle and no 50-report placeholder");
  check(!(await page.locator("#v-dashboard").innerText()).includes("GVF-2026"), "dashboard names no report");

  // Embed widget on a host page (served from the same test server)
  await page.goto(httpUrl + "embed-test.html");
  await page.waitForTimeout(400);
  check((await page.locator(".gvf-embed").count()) === 2, "embed.js renders one card per script tag");
  const embedEn = page.locator(".gvf-embed").first().locator(".c"), embedHi = page.locator(".gvf-embed").nth(1).locator(".c");
  check((await embedEn.innerText()).includes("Civic problem in Gurugram?") && (await embedEn.innerText()).includes("Report it in 2 minutes") && (await embedEn.innerText()).includes("Ward 15"), "embed card shows the invitation and the ward line");
  check((await embedEn.locator("a.b").getAttribute("href")) === httpUrl.replace(/\/$/, "") + "/report?ref=embed" && (await embedEn.locator("a[href$='/ward/15']").count()) === 1, "embed card links to the report form and the ward page on the script's origin");
  check((await embedEn.innerText()).includes("61 reports so far"), "embed card shows the published total from /api/dashboard");
  check((await embedHi.innerText()).includes("नागरिक समस्या") && !(await embedHi.innerText()).includes("Ward"), "Hindi embed reads in Hindi and omits the ward line without data-ward");
  check((await page.evaluate(() => !!document.querySelector(".gvf-embed").shadowRoot)) && (await page.locator("iframe").count()) === 0, "embed uses a shadow root and no iframe");

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
  // A MapLibre stand-in, so the desk Map tab runs without fetching unpkg: loadMapLib() uses window.maplibregl when it exists.
  await ctx.addInitScript(() => {
    const chain = function () { return this; };
    function Map() {} Map.prototype.addControl = chain; Map.prototype.fitBounds = chain; Map.prototype.on = chain;
    function Marker() {} Marker.prototype.setLngLat = chain; Marker.prototype.setPopup = chain; Marker.prototype.addTo = chain; Marker.prototype.remove = chain;
    function Popup() {} Popup.prototype.setHTML = chain;
    function LngLatBounds() {} LngLatBounds.prototype.extend = chain;
    window.maplibregl = { Map, NavigationControl: function () {}, Marker, Popup, LngLatBounds };
  });
  await ctx.addInitScript(() => { try { if (!localStorage.getItem("gvf_visitor")) localStorage.setItem("gvf_visitor", JSON.stringify({ token: "smoke_visitor_token_0001", done: true, views: 9 })); } catch {} });
  // Clipboard stand-in: the Performance tab's Copy button writes the brief here.
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "clipboard", { value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } } }); });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  const session = { access_token: "tok", refresh_token: "ref", expires_at: 9999999999 };
  const staff = { user_id: "u1", name: "Coordinator", role: "coordinator", email: "coord@example.org" };
  const report = (over) => Object.assign({ ref: "GVF-2026-SRV01", issue_type: "waste", issue_label: "Garbage", affects: "My society or RWA", area: "Sector 29", ward: 30, councillor: "Madhu Batra", spot: "Near the gate", lat: null, lng: null,
    stage: 0, desk: null, official_channel: null, official_ticket: null, official_filed_at: null, escalated_to: null, resolved_at: null, resolution_note: null, source: "web",
    reporter_name: "Test Reporter", reporter_phone: "+919899999999", reporter_email: "asha@example.org", consent_at: "2026-10-07T10:00:00Z", description: "Garbage not collected.",
    created_at: "2026-10-07T10:00:00Z", updated_at: "2026-10-07T10:00:00Z", unmapped_overdue: false, filed_overdue: false, events_count: 1, last_event_at: "2026-10-07T10:00:00Z", extra: { where: "Street or lane" }, attachments: [] }, over);
  const filing = { portal: "GMDA integrated grievance portal or Swachhata app", url: "https://services.gmda.gov.in/", note: "A geo-tagged photo routes the complaint.",
    fields: [{ key: "where", label: "Type of place", required: true, value: "Street or lane", missing: false }, { key: "since", label: "Since when", required: false, value: "", missing: false }],
    docs: [{ key: "photo", label: "Photo of the garbage", required: true, files: [], have: false, missing: true }], missing: ["Photo of the garbage"], complete: false };
  let events = [{ stage: 0, note: "Report received", actor: "system", created_at: "2026-10-07T10:00:00Z" }];
  let state = report();
  const patches = [];
  let askedAt = null, replies = [];
  const askCalls = [], extractCalls = [];
  await page.route("**/api/triage/reports/GVF-2026-SRV01/ask", (route) => { askCalls.push(route.request().method()); askedAt = "2026-10-08T09:00:00Z";
    replies = [{ id: "11111111-1111-4111-8111-111111111111", from_email: "asha@example.org", subject: "Re: [GVF-2026-SRV01] A few details needed for your report", body_text: "Since 1 October. Photo attached.", attachments: [{ name: "spot.jpg", type: "image/jpeg", stored: true, kind: "photo" }], received_at: "2026-10-08T10:00:00Z", status: "new" }];
    return json(route, 200, { ok: true, sent: true, to: "asha@example.org", asked_at: askedAt, missing: ["Photo of the garbage"] }); });
  await page.route("**/api/triage/reports/GVF-2026-SRV01/extract", (route) => { extractCalls.push(JSON.parse(route.request().postData() || "{}")); return json(route, 200, { ok: true, fields: { since: "2026-10-01" }, provider: "gemini", model: "x" }); });
  const authed = (route) => (route.request().headers()["authorization"] || "") === "Bearer tok";
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/triage/login", (route) => {
    const b = JSON.parse(route.request().postData() || "{}");
    if (b.password !== "secret-pass") return json(route, 401, { ok: false, error: "bad_credentials" });
    if (b.email === "content@example.org") return json(route, 200, { ok: true, session, staff: { user_id: "u3", name: "Content Person", role: "content", email: "content@example.org" } });
    if (b.email === "vol@example.org") return json(route, 200, { ok: true, session, staff: { user_id: "u2", name: "Vol One", role: "triage", email: "vol@example.org", wards: [10] } });
    if (b.email === "owner@example.org") return json(route, 200, { ok: true, session, staff: { user_id: "u0", name: "Owner", role: "owner", email: "owner@example.org" } });
    return json(route, 200, { ok: true, session, staff });
  });
  const reportListCalls = [];
  await page.route("**/api/triage/reports?**", (route) => { reportListCalls.push(route.request().url()); if (!authed(route)) return json(route, 401, { ok: false, error: "unauthenticated" });
    if (route.request().url().includes("fields=map")) return json(route, 200, { ok: true, reports: [{ ref: "GVF-2026-OLD02", issue_type: "waste", issue_label: "Garbage", area: "Sector 29", ward: 30, stage: 0, lat: 28.4595, lng: 77.0266 }], total: 1 });
    if (/[?&]stage=0\b/.test(route.request().url())) { const rows = [state, report({ ref: "GVF-2026-OLD02", stage: 0, created_at: "2026-09-20T10:00:00Z", unmapped_overdue: true })].filter((r) => r.stage === 0); return json(route, 200, { ok: true, reports: rows, total: rows.length, offset: 0, limit: 20 }); }
    return json(route, 200, { ok: true, reports: [state, report({ ref: "GVF-2026-OLD02", stage: 0, created_at: "2026-09-20T10:00:00Z", unmapped_overdue: true })], total: 2, offset: 0, limit: 50,
    summary: { total: 2, received: 2, filed: 0, escalated: 0, resolved: 0, unmapped_past_due: 1, filed_past_due: 0 } }); });
  await page.route("**/api/triage/reports/GVF-2026-SRV01", (route) => {
    if (!authed(route)) return json(route, 401, { ok: false, error: "unauthenticated" });
    if (route.request().method() === "PATCH") {
      const p = JSON.parse(route.request().postData() || "{}"); patches.push(p);
      state = report({ stage: p.official_ticket ? 2 : (p.stage ?? state.stage), desk: p.desk ?? state.desk, official_ticket: p.official_ticket ?? state.official_ticket, official_channel: p.official_channel ?? state.official_channel, events_count: 3, extra: Object.assign({}, state.extra, p.extra || {}) });
      events = events.concat(p.official_ticket ? [{ stage: 2, note: "Filed officially, ticket " + p.official_ticket, actor: "Coordinator <coord@example.org>", created_at: "2026-10-08T10:00:00Z" }, { stage: 2, note: p.note, actor: "Coordinator <coord@example.org>", created_at: "2026-10-08T10:00:01Z" }] : [{ stage: state.stage, note: p.note, actor: "Coordinator <coord@example.org>", created_at: "2026-10-08T10:00:01Z" }]);
    }
    const fc = Object.assign({}, filing, { fields: filing.fields.map((f) => Object.assign({}, f, { value: (state.extra || {})[f.key] || "" })) });
    return json(route, 200, { ok: true, report: Object.assign({ asked_at: askedAt }, state), events, volunteers: { lead_name: "Vol One", lead_email: "vol@example.org", support_name: null, support_email: null }, filing: fc, replies });
  });
  const staffPosts = [];
  await page.route("**/api/triage/staff", (route) => { if (route.request().method() === "POST") { const b = JSON.parse(route.request().postData() || "{}"); staffPosts.push(b); return json(route, 201, { ok: true, staff: { user_id: "u9", name: b.name, email: b.email, role: b.role, phone: b.phone || null } }); } return json(route, 405, { ok: false, error: "method" }); });
  // Roster (GET/PUT /api/triage/team): a coordinator over wards 1-6 who also leads ward 7, a ward volunteer leading ward 10, a content person; 36 ward rows derived from it
  const people = [
    { user_id: "u1", name: "Coordinator", email: "coord@example.org", phone: "+919800000001", role: "coordinator", active: true, created_at: "2026-09-01T00:00:00Z", wards: [1, 2, 3, 4, 5, 6].map((w) => ({ ward: w, role: "coordinator" })).concat([{ ward: 7, role: "lead" }]) },
    { user_id: "u2", name: "Vol One", email: "vol@example.org", phone: "+919800000002", role: "triage", active: true, created_at: "2026-09-02T00:00:00Z", wards: [{ ward: 10, role: "lead" }] },
    { user_id: "u3", name: "Content Person", email: "content@example.org", phone: null, role: "content", active: true, created_at: "2026-09-03T00:00:00Z", wards: [] }];
  const teamWards = () => Array.from({ length: 36 }, (_, i) => { const w = i + 1, row = { ward: w, councillor: w === 10 ? "Mahabir" : w === 30 ? "Madhu Batra" : "Councillor " + w };
    for (const r of ["coordinator", "lead", "support"]) { const p = people.find((x) => x.wards.some((y) => y.ward === w && y.role === r)); row[r + "_user_id"] = p ? p.user_id : null; row[r + "_name"] = p ? p.name : null; row[r + "_phone"] = p ? p.phone : null; }
    return row; });
  const teamPuts = [];
  await page.route("**/api/triage/team", (route) => { if (!authed(route)) return json(route, 401, { ok: false, error: "unauthenticated" });
    if (route.request().method() === "PUT") { const b = JSON.parse(route.request().postData() || "{}"); teamPuts.push(b); const p = people.find((x) => x.user_id === b.user_id); if (!p) return json(route, 404, { ok: false, error: "not_found" });
      if (typeof b.name === "string") p.name = b.name; if (typeof b.phone === "string") p.phone = b.phone; if (typeof b.active === "boolean") p.active = b.active; if (Array.isArray(b.wards)) p.wards = b.wards; return json(route, 200, { ok: true, person: p }); }
    return json(route, 200, { ok: true, people, wards: teamWards() }); });
  // Metrics (GET /api/triage/metrics): ward 10 has an old report, ward 30 is quiet, ward 3 has fresh ones; Vol One has not acted in 7 days
  const brief = "Good morning. 6 open reports, 2 overdue.\nWard 10: 4 open, oldest 25 days, 2 overdue.\nWard 3: 2 open.\nVol One has not acted in 7 days.";
  await page.route("**/api/triage/metrics", (route) => { if (!authed(route)) return json(route, 401, { ok: false, error: "unauthenticated" }); return json(route, 200, { ok: true, generated_at: "2026-10-08T03:30:00Z",
    totals: { open: 6, unmapped: 2, overdue: 2, received_7d: 3, resolved_7d: 1 },
    wards: [{ ward: 3, councillor: "Councillor 3", open: 2, a0_3: 2, a4_7: 0, a8_21: 0, a22p: 0, unmapped: 1, overdue: 0, received_7d: 2, resolved_7d: 0, oldest_open_days: 2, last_activity_at: "2026-10-07T10:00:00Z" },
      { ward: 10, councillor: "Mahabir", open: 4, a0_3: 1, a4_7: 1, a8_21: 1, a22p: 1, unmapped: 1, overdue: 2, received_7d: 1, resolved_7d: 1, oldest_open_days: 25, last_activity_at: "2026-10-01T10:00:00Z" },
      { ward: 30, councillor: "Madhu Batra", open: 0, a0_3: 0, a4_7: 0, a8_21: 0, a22p: 0, unmapped: 0, overdue: 0, received_7d: 0, resolved_7d: 0, oldest_open_days: 0, last_activity_at: null }],
    people: [{ user_id: "u1", name: "Coordinator", email: "coord@example.org", phone: "+919800000001", role: "coordinator", active: true, wards: [1, 2, 3, 4, 5, 6].map((w) => ({ ward: w, role: "coordinator" })).concat([{ ward: 7, role: "lead" }]), actions_7d: 5, actions_30d: 12, last_action_at: "2026-10-07T10:00:00Z", open_in_wards: 2, overdue_in_wards: 0 },
      { user_id: "u2", name: "Vol One", email: "vol@example.org", phone: "+919800000002", role: "triage", active: true, wards: [{ ward: 10, role: "lead" }], actions_7d: 0, actions_30d: 3, last_action_at: "2026-09-25T10:00:00Z", open_in_wards: 4, overdue_in_wards: 2 }],
    brief: { text: brief, line: "6 open, 2 overdue" } }); });
  // Inbox (table inbox): mail to the Forum; the list carries counts, the per-id route takes PATCH {status} or {notes}
  const inboxRows = [
    { id: "e1", source: "email", from_email: "asha@example.org", from_name: "Asha Verma", subject: "Streetlight out in Sector 45", body_text: "The light near the park gate has been out for a week.\nLine two.\nLine three.\nLine four.\nLine five, which makes this long enough to clip.", received_at: "2026-10-08T05:00:00Z", status: "new", notes: "", handled_by: null },
    { id: "e2", source: "email", from_email: "rohit@example.org", from_name: "Rohit Mehra", subject: "Thanks for the camp", body_text: "Short note.", received_at: "2026-10-05T05:00:00Z", status: "done", notes: "Replied by phone.", handled_by: "Coordinator", report_id: "r-1", report_ref: "GVF-2026-SRV01", attachments: [] }];
  const inboxCalls = [], inboxPatches = [];
  const inboxCounts = () => ({ new: inboxRows.filter((r) => r.status === "new").length, read: inboxRows.filter((r) => r.status === "read").length, done: inboxRows.filter((r) => r.status === "done").length, total: inboxRows.length });
  await page.route("**/api/triage/inbox?**", (route) => { const u = new URL(route.request().url()); inboxCalls.push(u.search); if (!authed(route)) return json(route, 401, { ok: false, error: "unauthenticated" });
    const st = u.searchParams.get("status") || "new"; return json(route, 200, { ok: true, items: inboxRows.filter((r) => st === "all" || r.status === st), counts: inboxCounts() }); });
  await page.route("**/api/triage/inbox/*", (route) => { if (!authed(route)) return json(route, 401, { ok: false, error: "unauthenticated" }); const id = route.request().url().split("/").pop().split("?")[0]; const r = inboxRows.find((x) => x.id === id); if (!r) return json(route, 404, { ok: false, error: "not_found" });
    if (route.request().method() === "PATCH") { const b = JSON.parse(route.request().postData() || "{}"); inboxPatches.push({ id, body: b }); if (b.status) r.status = b.status; if (typeof b.notes === "string") r.notes = b.notes; r.handled_by = "Coordinator"; }
    return json(route, 200, { ok: true, item: r }); });
  // Join requests (table joins): owners and coordinators only; the list carries counts, the per-id route takes PATCH {status} or {notes}
  const joinRows = [
    { id: "j1", name: "Asha Verma", phone: "+919811122233", email: "asha@example.org", role: "Ward volunteer", area: "Sector 56", note: "Weekends only, can help with camps.", status: "new", notes: "", handled_by: null, created_at: "2026-10-08T06:00:00Z", updated_at: "2026-10-08T06:00:00Z" },
    { id: "j2", name: "Rohit Mehra", phone: "+919811144455", email: "rohit@example.org", role: "Research", area: "DLF Phase 3", note: "RTI drafting.", status: "contacted", notes: "Called 7 Oct.", handled_by: "Coordinator", created_at: "2026-10-06T06:00:00Z", updated_at: "2026-10-07T06:00:00Z" }];
  const joinCalls = [], joinPatches = [];
  const joinCounts = () => ({ new: joinRows.filter((r) => r.status === "new").length, contacted: joinRows.filter((r) => r.status === "contacted").length, onboarded: joinRows.filter((r) => r.status === "onboarded").length, declined: joinRows.filter((r) => r.status === "declined").length, total: joinRows.length });
  await page.route("**/api/triage/joins?**", (route) => { const u = new URL(route.request().url()); joinCalls.push(u.search); if (!authed(route)) return json(route, 401, { ok: false, error: "unauthenticated" });
    const role = (page._joinRole || "coordinator"); if (role !== "owner" && role !== "coordinator") return json(route, 403, { ok: false, error: "forbidden" });
    const st = u.searchParams.get("status") || "new", q = (u.searchParams.get("q") || "").toLowerCase();
    const rows = joinRows.filter((r) => (st === "all" || r.status === st) && (!q || [r.name, r.phone, r.email, r.area].join(" ").toLowerCase().includes(q)));
    if (u.searchParams.get("format") === "csv") return route.fulfill({ status: 200, contentType: "text/csv", body: "name,phone,email,role,area,note,status,notes,created_at\n" + rows.map((r) => [r.name, r.phone, r.email, r.role, r.area, r.note, r.status, r.notes, r.created_at].join(",")).join("\n") });
    return json(route, 200, { ok: true, joins: rows, counts: joinCounts() }); });
  await page.route("**/api/triage/joins/*", (route) => { if (!authed(route)) return json(route, 401, { ok: false, error: "unauthenticated" }); const id = route.request().url().split("/").pop().split("?")[0]; const r = joinRows.find((x) => x.id === id); if (!r) return json(route, 404, { ok: false, error: "not_found" });
    if (route.request().method() === "PATCH") { const b = JSON.parse(route.request().postData() || "{}"); joinPatches.push({ id, body: b }); if (b.status) r.status = b.status; if (typeof b.notes === "string") r.notes = b.notes; r.handled_by = "Coordinator"; r.updated_at = "2026-10-08T07:00:00Z"; }
    return json(route, 200, { ok: true, join: r }); });

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
  const shot = async (name) => { if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + "/" + name + ".png", fullPage: false }); };
  await shot("desk-reports");
  check((await page.locator("#tList .row").count()) === 2, "list shows two reports");
  check((await page.locator("#tList .tag-danger").count()) === 1, "overdue report carries a past-due flag");
  check((await page.locator("#tSummary").innerText()).includes("past due: 1 unmapped"), "summary line shows the counts");
  check(!(await page.locator("#rolesTab").isHidden()) && !(await page.locator("#inboxTab").isHidden()) && !(await page.locator("#performanceTab").isHidden()), "coordinator sees the Inbox, Roles and Performance tabs");
  check((await page.locator("#visitorsTab").isHidden()) && (await page.locator("#subscribersTab").isHidden()) && !(await page.locator("#insightsTab").isHidden()) && !(await page.locator("#contentTab").isHidden()) && !(await page.locator("#newsletterTab").isHidden()) && !(await page.locator("#seoTab").isHidden()), "coordinator sees content, newsletter, pulse and SEO but not the visitors' or subscribers' data");

  // Desk map: the list has loaded two rows, so its offset is 2; the map query must carry the filters only, never offset or limit
  await page.click('[data-tab="map"]');
  await page.waitForTimeout(250);
  const mapCall = reportListCalls.find((u) => u.includes("fields=map")) || "";
  check(mapCall.includes("stage=open") && !/[?&]offset=/.test(mapCall) && !/[?&]limit=/.test(mapCall), "map request carries the filters only, no offset or limit" + (mapCall ? " (" + mapCall.split("?")[1] + ")" : " (no map request)"));
  check((await page.locator("#mapCount").innerText()).includes("1 report with a pinned location"), "map counts the pinned report");
  await page.click('[data-tab="reports"]');
  await page.waitForTimeout(60);

  await page.click('[data-open="GVF-2026-SRV01"]');
  await page.waitForSelector("#editForm");
  if (process.env.SHOTS) await page.waitForTimeout(350);
  await shot("desk-ticket");
  check((await page.locator("#sheetBody").innerText()).includes("Test Reporter"), "detail shows the reporter to signed-in staff");
  check((await page.locator("#sheetBody").innerText()).includes("Lead: Vol One"), "detail shows the ward's lead volunteer");
  check((await page.locator("#sheetBody .tl li").count()) === 1, "detail shows the event timeline");
  check((await page.locator("#sheetBody").innerText()).includes("Filing checklist · GMDA"), "detail shows the filing checklist for the portal");
  check((await page.locator("#sheetBody .chk .tag-danger").count()) === 1 && (await page.locator("#askMissing").count()) === 1, "checklist flags the missing photo and offers to ask the reporter");
  check((await page.locator("#sheetBody").innerText()).includes("Emails asha@example.org from the desk"), "ask button says the mail goes from the desk");
  check((await page.locator("#sheetBody .replies").count()) === 0, "no replies yet");
  await page.click("#askMissing");
  await page.waitForSelector("#askedAt");
  check(askCalls.length === 1 && askCalls[0] === "POST", "asking the reporter POSTs to the ask endpoint, no mail app");
  check((await page.locator("#askedAt").innerText()).includes("Asked by email on"), "ticket shows when the reporter was asked");
  check((await page.locator("#sheetBody .replies .reply").count()) === 1 && (await page.locator("#sheetBody .replies").innerText()).includes("Since 1 October") && (await page.locator("#sheetBody .replies").innerText()).includes("spot.jpg"), "the reporter's reply and its file show on the ticket");
  await page.click("#sheetBody [data-fill]");
  await page.waitForSelector("#sheetBody [data-apply]");
  check(extractCalls.length === 1 && extractCalls[0].inbox_id === "11111111-1111-4111-8111-111111111111", "reading the reply POSTs its inbox id to the extract endpoint");
  check((await page.locator("#sheetBody .fillbox").innerText()).includes("Since when") && (await page.locator("#sheetBody .fillbox").innerText()).includes("2026-10-01"), "the proposal names the field and the value found");
  await page.click("#sheetBody [data-apply]");
  await page.waitForFunction(() => document.querySelectorAll("#sheetBody .tl li").length === 2);
  check(patches.length === 1 && patches[0].extra && patches[0].extra.since === "2026-10-01" && /Filled from the reporter's reply/.test(patches[0].note), "applying the proposal PATCHes the filing field with a timeline note");
  check((await page.locator("#ex_since").inputValue()) === "2026-10-01", "the applied value is in the form");
  check((await page.locator("#ex_where").inputValue()) === "Street or lane", "filing details are editable at the desk");
  await page.fill("#ex_since", "2026-10-02");
  await page.fill("#eDesk", "MCG sanitation wing");
  await page.selectOption("#eChan", "GMDA portal");
  await page.fill("#eTicket", "GMDA-4471");
  await page.fill("#eNote", "Filed on the portal.");
  await page.click("#eSave");
  await page.waitForTimeout(250);
  check(patches.length === 2 && patches[1].desk === "MCG sanitation wing" && patches[1].official_ticket === "GMDA-4471" && patches[1].official_channel === "GMDA portal" && patches[1].note === "Filed on the portal." && !("stage" in patches[1]) && patches[1].extra && patches[1].extra.since === "2026-10-02" && !("where" in patches[1].extra), "save sends only the changed fields, including the filing detail");
  check((await page.locator("#sheetBody .tl li").count()) === 4, "timeline refreshes after saving");
  check((await page.locator("#row_GVF-2026-SRV01 .tag").first().innerText()).includes("Filed officially"), "list row updates to the new stage");
  await page.click("#sheetClose");

  const contentCalls = [];
  const deskPosts = [{ id: "p9", kind: "news", slug: "x", title: "Existing draft", published: false, pinned: false, created_at: "2026-10-07T10:00:00Z", created_by: "Coordinator" },
    { id: "p8", kind: "story", slug: "weekly-round-up-week-41", title: "Weekly round-up: week 41", source: "auto:weekly:2026-W41", published: false, pinned: false, tags: ["weekly"], created_at: "2026-10-07T10:00:00Z", created_by: "cron" },
    { id: "p7", kind: "news", slug: "camp-on-sunday", title: "Camp on Sunday", summary: "Property tax camp at the community centre.", published: true, published_at: "2026-10-06T10:00:00Z", pinned: false, tags: ["camp"], created_at: "2026-10-06T09:00:00Z", created_by: "Owner" }];
  // Social publishing: Telegram and Bluesky connected, Facebook, Instagram and X not; one earlier share of p7 to Telegram
  const socialCalls = [], socialShares = [{ id: 1, post_id: "p7", platform: "telegram", status: "sent", external_url: "https://t.me/gvf/5", attempts: 1, created_at: "2026-10-06T10:01:00Z", sent_at: "2026-10-06T10:01:00Z" }];
  const socialChannels = [{ platform: "facebook", label: "Facebook Page", configured: false, image: "optional", needs: ["META_PAGE_ID", "META_PAGE_TOKEN"] }, { platform: "instagram", label: "Instagram", configured: false, image: "required", needs: ["META_IG_USER_ID", "META_PAGE_TOKEN"] }, { platform: "telegram", label: "Telegram channel", configured: true, image: "optional", needs: [] }, { platform: "bluesky", label: "Bluesky", configured: true, image: "optional", needs: [] }, { platform: "x", label: "X (Twitter)", configured: false, image: "none", needs: ["X_API_KEY"] }];
  await page.route("**/api/triage/social", (route) => { if (route.request().method() === "GET") return json(route, 200, { ok: true, channels: socialChannels, shares: socialShares });
    const b = JSON.parse(route.request().postData() || "{}"); socialCalls.push(b); const results = (b.platforms || []).map((pl) => { const row = { id: socialShares.length + 1, post_id: b.post_id, platform: pl, status: "sent", external_url: pl === "bluesky" ? "https://bsky.app/profile/gvf/post/abc" : "https://t.me/gvf/9", attempts: 1, created_at: "2026-10-08T10:00:00Z", sent_at: "2026-10-08T10:00:00Z" }; socialShares.unshift(row); return { platform: pl, status: "sent", url: row.external_url }; });
    return json(route, 200, { ok: true, results, sent: results.length, failed: 0, skipped: 0 }); });
  await page.route("**/api/triage/content", (route) => { const mth = route.request().method(); if (mth === "GET") return json(route, 200, { ok: true, posts: deskPosts, settings: { social: { x: "https://x.com/gvf" }, autopost: { enabled: true, weekday: 0, review_hours: 24 } } }); const b = JSON.parse(route.request().postData() || "{}"); contentCalls.push({ method: mth, body: b });
    if (mth === "PATCH" && Array.isArray(b.tags)) { const dp = deskPosts.find((x) => x.id === b.id); if (dp) dp.tags = b.tags; }
    if (mth === "PUT") return json(route, 200, { ok: true, settings: b.settings });
    return json(route, mth === "POST" ? 201 : 200, { ok: true, post: { id: "p10", ...b } }); });
  await page.route("**/api/triage/draft", (route) => json(route, 503, { ok: false, error: "draft_unavailable" }));
  const newsletterSaves = [], newsletterPreviews = [], newsletterActions = [];
  const NL_SENT = { id: 7, subject: "September round-up", subject_hi: null, body: "x".repeat(40), body_hi: null, status: "sent", channel: "outbox", recipients: 120, sent: 120, failed: 0, sent_at: "2026-10-01T03:00:00Z", sent_by: "Owner <owner@example.org>", created_at: "2026-09-30T10:00:00Z", updated_at: "2026-10-01T03:00:00Z", test_sent_at: "2026-09-30T11:00:00Z" };
  const NL_DRAFT = { id: 8, subject: "Draft about drains", subject_hi: null, body: "y".repeat(40), body_hi: null, status: "draft", channel: null, recipients: 0, sent: 0, failed: 0, created_at: "2026-10-07T10:00:00Z", updated_at: "2026-10-07T10:00:00Z", created_by: "Content <c@example.org>" };
  await page.route("**/api/triage/newsletter**", (route) => {
    const req = route.request(), url = req.url();
    if (req.method() === "POST" && url.endsWith("/newsletter/preview")) { const b = req.postDataJSON(); newsletterPreviews.push(b); return json(route, 200, { ok: true, subject: b.subject, html: "<html><body><h1>" + b.subject + "</h1><p>" + b.body.split("\n")[2] + "</p></body></html>", subject_hi: null, html_hi: null }); }
    if (req.method() === "POST" && /\/newsletter\/\d+$/.test(url)) { const b = req.postDataJSON(); newsletterActions.push({ url, body: b }); return json(route, 200, b.action === "test" ? { ok: true, to: "owner@example.org", test_sent_at: "2026-10-08T07:00:00Z" } : { ok: true, channel: "outbox", recipients: 4, sent: 4, failed: 0, remaining: 0, campaign: { id: 9, status: "sent" } }); }
    if (req.method() === "POST") { const b = req.postDataJSON(); newsletterSaves.push(b); return json(route, 200, { ok: true, campaign: { ...NL_DRAFT, ...b, id: 9 } }); }
    if (req.method() === "DELETE") return json(route, 200, { ok: true, deleted: true });
    return json(route, 200, { ok: true, confirmed: 4, channel: { mode: "outbox", flush_now: 100, daily_cap: 100 }, campaigns: [NL_DRAFT, NL_SENT] });
  });
  const subscriberPatches = [], subscriberPosts = [];
  await page.route("**/api/triage/subscribers**", (route) => {
    const req = route.request();
    if (req.method() === "PATCH") { subscriberPatches.push({ url: req.url(), body: req.postDataJSON() }); return json(route, 200, { ok: true, item: { id: 1, status: "unsubscribed" }, sync: { ok: true } }); }
    if (req.method() === "POST") { subscriberPosts.push(req.postDataJSON()); return json(route, 200, { ok: true, status: "check_email" }); }
    if (req.url().includes("export=csv")) return route.fulfill({ status: 200, contentType: "text/csv", body: "email\n" });
    return json(route, 200, { ok: true, status: "all", q: "", sync: { enabled: true, provider: "resend" }, counts: { total: 4, confirmed: 2, pending: 1, unsubscribed: 1, synced: 2, sync_failed: 0 }, items: [
      { id: 1, email: "reader@example.org", lang: "en", source: "site", status: "confirmed", created_at: "2026-10-01T10:00:00Z", confirmed_at: "2026-10-01T10:05:00Z", unsubscribed_at: null, synced_at: "2026-10-01T10:05:01Z", sync_error: null },
      { id: 2, email: "hindi@example.org", lang: "hi", source: "site", status: "confirmed", created_at: "2026-10-02T10:00:00Z", confirmed_at: "2026-10-02T10:05:00Z", unsubscribed_at: null, synced_at: null, sync_error: null },
      { id: 3, email: "pending@example.org", lang: "en", source: "desk", status: "pending", created_at: "2026-10-03T10:00:00Z", confirmed_at: null, unsubscribed_at: null, synced_at: null, sync_error: null },
      { id: 4, email: "gone@example.org", lang: "en", source: "site", status: "unsubscribed", created_at: "2026-10-04T10:00:00Z", confirmed_at: "2026-10-04T10:05:00Z", unsubscribed_at: "2026-10-06T10:00:00Z", synced_at: "2026-10-06T10:00:01Z", sync_error: null }
    ] });
  });
  await page.route("**/api/triage/visitors**", (route) => json(route, 200, { ok: true, stats: { visitors_total: 12, visitors_new: 5, events_by_type: { page_view: 340, report_start: 9, report_submit: 4, gate_shown: 20, gate_done: 12 }, top_paths: [{ path: "#/", n: 120 }] }, visitors: [{ name: "Gate Person", phone: "+919811111111", email: "gate@example.org", area: "Sector 45", pincode: "122003", city: "Gurugram", created_at: "2026-10-07T10:00:00Z", visits: 2 }], total: 12 }));
  await page.route("**/api/health", (route) => json(route, 200, { ok: false, checks: { db: { ok: true, ms: 12 }, storage: { ok: true }, cron: { ok: true, last_run_at: "2026-10-07T03:30:00Z", hours_since: 5 }, outbox: { pending: 2, failed: 0 }, links: { checked: 61, broken: [{ url: "https://example.org/dead", status: 404, where_used: "PORTALS" }] }, news: { sources: 20, items: 150, stale_sources: [] } }, version: "0ab1cd3" }));
  await page.click('[data-tab="content"]');
  await page.waitForTimeout(250);
  check((await page.locator("#postList").innerText()).includes("Existing draft") && (await page.locator("#sX").inputValue()) === "https://x.com/gvf", "content tab lists posts and loads the social links");
  check((await page.locator("#composer").isHidden()) && (await page.locator("#contentCounts").innerText()).replace(/\s+/g, " ").includes("2 Drafts"), "the composer stays closed until New post; counts strip reads the posts");
  await shot("desk-content");
  check((await page.locator('#postList li[data-pid="p7"] .pshares .tag-green').innerText()).includes("TG") && (await page.locator('#postList li[data-pid="p7"] [data-pshare]').count()) === 1 && (await page.locator('#postList li[data-pid="p9"] [data-pshare]').count()) === 0, "a published post shows its share chips and a Share button; a draft does not");
  await page.click("#postNew");
  check(!(await page.locator("#composer").isHidden()), "New post opens the composer");
  check((await page.locator('#pShare input[data-share="new"]').count()) === 2 && (await page.locator('#pShare input[value="telegram"]').count()) === 1 && (await page.locator('#pShare input[value="facebook"]').count()) === 0, "the composer offers only the connected accounts");
  await page.check('#pShare input[value="telegram"]');
  await shot("desk-content-composer");
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
  check(socialCalls.length === 1 && socialCalls[0].post_id === "p10" && JSON.stringify(socialCalls[0].platforms) === JSON.stringify(["telegram"]), "saving a published post with a ticked account POSTs the share (" + JSON.stringify(socialCalls) + ")");
  await page.click('#postList li[data-pid="p7"] [data-pshare]');
  check(!(await page.locator("#share_p7").isHidden()) && (await page.locator('#share_p7 input[value="telegram"]').isDisabled()) && !(await page.locator('#share_p7 input[value="bluesky"]').isDisabled()), "Share opens the chooser with the already-shared account disabled");
  await page.check('#share_p7 input[value="bluesky"]');
  await page.click('#share_p7 [data-sharego="p7"]');
  await page.waitForTimeout(300);
  check(socialCalls.length === 2 && socialCalls[1].post_id === "p7" && JSON.stringify(socialCalls[1].platforms) === JSON.stringify(["bluesky"]) && (await page.locator('#postList li[data-pid="p7"] .pshares a[href="https://bsky.app/profile/gvf/post/abc"]').count()) === 1, "Share now POSTs the chosen account and the new chip links to the live post");
  await page.click('#postList [data-ppub="p9"]');
  await page.waitForTimeout(150);
  check(contentCalls.length === 2 && contentCalls[1].method === "PATCH" && contentCalls[1].body.id === "p9" && contentCalls[1].body.published === true, "publish toggles through a PATCH");
  await page.click('[data-tab="health"]');
  await page.waitForTimeout(200);
  check((await page.locator("#healthBody .tag-green").count()) >= 3 && (await page.locator("#healthBody .tag-danger").count()) === 1 && (await page.locator("#healthBody").innerText()).includes("example.org/dead"), "health tab flags the broken link and passes the rest");
  await page.click('[data-tab="reports"]');
  await page.waitForTimeout(100);
  const seoFixture = { ok: true, site: "https://gurugramvisionforum.org", summary: { pages: 3, audited: 2, avg_score: 96, errors: 1, issues: [{ code: "title_long", count: 1, label: "Title too long" }, { code: "status", count: 1, label: "The page did not answer 200" }], last_audit: "2026-10-08T21:40:00Z" },
    checklist: [["https", "HTTPS with HSTS", true, true], ["mobile", "Mobile-first: viewport on every page", true, true], ["titles", "Unique titles and descriptions", true, true], ["canonical", "Self-referencing canonical", true, true], ["hreflang", "hreflang en-IN / hi-IN / x-default", true, true], ["schema", "Structured data (JSON-LD)", true, true], ["og", "Open Graph for shares", true, true], ["sitemap", "XML sitemap with lastmod", true, true], ["robots", "robots.txt", true, true], ["indexnow", "IndexNow ping (Bing, Yandex, Naver, Seznam)", true, true], ["links", "Nightly official-link check", false, true], ["content", "Fresh content: weekly data round-up", true, true], ["vitals", "Core Web Vitals (mobile)", true, true], ["thin", "No thin pages", null, true], ["gsc", "Google Search Console verified", false, false], ["bing", "Bing Webmaster Tools verified", false, false], ["mentions", "Off-page: the Forum in the news", true, true]].map((x) => ({ key: x[0], title: x[1], ok: x[2], auto: x[3], detail: "detail for " + x[0], ...(x[3] ? {} : { setting: x[0] + "_verified" }) })),
    pages: [{ url: "https://gurugramvisionforum.org/guide/rti", path: "/guide/rti", lang: "en", kind: "guide", status: 200, ms: 320, title: "Right to information in Gurugram: who fixes it, how to complain, documents", description: "d", words: 900, score: 92, issues: [{ code: "title_long", level: "warn", detail: "74 characters" }], checked_at: "2026-10-08T21:40:00Z" }, { url: "https://gurugramvisionforum.org/ward/9", path: "/ward/9", lang: "en", kind: "ward", status: 500, ms: 8000, title: null, score: 0, issues: [{ code: "status", level: "error", detail: "HTTP 500" }], checked_at: "2026-10-08T21:40:00Z" }, { url: "https://gurugramvisionforum.org/guide/roads", path: "/guide/roads", lang: "en", kind: "guide", status: 200, ms: 210, title: "Roads, footpaths in Gurugram: who fixes it, how to complain", description: "d", words: 930, score: 100, issues: [], checked_at: "2026-10-08T21:40:00Z" }],
    vitals: { latest: [{ url: "https://gurugramvisionforum.org/", strategy: "mobile", performance: 94, seo: 100, accessibility: 97, best_practices: 96, lcp_ms: 1710, cls: 0.004, tbt_ms: 40, checked_at: "2026-10-08T21:41:00Z" }], history: [], tracked: [] },
    mentions: [{ url: "https://www.tribuneindia.com/forum-maps-potholes", title: "Residents' forum maps every pothole in Gurugram", source: "The Tribune", published_at: "2026-10-06T08:00:00Z" }],
    opportunities: [{ issue_type: "waste", area: "Sector 45", mentions: 6, title: "Garbage in Sector 45: what residents are reporting and where to file it", target: "/guide/waste", why: "6 public posts in 14 days, nothing published on it", examples: [{ title: "Garbage piling up near Sector 45 market", url: "https://www.reddit.com/r/gurgaon/x" }], auto: { state: "queued", position: 2, eta_days: 0 } }],
    topics: { enabled: true, per_week: 3, review_hours: 48, posts: [] },
    agent: { schedule: { plan: "09:00", work: "13:00", report: "19:00" }, repo: "https://github.com/saurabhrao17/Gurugram-Vision-Forum/tree/seo-agent-log", last_run: "2026-10-09T07:30:05Z",
      open: [{ key: "page:canonical_other", area: "pages", severity: "medium", owner: "code", title: "Canonical points elsewhere on 2 pages", detail: "/about, /join", action: "A change to the site's code or data.", status: "open", first_seen: "2026-10-08T03:30:00Z", last_action_at: "2026-10-09T07:30:02Z", last_result: null },
        { key: "index:unknown", area: "index", severity: "medium", owner: "auto", title: "5 pages Google does not know yet", detail: "/guides, /hi/guides", action: "Ping IndexNow with these pages and resubmit the sitemap.", status: "open", first_seen: "2026-10-08T03:30:00Z", last_action_at: "2026-10-09T03:30:02Z", last_result: "Pinged IndexNow (Bing and others) with 5 pages Google does not know yet" }],
      fixed: [{ key: "link:/hi/wards", title: "Broken internal link: /hi/wards (HTTP 404)", resolved_at: "2026-10-09T07:30:03Z" }],
      log: [{ at: "2026-10-09T07:30:03Z", day: "2026-10-09", phase: "work", kind: "check", text: "Fixed: Broken internal link: /hi/wards (HTTP 404)", ok: true },
        { at: "2026-10-09T03:30:01Z", day: "2026-10-09", phase: "plan", kind: "plan", text: "Plan for today: 2 open tasks: 1 the agent handles, 0 waiting on search engines, 1 need a code change, 0 need a person", ok: null }],
      reports: [{ id: "weekly:2026-W41", kind: "weekly", day: "2026-10-09", summary: {}, markdown: "# SEO agent: plan for 2026-W41\n\n## This week\n\n### Content (topic pipeline, up to 3 posts)\n\n1. Garbage: 27 public posts in 14 days\n\n### Needs a code change (1)\n\n- **Canonical points elsewhere on 2 pages** — fix the head" },
        { id: "daily:2026-10-08", kind: "daily", day: "2026-10-08", summary: { fixed: 1, opened: 2, open: 2 }, markdown: "# SEO agent: daily report, 8 Oct 2026\n\n## Fixed today (1)\n\n- Broken internal link: /hi/wards\n\n<script>alert(1)</script>" }] },
    activity: [{ at: "2026-10-08T21:42:00Z", step: "seo", text: "Audited 40 of 131 pages, average score 97", ok: true }, { at: "2026-10-08T02:31:00Z", step: "indexnow", text: "Pinged IndexNow with 6 URLs", ok: true }],
    settings: { indexnow: true, gsc_verified: false, bing_verified: false }, labels: { title_long: "Title too long", status: "The page did not answer 200" } };
  Object.assign(seoFixture, {
    clusters: [{ id: "roads", label: "Roads, footpaths", pillar: "/guide/roads", pillar_score: 100, members: 0, latest: null, age_days: null, demand: 4, status: "gap", action: "Write the first post: 4 public mentions in 14 days and nothing published yet.", posts: [], auto: { state: "queued", position: 1, eta_days: 0 } },
      { id: "waste", label: "Garbage", pillar: "/guide/waste", pillar_score: 100, members: 2, latest: "2026-10-01T00:00:00Z", age_days: 7, demand: 1, status: "ok", action: "Nothing to do; the cluster is covered and fresh.", posts: [], auto: { state: "published", slug: "waste-gurugram-2026-10" } }],
    geo: { pages: 2, avg: 93, missing: [{ key: "dated", count: 1, label: "Dated, so freshness is visible" }], asked: 2, cited: 1,
      questions: [{ key: "issue:roads", question: "Who is responsible for roads, footpaths problems in Gurugram, and how do I file a complaint that gets acted on?", cited: true, position: 2, sources: [{ title: "mcg.gov.in" }, { title: "gurugramvisionforum.org" }], checked_at: "2026-10-08T21:45:00Z" },
        { key: "issue:waste", question: "Who is responsible for garbage problems in Gurugram, and how do I file a complaint that gets acted on?", cited: false, sources: [{ title: "hindustantimes.com" }], checked_at: "2026-10-08T21:45:00Z" },
        { key: "issue:water", question: "Who is responsible for water, sewer problems in Gurugram, and how do I file a complaint that gets acted on?", cited: null, sources: [] },
        { key: "issue:drains", question: "Who is responsible for drains, flooding problems in Gurugram, and how do I file a complaint that gets acted on?", cited: null, sources: [], error: "http_429_RESOURCE_EXHAUSTED: You exceeded your current quota", checked_at: "2026-10-09T21:45:00Z" }] },
    search: { google: { queries: [{ key: "who fixes potholes gurugram", clicks: 3, impressions: 140, ctr: 0.0214, position: 7.4 }], pages: [{ key: "/guide/roads", clicks: 3, impressions: 160, ctr: 0.0188, position: 6.9 }], period: { start: "2026-09-09", end: "2026-10-06" }, totals: { clicks: 3, impressions: 160 } }, bing: null },
    index: { total: 2, indexed: 1, rows: [{ url: "https://gurugramvisionforum.org/ward/9", verdict: "NEUTRAL", coverage: "Discovered - currently not indexed" }, { url: "https://gurugramvisionforum.org/guide/roads", verdict: "PASS", coverage: "Submitted and indexed", last_crawl: "2026-10-07T01:00:00Z" }] },
    crawl: { broken: [{ url: "/guide/old", status: 404, sources: ["/guide/roads"] }], orphans: [], complete: false },
    sitechecks: [{ key: "llms", ok: true, detail: "64 links for AI engines", checked_at: "2026-10-08T21:40:00Z" }, { key: "headers", ok: false, detail: "Missing: csp", checked_at: "2026-10-08T21:40:00Z" }],
    connections: { gsc: true, bing: false, gemini: true, groq: true, pagespeed: true }
  });
  await page.route("**/api/triage/seo", (route) => json(route, 200, seoFixture));
  await page.click('[data-tab="seo"]');
  await page.waitForTimeout(200);
  const seoCounts = (await page.locator("#seoCounts").innerText()).replace(/\s+/g, " ");
  check(seoCounts.includes("96 Site health") && seoCounts.includes("2 open issues") && seoCounts.includes("93 GEO readiness") && seoCounts.includes("cited in 1 of 2 AI answers") && seoCounts.includes("3 Search clicks") && seoCounts.includes("1/2 Indexed") && seoCounts.includes("94 Mobile speed"), "SEO counts: site health, GEO readiness with AI citations, search clicks, indexed pages, mobile speed");
  check((await page.locator("#seoTabs .stab").allInnerTexts()).join("|") === "Overview|Agent|Pages|Clusters|GEO|Search data|Speed" && !(await page.locator('#seoBody [data-cpane="overview"]').isHidden()) && (await page.locator('#seoBody [data-cpane="pages"]').isHidden()), "six sub-tabs, Overview open first");
  check((await page.locator("#seoChecklist tbody tr").count()) === 17 && (await page.locator("#seoBody [data-seo-manual]").count()) === 2 && (await page.locator("#seoChecklist .tag-danger").count()) === 1 && (await page.locator("#seoChecklist .tag-warn").count()) === 2, "checklist lists the checks, one in red, the two manual ones as To do with a checkbox");
  check((await page.locator('#seoBody [data-cpane="overview"] .seolog .row').count()) === 2 && (await page.locator('#seoBody [data-cpane="overview"]').innerText()).includes("Audited 40 of 131 pages, average score 97"), "activity log shows what the cron did");
  check((await page.locator("#seoConn .row").count()) === 5 && (await page.locator("#seoConn").innerText()).includes("Add BING_WEBMASTER_API_KEY in Vercel") && (await page.locator("#seoConn").innerText()).includes("AI writing backup (Groq)") && (await page.locator("#seoConn .tag-green").count()) === 4, "connections show what is set up and what to add");
  await page.click('#seoTabs [data-ctab="pages"]');
  await page.waitForTimeout(150);
  check((await page.locator('#seoBody [data-cpane="overview"]').isHidden()) && !(await page.locator('#seoBody [data-cpane="pages"]').isHidden()), "a sub-tab shows its own pane and hides the Overview");
  check((await page.locator("#seoPages tbody tr").count()) === 2 && (await page.locator("#seoPages").innerText()).includes("Title too long") && (await page.locator("#seoPages").innerText()).includes("HTTP 500") && (await page.locator("#seoPages thead").innerText()).includes("GEO"), "page audit shows the pages with issues first, with a GEO column");
  await page.click('[data-seo-pages="all"]');
  check((await page.locator("#seoPages tbody tr").count()) === 3 && (await page.locator("#seoPages .tag-green").count()) >= 2, "All pages lists the clean page too");
  check((await page.locator("#seoBroken").innerText()).includes("/guide/old") && (await page.locator("#seoBroken").innerText()).includes("HTTP 404") && (await page.locator("#seoSite .tag-danger").count()) === 1, "link crawl lists the broken link with the page carrying it; site checks flag the missing header");
  await page.click('#seoTabs [data-ctab="clusters"]');
  await page.waitForTimeout(150);
  check((await page.locator("#seoClusters tbody tr").count()) === 2 && (await page.locator("#seoClusters .tag-danger").innerText()) === "Gap" && (await page.locator("#seoClusters [data-seo-cdraft]").count()) === 1 && (await page.locator("#seoClusters").innerText()).includes("Queued #1") && (await page.locator('#seoClusters a[href$="/blog/waste-gurugram-2026-10"]').count()) === 1, "clusters show what the topic pipeline does with each: queued gap (with Write it now), published post");
  check(await page.evaluate(() => getComputedStyle(document.querySelector("#seoClusters td.n"), "::before").content) !== '"Ward "', "SEO tables never borrow the wards table's phone label");
  await page.click('#seoTabs [data-ctab="geo"]');
  await page.waitForTimeout(150);
  check((await page.locator("#seoGeo tbody tr").count()) === 4 && (await page.locator("#seoGeo").innerText()).includes("Needs Google billing") && !(await page.locator("#seoGeo").innerText()).includes("RESOURCE_EXHAUSTED") && (await page.locator("#seoGeoBilling").count()) === 1 && (await page.locator("#seoGeo").innerText()).includes("Cited #2") && (await page.locator("#seoGeo").innerText()).includes("Not cited") && (await page.locator("#seoGeo").innerText()).includes("Not asked yet") && (await page.locator('#seoBody [data-cpane="geo"] .geoavg').innerText()) === "93" && (await page.locator('#seoBody [data-cpane="geo"] a[href="https://gurugramvisionforum.org/llms.txt"]').count()) === 1, "GEO tab: readiness, the llms.txt link and each AI answer cited or not");
  await page.click('#seoTabs [data-ctab="search"]');
  await page.waitForTimeout(150);
  const searchTxt = await page.locator('#seoBody [data-cpane="search"]').innerText();
  check(searchTxt.includes("who fixes potholes gurugram") && searchTxt.includes("2.1%") && searchTxt.includes("Discovered - currently not indexed") && searchTxt.includes("Not connected. Add BING_WEBMASTER_API_KEY in Vercel."), "Search data: Google queries and pages, index status, and Bing's missing key");
  await page.click('#seoTabs [data-ctab="agent"]');
  await page.waitForTimeout(150);
  const agentTxt = await page.locator('#seoBody [data-cpane="agent"]').innerText();
  check(agentTxt.includes("Plan for today: 2 open tasks") && agentTxt.includes("Fixed: Broken internal link") && (await page.locator("#agentTasks tbody tr").count()) === 2 && (await page.locator("#agentWeek ol.mdl li").count()) === 1 && (await page.locator('#agentStatus a[href$="/tree/seo-agent-log"]').count()) === 1 && agentTxt.includes("Fixed this week"), "Agent tab: today's timeline, the open tasks with who acts, the week's plan and the GitHub link");
  await page.click('[data-agent-report="0"]');
  await page.waitForTimeout(100);
  check((await page.locator('[data-agent-body="0"]').innerText()).includes("Broken internal link: /hi/wards") && (await page.locator('[data-agent-body="0"] script').count()) === 0, "a daily report opens on Read, rendered and escaped");
  await page.click('#seoTabs [data-ctab="speed"]');
  await page.waitForTimeout(150);
  check((await page.locator("#seoBody .vital").count()) === 1 && (await page.locator("#seoBody .vital").innerText()).includes("1.7 s"), "Speed tab shows the Core Web Vitals card");
  await page.click('#seoTabs [data-ctab="overview"]');
  await page.waitForTimeout(100);
  check((await page.locator("#seoBody a[href='https://www.tribuneindia.com/forum-maps-potholes']").count()) === 1, "the news mention renders on the Overview");
  await page.locator('[data-seo-manual="gsc_verified"]').check();
  await page.waitForTimeout(200);
  check(contentCalls[contentCalls.length - 1].method === "PUT" && contentCalls[contentCalls.length - 1].body.settings.seo.gsc_verified === true && !(await page.locator('#seoBody [data-cpane="overview"]').isHidden()), "ticking Search Console saves settings.seo.gsc_verified and the reload keeps the Overview open");
  await page.click('[data-seo-draft="0"]');
  await page.waitForTimeout(200);
  check(!(await page.locator("#tContent").isHidden()) && !(await page.locator("#composer").isHidden()) && (await page.locator("#pTitle").inputValue()) === "Garbage in Sector 45: what residents are reporting and where to file it" && (await page.locator("#pKind").inputValue()) === "story" && (await page.locator("#pTags").inputValue()) === "waste, sector 45", "Write it now opens the composer with the suggested title, kind and tags");
  await page.click('[data-tab="seo"]');
  await page.waitForTimeout(200);
  await page.click('#seoTabs [data-ctab="clusters"]');
  await page.click('[data-seo-cdraft="roads"]');
  await page.waitForTimeout(200);
  check(!(await page.locator("#composer").isHidden()) && (await page.locator("#pTitle").inputValue()) === "Roads, footpaths in Gurugram: what residents are reporting and who fixes it" && (await page.locator("#pTags").inputValue()) === "roads", "a cluster's Draft opens the composer tagged with the cluster");
  const trCalls = [];
  await page.route("**/api/triage/translate", (route) => { const b = JSON.parse(route.request().postData() || "{}"); trCalls.push(b); const out = {}; for (const k of Object.keys(b.fields || {})) out[k] = b.from === "hi" ? "EN:" + b.fields[k] : "हिं:" + b.fields[k]; return json(route, 200, { ok: true, from: b.from, to: b.from === "hi" ? "en" : "hi", fields: out, provider: "gemini" }); });
  await page.route("**/api/triage/insights**", (route) => json(route, 200, { ok: true, insights: [{ id: 1, generated_at: "2026-10-07T03:30:00Z", period_start: "2026-09-30T00:00:00Z", period_end: "2026-10-07T00:00:00Z", data: { period: { from: "2026-09-30T00:00:00Z", to: "2026-10-07T00:00:00Z" }, headline_en: "Garbage tops the week", summary_en: "Mostly garbage.", topics: [{ issue_type: "waste", count: 18, by_source: { reddit: 10, news: 5, reports: 3 }, trend: "up", areas: [{ area: "Sector 45", n: 4 }] }], actions: [{ issue_type: "waste", title: "Sector cleaning drive", why: "18 mentions" }] } }], signals: [{ title: "Garbage piling up near Sector 45 market", url: "https://www.reddit.com/r/gurgaon/x", source: "reddit", issue_type: "waste", area: "Sector 45", posted_at: "2026-10-06T10:00:00Z", score: 44 }] }));
  await page.click('[data-tab="content"]');
  await page.waitForTimeout(100);
  await page.click("#postNew");
  await page.fill("#pTitle", "Sewa drive cleans the park");
  await page.locator("#pTitle").dispatchEvent("change");
  await page.waitForTimeout(200);
  check(trCalls.length === 1 && trCalls[0].from === "en" && trCalls[0].fields.title === "Sewa drive cleans the park" && (await page.locator("#pTitleHi").inputValue()) === "हिं:Sewa drive cleans the park", "leaving an English field fills the Hindi field automatically");
  await page.fill("#pTitle", "");
  await page.fill("#pSummaryHi", "चालीस स्वयंसेवक आए");
  await page.locator("#pSummaryHi").dispatchEvent("change");
  await page.waitForTimeout(200);
  check(trCalls.length === 2 && trCalls[1].from === "hi" && (await page.locator("#pSummary").inputValue()) === "EN:चालीस स्वयंसेवक आए", "leaving a Hindi field fills the English field automatically");
  await page.click("#pReset");
  await page.click('[data-tab="insights"]');
  await page.waitForTimeout(200);
  check((await page.locator("#insightsBody").innerText()).includes("Garbage tops the week") && (await page.locator("#insightsBody").innerText()).includes("Sector cleaning drive") && (await page.locator("#insightsBody a[href='https://www.reddit.com/r/gurgaon/x']").count()) === 1, "pulse tab shows the latest scan, actions and top signals");

  // Auto drafts: tag, publish-by line, Hold / Release, and the round-up settings
  await page.click('[data-tab="content"]');
  await page.waitForTimeout(250);
  const autoRow = page.locator("#postList li", { hasText: "Weekly round-up: week 41" });
  check((await autoRow.innerText()).includes("Auto draft") && /Publishes automatically on .+ unless held/.test(await autoRow.innerText()), "an auto draft is tagged and shows when it publishes itself");
  check((await autoRow.locator('[data-phold="p8"]').count()) === 1 && (await autoRow.locator('[data-ppub="p8"]').innerText()) === "Publish now", "an unpublished auto draft offers Hold and Publish now");
  check((await page.locator("#postList li", { hasText: "Existing draft" }).locator("[data-phold],[data-prelease]").count()) === 0, "hand-written drafts get no Hold button");
  check((await page.locator("#apWeekday").inputValue()) === "0" && (await page.locator("#apHours").inputValue()) === "24" && (await page.locator("#apEnabled").isChecked()) && (await page.locator("#seoIndexnow").isChecked()), "settings panel reads autopost from the API and defaults IndexNow to on");
  await autoRow.locator('[data-phold="p8"]').click();
  await page.waitForTimeout(250);
  let last = contentCalls[contentCalls.length - 1];
  check(last.method === "PATCH" && last.body.id === "p8" && JSON.stringify(last.body.tags) === JSON.stringify(["weekly", "hold"]), "Hold adds the hold tag through a PATCH");
  check((await autoRow.innerText()).includes("Held") && (await autoRow.locator('[data-prelease="p8"]').count()) === 1 && (await autoRow.locator('[data-phold="p8"]').count()) === 0, "a held draft shows Held and a Release button");
  await autoRow.locator('[data-prelease="p8"]').click();
  await page.waitForTimeout(250);
  last = contentCalls[contentCalls.length - 1];
  check(last.method === "PATCH" && last.body.id === "p8" && JSON.stringify(last.body.tags) === JSON.stringify(["weekly"]), "Release removes the hold tag");
  check((await autoRow.locator('[data-phold="p8"]').count()) === 1, "a released draft offers Hold again");
  await page.click('#tContent [data-ctab="settings"]');
  check(!(await page.locator("#autoForm").isHidden()) && (await page.locator("#postList").isHidden()), "the Settings view shows the round-up form in place of the posts");
  check((await page.locator("#socialChannels .tag-green").count()) === 2 && (await page.locator("#socialChannels").innerText()).includes("META_PAGE_ID") && (await page.locator("#socialLog .row").count()) >= 2, "Social publishing lists connected accounts, what the others need, and the recent shares");
  await shot("desk-content-settings");
  await page.selectOption("#apWeekday", "5");
  await page.fill("#apHours", "72");
  await page.uncheck("#seoIndexnow");
  await page.selectOption("#tpPerWeek", "2");
  await page.click("#apSave");
  await page.waitForTimeout(250);
  last = contentCalls[contentCalls.length - 1];
  check(last.method === "PUT" && JSON.stringify(last.body) === JSON.stringify({ settings: { autopost: { enabled: true, weekday: 5, review_hours: 72 }, seo: { indexnow: false }, topics: { enabled: true, per_week: 2 } } }), "saving the settings sends autopost, seo and the topic pipeline through a PUT");
  check((await autoRow.innerText()).includes("10 Oct"), "the publish-by line follows the new review window");
  await page.fill("#apHours", "-5");
  await page.click("#apSave");
  await page.waitForTimeout(100);
  check(await page.locator("#apErr.show").isVisible() && contentCalls[contentCalls.length - 1] === last, "an invalid review window is refused locally");
  await page.click('#tContent [data-ctab="posts"]');
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

  // Roles tab: one roster with ward chips per person, an Assign control that stages wards and one Save per row, inline name/mobile, the derived cover matrix
  await page.click('[data-tab="roles"]');
  await page.waitForTimeout(250);
  check((await page.locator("#rosterBody tr").count()) === 3, "Team page lists the three accounts");
  check((await page.locator("#teamCounts").innerText()).replace(/\s+/g, " ").includes("3 Active people"), "Team counts strip reads the roster");
  check((await page.locator("#rosterBody [data-remove]").count()) === 0, "coordinator cannot remove accounts");
  const coordChips = (await page.locator('#rosterBody tr[data-person="u1"] .wchip').allInnerTexts()).map((t) => t.replace(/\s*×\s*$/, "").trim());
  check(coordChips.length === 2 && coordChips[0] === "C 1–6" && coordChips[1] === "Lead 7", "coordinator's Wards cell compresses wards 1-6 into a C 1–6 chip plus Lead 7" + (coordChips.length ? " (" + coordChips.join(", ") + ")" : ""));
  check((await page.locator('#rosterBody tr[data-person="u1"] .tag').innerText()) === "coordinator" && (await page.locator('#rosterBody tr[data-person="u2"] .tag').innerText()) === "ward volunteer", "desk role tags name the role");
  check((await page.locator('#rosterBody input[data-pphone="u1"]').inputValue()) === "+919800000001", "mobile is shown in an editable field");
  await page.click('#rosterBody tr[data-person="u2"] [data-goassign]');
  await page.waitForTimeout(150);
  check(!(await page.locator("#tAssign").isHidden()) && (await page.locator('#tAssign .cpane[data-cpane="byperson"].on').count()) === 1, "Change on Ward assignments opens that page on the By person view");
  await page.click('#tAssign [data-ctab="byward"]');
  await shot("desk-assign");
  check((await page.locator("#coverBody tr").count()) === 36, "By ward has 36 ward rows");
  const ward3 = (await page.locator("#coverBody tr").nth(2).locator(".who").allInnerTexts()).join(" | ");
  check(ward3.includes("Coordinator") && ward3.includes("+919800000001") && (await page.locator("#coverBody tr").nth(9).locator(".who").allInnerTexts()).join(" ").includes("Vol One") && (await page.locator("#coverBody tr").nth(2).locator("td.empty-slot").count()) === 2, "ward 3 names the coordinator with mobile, ward 10 names its lead, an empty role reads Nobody yet");
  check((await page.locator("#assignCounts").innerText()).replace(/\s+/g, " ").includes("6 / 36 Wards with a coordinator"), "assignment counts strip reads the cover");
  await page.selectOption('#coverBody select[data-wsel="7"][data-wrole="support"]', "u2");
  await page.waitForTimeout(300);
  check(teamPuts.length === 1 && teamPuts[0].user_id === "u2" && JSON.stringify(teamPuts[0].wards) === JSON.stringify([{ ward: 10, role: "lead" }, { ward: 7, role: "support" }]), "choosing a person for a ward's role PUTs that person's wards with the new ward (" + JSON.stringify(teamPuts[0]) + ")");
  await page.selectOption('#coverBody select[data-wsel="7"][data-wrole="lead"]', "u2");
  await page.waitForTimeout(300);
  check(teamPuts.length === 3 && teamPuts[1].user_id === "u1" && !teamPuts[1].wards.some((w) => w.ward === 7 && w.role === "lead") && teamPuts[2].user_id === "u2" && teamPuts[2].wards.some((w) => w.ward === 7 && w.role === "lead"), "moving a held role PUTs the old holder without it and the new holder with it");
  teamPuts.length = 0;
  await page.click('#tAssign [data-ctab="byperson"]');
  check((await page.locator('#assignBody [data-asave="u2"]').isDisabled()), "Save is disabled until wards change");
  await page.fill('#assignBody input[data-aw="u2"]', "8-9, 12");
  await page.selectOption('#assignBody select[data-ar="u2"]', "lead");
  await page.click('#assignBody [data-aadd="u2"]');
  await page.waitForTimeout(100);
  const volChips = (await page.locator('#assignBody tr[data-person="u2"] .wchip').allInnerTexts()).map((t) => t.replace(/\s*×\s*$/, "").trim());
  check(volChips.join("|") === "Lead 7–10|Lead 12|Support 7" && teamPuts.length === 0, "Add parses 8-9, 12 into staged chips without saving yet (" + volChips.join(", ") + ")");
  await page.click('#assignBody [data-asave="u2"]');
  await page.waitForTimeout(300);
  const wardsPut = teamPuts[0] || {};
  check(teamPuts.length === 1 && wardsPut.user_id === "u2" && !("name" in wardsPut) && !("phone" in wardsPut) && JSON.stringify(wardsPut.wards) === JSON.stringify([{ ward: 7, role: "lead" }, { ward: 7, role: "support" }, { ward: 8, role: "lead" }, { ward: 9, role: "lead" }, { ward: 10, role: "lead" }, { ward: 12, role: "lead" }]), "Save PUTs the whole ward list for that person only (" + JSON.stringify(wardsPut) + ")");
  check((await page.locator("#coverBody tr").nth(11).locator(".who").allInnerTexts()).join(" ").includes("Vol One"), "By ward refreshes after the save (ward 12 now names Vol One)");
  await page.click('#assignBody tr[data-person="u2"] .wchip button[data-wfrom="12"]');
  await page.waitForTimeout(100);
  check(!(await page.locator('#assignBody [data-asave="u2"]').isDisabled()) && (await page.locator('#assignBody tr[data-person="u2"] .wchip').count()) === 2, "the chip's × removes that ward and re-enables Save");
  await page.click('[data-tab="roles"]');
  await page.waitForTimeout(150);
  await page.fill('#rosterBody input[data-pphone="u2"]', "+919811100000");
  await page.press('#rosterBody input[data-pphone="u2"]', "Tab");
  await page.waitForTimeout(250);
  check(teamPuts.length === 2 && teamPuts[1].user_id === "u2" && teamPuts[1].phone === "+919811100000" && !("wards" in teamPuts[1]), "leaving the mobile field PUTs {user_id, phone}");
  await page.fill('#rosterBody input[data-pname="u1"]', "Coordinator Two");
  await page.press('#rosterBody input[data-pname="u1"]', "Tab");
  await page.waitForTimeout(250);
  check(teamPuts.length === 3 && teamPuts[2].user_id === "u1" && teamPuts[2].name === "Coordinator Two", "leaving the name field PUTs {user_id, name}");
  check(await page.evaluate(() => document.getElementById("sRoleCoord").hidden), "coordinator cannot create coordinators");
  await shot("desk-team");
  check((await page.locator("#staffComposer").isHidden()), "the Add a person form stays closed until asked");
  await page.click("#staffNew");
  await page.fill("#sName", "New Vol");
  await page.fill("#sEmail", "newvol@example.org");
  await page.fill("#sPhone", "+919811199999");
  await page.fill("#sPass", "temp-pass-2026");
  await page.selectOption("#sRole", "triage");
  await page.click("#staffForm button[type=submit]");
  await page.waitForTimeout(300);
  check(staffPosts.length === 1 && staffPosts[0].phone === "+919811199999" && staffPosts[0].role === "triage" && staffPosts[0].email === "newvol@example.org", "Add a volunteer POSTs name, email, password, role and phone");

  // Join requests tab: coordinator sees it with a badge for the new ones; status and notes PATCH the row; "Create desk account" prefills the Team form
  check(!(await page.locator("#joinsTab").isHidden()) && (await page.locator("#joinsTab").innerText()).replace(/\s+/g, " ").includes("Join requests · 1"), "coordinator sees the Join requests tab with the new-count badge from desk boot");
  check(joinCalls.length === 1 && joinCalls[0].includes("status=new"), "desk boot asks the joins endpoint once for the new count");
  // Inbox tab: three streams in one list with a badge summing emails new + join requests new + unmapped reports; emails take a status select and notes
  check((await page.locator("#inboxTab").innerText()).replace(/\s+/g, " ").includes("Inbox · 4") && inboxCalls.length === 1 && inboxCalls[0].includes("status=new"), "Inbox badge sums 1 new email + 1 new join request + 2 unmapped reports from one call each at boot");
  await page.click('[data-tab="inbox"]');
  await page.waitForTimeout(300);
  // SRV01 was filed (stage 2) by the PATCH above, so only OLD02 is still unmapped here; the join request (06:00) is newer than the email (05:00)
  check(!(await page.locator("#tInbox").isHidden()) && (await page.locator("#inboxList .row").count()) === 4, "Inbox lists 2 emails, 1 join request and the 1 unmapped report");
  check((await page.locator("#inboxCounts").innerText()).replace(/\s+/g, " ").includes("1 Emails new 1 Join requests new 1 Reports unmapped") && (await page.locator("#inboxTab").innerText()).replace(/\s+/g, " ").includes("Inbox · 3"), "Inbox count strip shows the three streams and the badge follows the fresh counts");
  const inboxTags = await page.locator("#inboxList .row .mfrom > span.tag:first-of-type").allInnerTexts();
  check(inboxTags.join("|") === "Join request|Email|Email|Report", "rows are tagged by type and sorted newest first (" + inboxTags.join(", ") + ")");
  check((await page.locator('#inboxList a[href="#/desk/GVF-2026-OLD02"]').count()) === 1 && (await page.locator("#inboxList .row").last().locator(".tag-danger").count()) === 1 && (await page.locator("#inboxList .row.unread").count()) === 3, "report rows link to the desk ticket with their flags; new items read as unread");
  check((await page.locator("#mail.reading").count()) === 0 && (await page.locator("#inboxRead .mread-empty").count()) === 1, "the reading pane starts empty");
  await page.click('#inboxList li[data-iid="e2"]');
  check((await page.locator('#inboxRead a[data-open="GVF-2026-SRV01"]').innerText()).includes("Reply on GVF-2026-SRV01") && (await page.locator('#inboxList li[data-iid="e2"].sel').count()) === 1 && (await page.locator('#inboxList li[data-iid="e2"] .mfrom').innerText()).includes("GVF-2026-SRV01") && !(await page.locator('#inboxList li[data-iid="e1"] .mfrom').innerText()).includes("GVF-"), "an email linked to a report carries its reference and the reading pane opens the ticket");
  await page.click('#inboxList li[data-iid="e1"]');
  await shot("desk-inbox");
  const emailRead = await page.locator("#inboxRead").innerText();
  check(emailRead.includes("Asha Verma") && emailRead.includes("asha@example.org") && emailRead.includes("Streetlight out in Sector 45") && emailRead.includes("8 Oct") && emailRead.includes("Line five, which makes this long enough to clip."), "the reading pane shows from, subject, time and the whole body");
  check((await page.locator('#inboxList li[data-iid="e1"] .msnip').innerText()).startsWith("The light near the park gate") && !(await page.locator('#inboxList li[data-iid="e1"]').innerText()).includes("enough to clip."), "the list row shows a one-line snippet");
  await page.selectOption('#inboxRead select[data-istatus="e1"]', "read");
  await page.waitForTimeout(200);
  check(inboxPatches.length === 1 && inboxPatches[0].id === "e1" && inboxPatches[0].body.status === "read" && !("notes" in inboxPatches[0].body), "changing the email status PATCHes {status} to /api/triage/inbox/e1");
  check((await page.locator("#inboxTab").innerText()).replace(/\s+/g, " ").includes("Inbox · 2") && (await page.locator('#inboxList li[data-iid="e1"] [data-itag]').innerText()) === "Read" && (await page.locator('#inboxList li[data-iid="e1"].unread').count()) === 0, "badge, tag and unread state update after the status change");
  await page.fill('#inboxRead textarea[data-inotes="e1"]', "Asked MCG lighting cell.");
  await page.click('#inboxRead [data-isave="e1"]');
  await page.waitForTimeout(200);
  check(inboxPatches.length === 2 && inboxPatches[1].id === "e1" && inboxPatches[1].body.notes === "Asked MCG lighting cell." && !("status" in inboxPatches[1].body), "saving notes PATCHes {notes} for that email");
  await page.click('#inboxChips [data-istage="done"]');
  await page.waitForTimeout(300);
  check(inboxCalls[inboxCalls.length - 1].includes("status=done") && (await page.locator('#inboxList li[data-iid]').count()) === 1 && (await page.locator("#inboxList .row").count()) === 3, "the Done chip narrows the mail stream only");
  await page.click('#inboxList [data-ikey="join:j1"]');
  check((await page.locator("#inboxRead").innerText()).includes("Weekends only") && (await page.locator('#inboxRead [data-ijoin="j1"]').count()) === 1, "a join request reads in the pane with its note and the button to work it");
  await page.click('#inboxRead [data-ijoin="j1"]');
  await page.waitForTimeout(250);
  check(!(await page.locator("#tJoins").isHidden()) && (await page.locator("#joinList").innerText()).includes("Asha Verma"), "Open in Join requests switches to that tab");
  await page.click('[data-tab="joins"]');
  await page.waitForTimeout(250);
  check(!(await page.locator("#tJoins").isHidden()) && (await page.locator("#joinList .row").count()) === 1 && (await page.locator("#joinList").innerText()).includes("Asha Verma"), "Join requests tab lists the new request by default");
  check((await page.locator("#joinCounts").innerText()).replace(/\s+/g, " ").includes("1 New 1 Contacted 0 Onboarded 0 Declined 2 Total"), "count strip shows new, contacted, onboarded, declined and total");
  check((await page.locator('#joinList a[href="tel:+919811122233"]').count()) === 1 && (await page.locator('#joinList a[href="mailto:asha@example.org"]').count()) === 1 && (await page.locator("#joinList").innerText()).includes("Weekends only, can help with camps."), "row shows the phone as tel:, the email as mailto: and the note in full");
  await page.click('#joinChips [data-jstage="all"]');
  await page.waitForTimeout(250);
  check((await page.locator("#joinList .row").count()) === 2 && (await page.locator("#joinList").innerText()).includes("Rohit Mehra"), "the All chip lists both requests");
  await page.fill("#jQ", "rohit");
  await page.waitForTimeout(600);
  check(joinCalls[joinCalls.length - 1].includes("q=rohit") && (await page.locator("#joinList .row").count()) === 1, "search sends q and narrows the list");
  await page.fill("#jQ", "");
  await page.waitForTimeout(600);
  await page.selectOption('#joinList select[data-jstatus="j1"]', "contacted");
  await page.waitForTimeout(200);
  check(joinPatches.length === 1 && joinPatches[0].id === "j1" && joinPatches[0].body.status === "contacted" && !("notes" in joinPatches[0].body), "changing the status select PATCHes {status} for that row");
  check((await page.locator("#joinsTab").innerText()).replace(/\s+/g, " ").trim() === "Join requests" && (await page.locator("#joinCounts").innerText()).replace(/\s+/g, " ").includes("0 New 2 Contacted"), "badge and count strip update after the status change");
  await page.fill('#joinList textarea[data-jnotes="j2"]', "Onboarding call fixed for Friday.");
  await page.click('#joinList [data-jsave="j2"]');
  await page.waitForTimeout(200);
  check(joinPatches.length === 2 && joinPatches[1].id === "j2" && joinPatches[1].body.notes === "Onboarding call fixed for Friday." && !("status" in joinPatches[1].body), "saving notes PATCHes {notes} for that row");
  const csvCalls = joinCalls.length;
  await page.click("#joinsCsv");
  await page.waitForTimeout(200);
  check(joinCalls.length === csvCalls + 1 && joinCalls[joinCalls.length - 1].includes("format=csv") && joinCalls[joinCalls.length - 1].includes("status=all"), "Export CSV asks for the csv format with the current status filter");
  await page.click('#joinList [data-jaccount="j1"]');
  await page.waitForTimeout(250);
  check(!(await page.locator("#tRoles").isHidden()) && (await page.locator("#sName").inputValue()) === "Asha Verma" && (await page.locator("#sEmail").inputValue()) === "asha@example.org" && (await page.locator("#sPhone").inputValue()) === "+919811122233", "Create desk account opens the Roles tab with name, email and mobile prefilled");

  // Performance tab: ward ageing with amber/red cells, sortable headers, quiet wards folded; people with an idle flag; the morning brief with Copy
  if (process.env.SHOTS) { await page.setViewportSize({ width: 390, height: 844 }); await page.click('[data-tab="reports"]'); await page.waitForTimeout(200); await shot("desk-reports-390"); await page.click('[data-tab="inbox"]'); await page.waitForTimeout(400); await page.click('#inboxChips [data-istage="all"]'); await page.waitForTimeout(400); await shot("desk-inbox-390"); await page.click('#inboxList li[data-iid="e1"]'); await shot("desk-inbox-read-390"); await page.click('[data-open="GVF-2026-SRV01"]').catch(() => {}); await page.setViewportSize({ width: 1366, height: 860 }); await page.click('[data-tab="joins"]'); await page.waitForTimeout(300); }
  await page.click('[data-tab="performance"]');
  await page.waitForTimeout(300); await shot("desk-performance");
  await page.waitForTimeout(300);
  check((await page.locator("#perfTotals").innerText()).replace(/\s+/g, " ").includes("6 Open 2 Unmapped 2 Overdue 3 Received 7d 1 Resolved 7d"), "performance totals strip shows the five counts");
  check((await page.locator("#perfWardBody tr").count()) === 2 && !(await page.locator("#perfWardBody").innerText()).includes("Madhu Batra"), "quiet ward 30 is folded away by default");
  const w10 = page.locator("#perfWardBody tr").nth(1);
  check((await w10.locator("td.age-bad").count()) === 2 && (await w10.locator('td[data-l="22+ d"]').innerText()) === "1" && (await w10.locator('td[data-l="22+ d"]').getAttribute("class")).includes("age-bad") && (await w10.locator('td[data-l="8–21 d"]').getAttribute("class")).includes("age-warn"), "ward 10 shows the 22+ cell in red and the 8–21 cell in amber");
  check((await w10.locator('td[data-l="Oldest open"]').innerText()) === "25 d" && (await w10.locator('td[data-l="Last activity"]').innerText()).includes("days ago"), "oldest open and last activity read as days");
  await page.click('#perfWards .sortbtn[data-sort="overdue"]');
  await page.waitForTimeout(50);
  check((await page.locator("#perfWardBody tr").first().innerText()).includes("Mahabir") && (await page.locator('#perfWards .sortbtn[data-sort="overdue"]').getAttribute("aria-pressed")) === "true", "clicking Overdue sorts ward 10 first");
  await page.click("#perfQuiet");
  await page.waitForTimeout(50);
  check((await page.locator("#perfWardBody tr").count()) === 3 && (await page.locator("#perfQuiet").innerText()) === "Hide quiet wards", "Show quiet wards reveals ward 30");
  const peopleRows = await page.locator("#perfPeopleBody tr").allInnerTexts();
  check(peopleRows.length === 2 && peopleRows[0].includes("Coordinator") && peopleRows[0].includes("C 1–6") && !peopleRows[0].includes("No activity"), "people table shows the coordinator's ward chips without a flag");
  check(peopleRows[1].includes("Vol One") && peopleRows[1].includes("No activity in 7 days") && peopleRows[1].includes("Lead 10"), "the idle ward lead is flagged No activity in 7 days");
  check((await page.locator("#briefText").innerText()).includes("Ward 10: 4 open, oldest 25 days, 2 overdue."), "the brief box shows the morning text");
  await page.click("#briefCopy");
  await page.waitForTimeout(100);
  check((await page.evaluate(() => window.__copied)) === brief, "Copy puts the brief text on the clipboard");

  await page.click("#signOut");
  await page.waitForTimeout(100);
  check(!(await page.locator("#deskLogin").isHidden()) && (await page.locator("#deskMain").isHidden()), "sign out returns to the sign-in form");
  check((await page.evaluate(() => localStorage.getItem("gvf_staff"))) === null, "sign out clears the stored session");

  // A content-team account sees only content and the pulse; a ward volunteer only reports and the map
  const joinCallsBeforeContent = joinCalls.length, inboxCallsBeforeContent = inboxCalls.length;
  page._joinRole = "content";
  await page.fill("#lEmail", "content@example.org");
  await page.fill("#lPass", "secret-pass");
  await page.click("#lBtn");
  await page.waitForSelector("#deskMain:not([hidden])");
  await page.waitForTimeout(250);
  check((await page.locator("#reportsTab").isHidden()) && (await page.locator("#mapTab").isHidden()) && (await page.locator("#rolesTab").isHidden()) && (await page.locator("#inboxTab").isHidden()) && (await page.locator("#performanceTab").isHidden()) && (await page.locator("#visitorsTab").isHidden()) && (await page.locator("#subscribersTab").isHidden()) && (await page.locator("#healthTab").isHidden()) && !(await page.locator("#contentTab").isHidden()) && !(await page.locator("#newsletterTab").isHidden()) && !(await page.locator("#insightsTab").isHidden()) && !(await page.locator("#seoTab").isHidden()), "content team sees only the Content, Newsletter, Pulse and SEO tabs");
  check((await page.locator("#joinsTab").isHidden()) && joinCalls.length === joinCallsBeforeContent && inboxCalls.length === inboxCallsBeforeContent, "content team does not see Join requests or the Inbox and the desk does not ask for them");
  check(!(await page.locator("#tContent").isHidden()) && (await page.locator("#tReports").isHidden()), "content team lands on the Content tab");
  await page.click("#signOut");
  await page.waitForTimeout(100);
  page._joinRole = "triage";
  await page.fill("#lEmail", "vol@example.org");
  await page.fill("#lPass", "secret-pass");
  await page.click("#lBtn");
  await page.waitForSelector("#deskMain:not([hidden])");
  await page.waitForTimeout(250);
  check(!(await page.locator("#reportsTab").isHidden()) && !(await page.locator("#mapTab").isHidden()) && (await page.locator("#contentTab").isHidden()) && (await page.locator("#rolesTab").isHidden()) && (await page.locator("#inboxTab").isHidden()) && (await page.locator("#performanceTab").isHidden()) && (await page.locator("#insightsTab").isHidden()) && (await page.locator("#joinsTab").isHidden()), "ward volunteer sees only Reports and Map, not Inbox, Roles, Performance or Join requests");
  check(inboxCalls.length === inboxCallsBeforeContent, "ward volunteer's desk does not ask for the inbox streams");
  check((await page.locator("#whoAmI").innerText()).includes("wards 10"), "ward volunteer's header names the allotted ward");
  await page.click("#signOut");
  await page.waitForTimeout(100);
  page._joinRole = "owner";
  await page.fill("#lEmail", "owner@example.org");
  await page.fill("#lPass", "secret-pass");
  await page.click("#lBtn");
  await page.waitForSelector("#deskMain:not([hidden])");
  await page.waitForTimeout(250);
  if (process.env.SHOTS) { for (const vp of [[1366, 860], [1366, 700], [1100, 700], [390, 844]]) { await page.setViewportSize({ width: vp[0], height: vp[1] }); for (const t of ["reports", "inbox", "map", "roles", "assign", "joins", "performance", "content", "newsletter", "visitors", "subscribers", "insights", "seo", "health"]) { await page.click('[data-tab="' + t + '"]'); await page.waitForTimeout(350); await shot("sweep-" + vp[0] + "x" + vp[1] + "-" + t); } } await page.setViewportSize({ width: 1366, height: 860 }); }
  for (const t of ["reports", "inbox", "map", "roles", "assign", "joins", "performance", "content", "newsletter", "visitors", "subscribers", "insights", "seo", "health"]) check(!(await page.locator("#" + t + "Tab").isHidden()), "owner sees the " + t + " tab");
  check((await page.locator("#tTabs .tab:not([hidden])").allInnerTexts()).map((t) => t.replace(/\s*·.*$/, "").trim()).join("|") === "Reports|Inbox|Map|Team|Ward assignments|Join requests|Performance|Content|Newsletter|Visitors|Subscribers|Pulse|SEO|Health", "owner's tabs run Reports, Inbox, Map, Roles, Join requests, Performance, Content, Newsletter, Visitors, Subscribers, Pulse, SEO, Health");
  await page.click('[data-tab="roles"]');
  await page.waitForTimeout(250);
  const ownerRoles = await page.evaluate(() => ({ removes: document.querySelectorAll("#rosterBody [data-remove]").length, coordHidden: document.getElementById("sRoleCoord").hidden }));
  check(ownerRoles.removes === 3 && !ownerRoles.coordHidden, "owner can remove every other account and create coordinators (" + JSON.stringify(ownerRoles) + ")");
  await page.click('[data-tab="joins"]');
  await page.waitForTimeout(250);
  check((await page.locator("#joinList .row").count()) === 0 && !(await page.locator("#joinEmpty").isHidden()) && (await page.locator("#joinEmpty").innerText()).includes("No join requests yet."), "owner's Join requests tab shows the empty state when nothing is new");
  await page.click('[data-tab="visitors"]');
  await page.waitForTimeout(200);
  check((await page.locator("#visitorStats").innerText()).includes("12 registered visitors") && (await page.locator("#visitorList").innerText()).includes("Gate Person"), "owner's visitors tab shows the registration count and the list");
  await page.click('[data-tab="subscribers"]');
  await page.waitForTimeout(250);
  check((await page.locator("#subCounts").innerText()).replace(/\s+/g, " ").includes("2 Confirmed 1 Pending 1 Unsubscribed 4 Total 2 Mirrored"), "owner's subscribers tab shows the counts");
  check((await page.locator("#subSync").innerText()).includes("Mirrored to Resend contacts"), "subscribers tab says the list is mirrored to Resend");
  check((await page.locator("#subList .row").count()) === 4 && (await page.locator("#subList").innerText()).includes("reader@example.org") && (await page.locator('#subList [data-sact="unsubscribe"]').count()) === 2 && (await page.locator('#subList [data-sact="resubscribe"]').count()) === 1 && (await page.locator('#subList [data-sact="sync"]').count()) === 1, "subscriber rows carry Stop, Put back and Sync where they apply");
  await page.click('#subList [data-sact="unsubscribe"]');
  await page.waitForTimeout(250);
  check(subscriberPatches.length === 1 && subscriberPatches[0].url.endsWith("/api/triage/subscribers/1") && subscriberPatches[0].body.action === "unsubscribe", "Stop emails PATCHes the subscriber with action unsubscribe (" + JSON.stringify(subscriberPatches) + ")");
  await page.fill("#subEmail", "new@example.org");
  await page.selectOption("#subLang", "hi");
  await page.click("#subAddBtn");
  await page.waitForTimeout(250);
  check(subscriberPosts.length === 1 && subscriberPosts[0].email === "new@example.org" && subscriberPosts[0].lang === "hi", "adding an address from the desk POSTs email and language for a confirmation mail (" + JSON.stringify(subscriberPosts) + ")");
  await page.click('[data-tab="newsletter"]');
  await page.waitForTimeout(300); await shot("desk-newsletter");
  await page.waitForTimeout(300);
  check((await page.locator("#nlChannel").innerText()).includes("one mail per subscriber") && (await page.locator("#nlChannel").innerText()).includes("4 confirmed subscribers"), "newsletter tab explains the outbox channel and the subscriber count");
  check((await page.locator("#nlList .row").count()) === 2 && (await page.locator("#nlList").innerText()).includes("Sent to 120") && (await page.locator('#nlList [data-nldel]').count()) === 1, "newsletter list shows the sent campaign and one deletable draft");
  check((await page.locator("#nlSend").isDisabled()) && (await page.locator("#nlTest").isDisabled()), "Send and Test stay disabled until a draft is saved");
  await page.fill("#nlSubject", "October drive");
  await page.fill("#nlBody", "## Thank you\n\nForty volunteers cleared the Sector 45 park.\n\n- Next drive 20 October\n- Bring gloves\n\nDetails: https://gurugramvisionforum.org/blog/x");
  await page.click("#nlPreview");
  await page.waitForTimeout(250);
  check(newsletterPreviews.length === 1 && newsletterPreviews[0].subject === "October drive" && !(await page.locator("#nlPreviewBox").isHidden()) && (await page.locator("#nlPreviewBody").innerText()).includes("Forty volunteers"), "Preview POSTs the draft and shows the rendered mail");
  await page.click("#nlSave");
  await page.waitForTimeout(300);
  check(newsletterSaves.length === 1 && newsletterSaves[0].subject === "October drive" && newsletterSaves[0].body.startsWith("## Thank you") && (await page.locator("#nlId").inputValue()) === "9", "Save draft POSTs subject and body and keeps the new id");
  check(!(await page.locator("#nlSend").isDisabled()) && !(await page.locator("#nlTest").isDisabled()), "owner can test and send once the draft is saved");
  await page.click("#nlTest");
  await page.waitForTimeout(250);
  check(newsletterActions.length === 1 && newsletterActions[0].url.endsWith("/api/triage/newsletter/9") && newsletterActions[0].body.action === "test", "Send me a test POSTs action test for the saved draft");
  page.once("dialog", (d) => d.accept());
  await page.click("#nlSend");
  await page.waitForTimeout(300);
  check(newsletterActions.length === 2 && newsletterActions[1].body.action === "send" && (await page.locator("#nlMsg").innerText()).includes("4 sent now"), "Send to subscribers confirms, POSTs action send and reports the outcome");

  check(errors.length === 0, "zero console or page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
