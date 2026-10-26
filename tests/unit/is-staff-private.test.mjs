// Static check of the migration set: is_staff() lives in the unexposed `private`
// schema (Supabase lint 0029). Replays the migrations in order and looks at the
// final state: no policy may still call an unqualified or public is_staff(), and
// public.is_staff() must be gone.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const dir = new URL("../../supabase/migrations/", import.meta.url);
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const MOVE = "20261013020000_is_staff_private.sql";

function statements(sql) {
  const noComments = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return noComments.split(";").map((s) => s.trim()).filter(Boolean);
}

function replay() {
  const policies = new Map(); // "table|name" -> last create statement
  let publicIsStaff = false;
  let privateIsStaff = false;
  for (const f of files) {
    for (const s of statements(fs.readFileSync(new URL(f, dir), "utf8"))) {
      const flat = s.replace(/\s+/g, " ");
      if (/^create (or replace )?function public\.is_staff\s*\(/i.test(flat)) publicIsStaff = true;
      if (/^drop function (if exists )?public\.is_staff\s*\(/i.test(flat)) publicIsStaff = false;
      if (/^create (or replace )?function private\.is_staff\s*\(/i.test(flat)) privateIsStaff = true;
      let m = flat.match(/^create policy "?([^"]+?)"? on ([\w.]+)/i);
      if (m) policies.set(`${m[2]}|${m[1]}`, flat);
      m = flat.match(/^drop policy (?:if exists )?"?([^"]+?)"? on ([\w.]+)/i);
      if (m) policies.delete(`${m[2]}|${m[1]}`);
    }
  }
  return { policies, publicIsStaff, privateIsStaff };
}

test("public.is_staff() does not exist after the migration set", () => {
  assert.equal(replay().publicIsStaff, false);
});

test("private.is_staff() exists, security definer, empty search_path, no anon access", () => {
  assert.equal(replay().privateIsStaff, true);
  const sql = fs.readFileSync(new URL(MOVE, dir), "utf8");
  assert.match(sql, /function private\.is_staff\(\) returns boolean\s+language sql stable security definer set search_path = ''/i);
  assert.match(sql, /revoke all on function private\.is_staff\(\) from public, anon/i);
  assert.match(sql, /grant execute on function private\.is_staff\(\) to authenticated, service_role/i);
});

test("every surviving policy that checks staff calls private.is_staff(), never an unqualified or public one", () => {
  const { policies } = replay();
  const staffPolicies = [...policies].filter(([, s]) => /is_staff\s*\(/i.test(s));
  assert.equal(staffPolicies.length, 10);
  for (const [key, s] of staffPolicies) {
    assert.doesNotMatch(s, /(?<!private\.)\bis_staff\s*\(/i, `${key} calls an unqualified/public is_staff()`);
  }
});

test("migrations after the move never call is_staff() unqualified", () => {
  for (const f of files) {
    if (f <= MOVE) continue;
    const sql = statements(fs.readFileSync(new URL(f, dir), "utf8")).join(";\n");
    assert.doesNotMatch(sql, /(?<!private\.)\bis_staff\s*\(/i, f);
  }
});
