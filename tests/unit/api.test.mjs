import { test } from "node:test";
import assert from "node:assert/strict";
import { normalisePhone, isEmail, text } from "../../lib/http.js";
import { validate } from "../../lib/handlers/report.js";

test("normalisePhone accepts Indian mobiles in common spellings", () => {
  assert.equal(normalisePhone("98993 75445"), "+919899375445");
  assert.equal(normalisePhone("+91 9899375445"), "+919899375445");
  assert.equal(normalisePhone("09899375445"), "+919899375445");
  assert.equal(normalisePhone("919899375445"), "+919899375445");
});

test("normalisePhone rejects landlines, short and foreign numbers", () => {
  assert.equal(normalisePhone("0124 4567890"), null);
  assert.equal(normalisePhone("12345"), null);
  assert.equal(normalisePhone("+44 7700 900123"), null);
  assert.equal(normalisePhone(""), null);
});

test("text trims and caps", () => {
  assert.equal(text("  hi  ", 10), "hi");
  assert.equal(text("abcdefghijkl", 5), "abcde");
  assert.equal(text(42, 5), "");
});

test("isEmail", () => {
  assert.ok(isEmail("a@b.co"));
  assert.ok(!isEmail("not an email"));
});

const good = {
  issue_type: "waste", affects: "My society or RWA", area: "Sector 29", ward: "30",
  spot: "Near the gate", lat: "28.46", lng: "77.07", description: "Garbage not collected",
  name: "Test", phone: "9999999999", email: "", consent: true
};

test("validate accepts a complete report and normalises fields", () => {
  const { errors, out } = validate(good);
  assert.deepEqual(errors, []);
  assert.equal(out.ward, 30);
  assert.equal(out.reporter_phone, "+919999999999");
  assert.equal(out.reporter_email, null);
  assert.equal(out.lat, 28.46);
});

test("validate names each missing or bad field", () => {
  const { errors } = validate({ ...good, issue_type: "", phone: "123", consent: false, email: "bad" });
  assert.deepEqual(errors.sort(), ["consent", "email", "issue_type", "phone"]);
});

test("validate drops out-of-range ward and unknown affects instead of failing", () => {
  const { errors, out } = validate({ ...good, ward: "99", affects: "Everyone" });
  assert.deepEqual(errors, []);
  assert.equal(out.ward, null);
  assert.equal(out.affects, null);
});
