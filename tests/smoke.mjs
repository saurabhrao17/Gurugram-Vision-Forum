// Playwright smoke test for the GVF site. Run: node tests/smoke.mjs
// Uses the globally installed playwright if a local one is missing.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch { ({ chromium } = require(resolve(execSync("npm root -g").toString().trim(), "playwright"))); }

const url = pathToFileURL(resolve("site/index.html")).href;
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
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
