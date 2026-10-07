import test from "node:test";
import assert from "node:assert/strict";
import { validatePassword } from "../../lib/handlers/triage/password.js";

test("password rules", () => {
  assert.equal(validatePassword("short1"), "Use 10 to 128 characters.");
  assert.equal(validatePassword("onlyletterslong"), "Use letters and at least one number.");
  assert.equal(validatePassword("1234567890123"), "Use letters and at least one number.");
  assert.equal(validatePassword("gurugram2026x"), null);
  assert.equal(validatePassword(undefined), "Use 10 to 128 characters.");
});
