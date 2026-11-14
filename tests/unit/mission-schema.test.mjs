// Static checks of the Mission 2029 MP migration (step 1): only new mission_ tables, every one locked,
// no policy, nothing touching existing tables, no mail or outbox, no party name. The real-database
// checks are in scripts/mission-db-test.sh (a throwaway local Postgres, fake data only).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const FILE = new URL("../../supabase/migrations/20261114000000_mission_tables.sql", import.meta.url);
const sql = fs.readFileSync(FILE, "utf8");
const code = sql.replace(/--[^\n]*/g, "");
const flat = code.replace(/\s+/g, " ");

const created = [...flat.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map((m) => m[1]);

test("only mission_ tables are created", () => {
  assert.ok(created.length >= 15);
  for (const t of created) assert.match(t, /^mission_/, t);
});

test("every created table has row level security on", () => {
  for (const t of created) assert.match(flat, new RegExp(`alter table public\\.${t} enable row level security`, "i"), t);
});

test("no policy is created (only the service role reaches the tables)", () => {
  assert.doesNotMatch(flat, /create policy/i);
});

test("anon and authenticated lose every right", () => {
  assert.match(flat, /revoke all on [^;]* from anon, authenticated/i);
  for (const t of created) assert.ok(flat.includes(`public.${t}`), t);
});

test("existing tables are not altered, dropped or written", () => {
  // Only whole statements that start with these verbs count (not words inside a trigger or function body).
  const statements = code.split(/;\s*\n/).map((x) => x.replace(/\s+/g, " ").trim().toLowerCase());
  for (const st of statements) {
    const m = st.match(/^(alter table|drop table|insert into|update|delete from|truncate)(?: only| if exists)? (?:public\.)?(\w+)/);
    if (m) assert.ok(m[2].startsWith("mission_"), `touches ${m[2]}`);
  }
  assert.doesNotMatch(flat, /\b(outbox|inbox|reports|staff|visitors|subscribers|joins|posts)\b/i);
});

test("no party name or tier name is seeded", () => {
  assert.doesNotMatch(code, /\b(BJP|Bharatiya|Congress|AAP|JJP|INLD|mandal|shakti|panna|booth|tridev)\b/i);
});

test("the history is add-only for the service role", () => {
  assert.match(flat, /revoke all on public\.mission_history from service_role/i);
  assert.match(flat, /grant select, insert on public\.mission_history to service_role/i);
  assert.match(flat, /create trigger mission_history_guard before update or delete/i);
});

test("the history never stores a phone or email", () => {
  assert.match(flat, /tg_table_name = 'mission_contact_detail'/i);
  assert.match(flat, /- 'value'/);
});

test("every data table has the history trigger and the truncate refusal", () => {
  for (const t of created.filter((x) => x !== "mission_history")) {
    assert.match(flat, new RegExp(`create trigger mission_audit after insert or update or delete on public\\.${t} `, "i"), `audit ${t}`);
    assert.match(flat, new RegExp(`create trigger mission_no_truncate before truncate on public\\.${t} `, "i"), `truncate ${t}`);
  }
});

test("the service role loses every right first, then gets only what it needs", () => {
  assert.match(flat, /revoke all on [^;]* from service_role; grant select, insert, update, delete on/i);
});

test("actor columns do not reference auth.users (so an account can be deleted); only the member table does", () => {
  const refs = [...flat.matchAll(/(\w+)\s+uuid[^,]*references auth\.users/gi)].map((m) => m[1]);
  assert.deepEqual(refs, ["user_id"]);
});

test("notes, payloads and contact values are kept out of the history", () => {
  assert.match(flat, /o - 'value'/);
  assert.match(flat, /o - 'notes'/);
  assert.match(flat, /o - 'payload'/);
});

test("checked needs a checker, a time and a different member", () => {
  assert.match(flat, /state <> 'checked' or \(checked_by is not null and checked_at is not null and checked_by <> entered_by\)/i);
});
