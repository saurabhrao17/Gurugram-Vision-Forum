import { test } from "node:test";
import assert from "node:assert/strict";
import { bearer, HttpError } from "../../lib/auth.js";
import { validatePatch } from "../../api/triage/reports/[ref].js";

test("bearer extracts the token and ignores other schemes", () => {
  assert.equal(bearer({ headers: { authorization: "Bearer abc.def" } }), "abc.def");
  assert.equal(bearer({ headers: { authorization: "bearer xyz" } }), "xyz");
  assert.equal(bearer({ headers: { authorization: "Basic abc" } }), null);
  assert.equal(bearer({ headers: {} }), null);
});

test("HttpError carries status and code", () => {
  const e = new HttpError(403, "not_staff");
  assert.equal(e.status, 403);
  assert.equal(e.code, "not_staff");
  assert.ok(e instanceof Error);
});

test("validatePatch keeps only sent fields and clears with empty strings", () => {
  const { patch, note, errors } = validatePatch({ desk: " MCG sanitation ", official_ticket: "", stage: "2", note: " called JE " });
  assert.deepEqual(errors, []);
  assert.deepEqual(patch, { desk: "MCG sanitation", official_ticket: "", stage: 2 });
  assert.equal(note, "called JE");
});

test("validatePatch rejects bad stage, ward and issue type", () => {
  const { errors } = validatePatch({ stage: "9", ward: "40", issue_type: "" });
  assert.deepEqual(errors.sort(), ["issue_type", "stage", "ward"]);
});

test("validatePatch allows clearing the ward and ignores unknown keys", () => {
  const { patch } = validatePatch({ ward: "", reporter_phone: "+911234567890", id: "x" });
  assert.deepEqual(patch, { ward: "" });
});
