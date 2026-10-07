import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "../../api/[...path].js";

test("router resolves every public and triage route", () => {
  for (const p of [["report"], ["status"], ["join"], ["dashboard"], ["ward"], ["geocode"], ["triage", "login"], ["triage", "refresh"], ["triage", "me"], ["triage", "staff"], ["triage", "wards"], ["triage", "reports"]]) {
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
