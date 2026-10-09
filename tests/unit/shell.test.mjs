import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APP_META, VIEWS, shellFor, loadShell } from "../../lib/handlers/shell.js";
import handler from "../../lib/handlers/shell.js";
import { auditHtml } from "../../lib/seo/audit.js";
import { APP_ROUTES } from "../../lib/seo/site.js";
import { fitTitle, withBrand } from "../../lib/seo/layout.js";
import { resolve } from "../../api/index.js";

const SITE = "https://gurugramvisionforum.org";

test("every app page in the sitemap except home has its own head, and the rewrite list matches", () => {
  assert.deepEqual([...VIEWS].sort(), APP_ROUTES.filter((p) => p !== "/").map((p) => p.slice(1)).sort());
  const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
  const rw = vercel.rewrites.find((r) => r.destination.startsWith("/api/index?path=shell"));
  assert.ok(rw, "a rewrite sends the views to the shell");
  assert.deepEqual(rw.source.match(/\(([^)]+)\)/)[1].split("|").sort(), [...VIEWS].sort());
  const i = vercel.rewrites.indexOf(rw);
  assert.ok(i < vercel.rewrites.findIndex((r) => r.destination === "/index.html"), "it comes before the static shell rewrite");
  assert.ok(resolve(["shell"]), "the router knows the shell route");
});

test("each view: unique title within 70 characters, description 50-160, self canonical, JSON-LD; the audit finds nothing", () => {
  const titles = new Set(), descs = new Set();
  for (const v of VIEWS) {
    const m = APP_META[v];
    assert.ok(m.description.length >= 50 && m.description.length <= 160, `${v} description ${m.description.length}`);
    assert.doesNotMatch(m.description, /@|\+91|\b\d{10}\b/, "no contact details");
    const html = shellFor(loadShell(), v, SITE);
    const title = html.match(/<title>([^<]*)<\/title>/)[1].replace(/&#39;/g, "'").replace(/&amp;/g, "&");
    assert.ok(title.length <= 70, `${v}: ${title}`);
    assert.equal((title.match(/Gurugram Vision Forum/g) || []).length <= 1, true, `${v}: brand once`);
    titles.add(title); descs.add(m.description);
    assert.match(html, new RegExp(`<link rel="canonical" href="${SITE}/${v}">`));
    assert.match(html, new RegExp(`<meta property="og:url" content="${SITE}/${v}">`));
    assert.equal((html.match(/application\/ld\+json/g) || []).length, 1, "one JSON-LD block, replacing the home page's");
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json" id="ld-site">([^<]*)<\/script>/)[1]);
    assert.deepEqual(ld.map((x) => x["@type"]), ["Organization", "WebSite", "WebPage", "BreadcrumbList"]);
    const a = auditHtml(html, { url: `${SITE}/${v}`, lang: "en", kind: "app" });
    assert.deepEqual(a.issues, [], `${v}: ${JSON.stringify(a.issues)}`);
  }
  assert.equal(titles.size, VIEWS.length); assert.equal(descs.size, VIEWS.length);
  assert.equal(shellFor(loadShell(), "desk", SITE), null, "the desk is never given a public head");
});

test("the static home page carries Organization and WebSite data without contact details, and audits clean", () => {
  const home = loadShell();
  const ld = JSON.parse(home.match(/<script type="application\/ld\+json" id="ld-site">([^<]*)<\/script>/)[1]);
  assert.deepEqual(ld.map((x) => x["@type"]), ["Organization", "WebSite"]);
  assert.equal(JSON.stringify(ld).match(/email|telephone|contactPoint/), null);
  assert.deepEqual(auditHtml(home, { url: `${SITE}/`, lang: "en", kind: "app" }).issues, []);
});

test("GET /api/shell answers HTML with a CDN cache, 404 for anything else", async () => {
  const res = { headers: {}, statusCode: 0, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; } };
  await handler({ query: { view: "directory" } }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /text\/html/);
  assert.match(res.headers["cache-control"], /s-maxage=/);
  assert.match(res.body, /<link rel="canonical" href="https:\/\/[^"]+\/directory">/);
  const r2 = { ...res, headers: {}, setHeader: res.setHeader, end: res.end, status: res.status, json: res.json };
  await handler({ query: { view: "desk" } }, r2);
  assert.equal(r2.statusCode, 404);
});

test("fitTitle: a long title keeps its lead or is cut at a word", () => {
  // A lead that drops most of the title's words is not used: the title is cut at a word instead
  assert.equal(fitTitle("Segregate at source: what the 2016 rules ask of every household and society"), "Segregate at source: what the 2016 rules ask of every household…");
  assert.equal(fitTitle("Ward committees in Gurugram explained: the members, the meetings, the minutes"), "Ward committees in Gurugram explained");
  assert.equal(fitTitle("Short title"), "Short title");
  const long = "A very long headline without any colon that keeps going on and on about the city";
  assert.ok(fitTitle(long).length <= 70 && fitTitle(long).endsWith("…"));
  assert.equal(withBrand(fitTitle("Ward committees in Gurugram explained: the members, the meetings, the minutes"), "en"), "Ward committees in Gurugram explained | Gurugram Vision Forum");
});
