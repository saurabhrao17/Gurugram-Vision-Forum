#!/usr/bin/env bash
# Runs the Mission 2029 MP migration against a throwaway local Postgres (no Supabase, no cost,
# nothing live) and checks the locks, the history and the scrub routine with FAKE data only.
# Usage: scripts/mission-db-test.sh   (needs the postgres 16 server binaries; skips if missing)
set -euo pipefail
BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1 || true)"
if [ -z "$BIN" ] || [ ! -x "$BIN/postgres" ]; then
  if [ "${MISSION_DB_REQUIRED:-0}" = "1" ]; then echo "FAIL: no local postgres server found (MISSION_DB_REQUIRED=1)"; exit 1; fi
  echo "SKIP: no local postgres server found"; exit 0
fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; chmod 755 "$TMP"
RUNAS=""; if [ "$(id -u)" = "0" ]; then
  id -u mission-test >/dev/null 2>&1 || useradd -m mission-test >/dev/null 2>&1 || true
  chown mission-test "$TMP"; RUNAS="runuser -u mission-test --"
fi
PORT=$((55000 + RANDOM % 1000)); DATA="$TMP/data"
$RUNAS "$BIN/initdb" -D "$DATA" -A trust -U postgres >/dev/null
$RUNAS "$BIN/pg_ctl" -D "$DATA" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
trap '$RUNAS "$BIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1; rm -rf "$TMP"' EXIT
psqlq() { $RUNAS "$BIN/psql" -h "$TMP" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -X "$@"; }
# Stand-ins for what Supabase provides: roles and auth.users.
psqlq -d postgres <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create table auth.users (id uuid primary key default gen_random_uuid());
grant usage on schema public, auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
SQL
psqlq -d postgres -f "$ROOT/supabase/migrations/20261114000000_mission_tables.sql"
psqlq -d postgres -f "$ROOT/tests/mission-db.sql"
echo "mission-db-test: OK"
