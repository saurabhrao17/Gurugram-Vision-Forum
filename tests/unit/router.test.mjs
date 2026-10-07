import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, pathParts, partsFrom } from "../../api/index.js";

test("router resolves every public and triage route", () => {
  for (const p of [["report"], ["status"], ["join"], ["dashboard"], ["ward"], ["geocode"], ["triage", "login"], ["triage", "refresh"], ["triage", "me"], ["triage", "staff"], ["triage", "wards"], ["triage", "reports"], ["triage", "password"], ["cron", "daily"], ["follow"], ["public", "report"], ["public", "reports"], ["hooks", "whatsapp"], ["hooks", "exotel"], ["content"], ["triage", "content"], ["triage", "content", "upload-url"], ["triage", "draft"], ["visitor"], ["news"], ["health"], ["triage", "visitors"]]) {
    assert.ok(resolve(p), p.join("/"));
  }
});

test("router passes the reference of a single report as a param", () => {
  const m = resolve(["triage", "reports", "GVF-2026-ABCDE"]);
  assert.ok(m);
  assert.equal(m.params.ref, "GVF-2026-ABCDE");
});

test("router rejects unknown paths", () => {
  assert.equal(resolve(["nope"]), null);
  assert.equal(resolve(["triage", "reports", "x", "y"]), null);
  assert.equal(resolve([]), null);
});

test("pathParts reads the segments from the request URL", () => {
  assert.deepEqual(pathParts("/api/triage/reports/GVF-2026-ABCDE?x=1"), ["triage", "reports", "GVF-2026-ABCDE"]);
  assert.deepEqual(pathParts("/api/dashboard"), ["dashboard"]);
  assert.deepEqual(pathParts("/api/"), []);
  assert.deepEqual(pathParts("/api/ward?area=Sector%2029"), ["ward"]);
});

test("partsFrom prefers the rewrite's path query and falls back to the URL", () => {
  assert.deepEqual(partsFrom({ url: "/api/index?path=triage%2Freports&stage=open", query: { path: "triage/reports", stage: "open" } }), ["triage", "reports"]);
  assert.deepEqual(partsFrom({ url: "/api/index?path=triage/reports/GVF-2026-ABCDE", query: { path: ["triage", "reports", "GVF-2026-ABCDE"] } }), ["triage", "reports", "GVF-2026-ABCDE"]);
  assert.deepEqual(partsFrom({ url: "/api/dashboard", query: {} }), ["dashboard"]);
  assert.deepEqual(partsFrom({ url: "/api/index/ward?area=x", query: { area: "x" } }), ["ward"]);
});
