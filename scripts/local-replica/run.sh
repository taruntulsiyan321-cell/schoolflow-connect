#!/usr/bin/env bash
# Build a LOCAL replica of the Gurukul schema and drive the whole test flow
# through it as the real signed-in roles.
#
# WHY THIS EXISTS
#   The database gates this repo relies on — verify:caller-privileges,
#   db:verify-integrity, apply-one-migration — all need the live project. In an
#   environment whose network policy refuses `*.supabase.co` and
#   `api.supabase.com` (see KNOWN_ISSUES 50), that is every one of them, and a
#   migration would otherwise ship on inspection alone.
#
#   This builds the same schema from the repo's own migrations against a
#   throwaway postgres, and runs `flow.mjs` — 90 claims covering the test
#   journey end to end, each driven under RLS as the role that would make the
#   call, each refusal paired with a positive control.
#
#   It is NOT a substitute for applying the migrations to the project. It
#   proves the SQL is right; it says nothing about what the live database
#   currently holds.
#
# USAGE
#   scripts/local-replica/run.sh            build, apply, probe
#   GK_PORT=5433 scripts/local-replica/run.sh
set -euo pipefail

PORT="${GK_PORT:-5433}"
PGDATA="${GK_PGDATA:-/var/lib/postgresql/gurukul-replica}"
PGBIN="${GK_PGBIN:-/usr/lib/postgresql/16/bin}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1; then
  echo "── starting a throwaway postgres on :$PORT"
  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    mkdir -p "$PGDATA" && chown -R postgres:postgres "$PGDATA"
    su postgres -s /bin/bash -c "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust -E UTF8" >/dev/null
  fi
  su postgres -s /bin/bash -c "$PGBIN/pg_ctl -D $PGDATA -l /tmp/gurukul-replica.log \
    -o '-c listen_addresses=127.0.0.1 -p $PORT -c unix_socket_directories=/tmp -c fsync=off' start" >/dev/null
fi

PSQL="psql -h 127.0.0.1 -p $PORT -U postgres -X -q"

echo "── rebuilding the replica"
$PSQL -d postgres -c "DROP DATABASE IF EXISTS gurukul WITH (FORCE);" -c "CREATE DATABASE gurukul;"
$PSQL -d gurukul -v ON_ERROR_STOP=1 -f "$HERE/prelude.sql" >/dev/null

echo "── applying every migration in supabase/migrations"
GK_PORT="$PORT" node "$HERE/apply.mjs" | tail -3

echo "── driving the test flow as the real callers"
GK_PORT="$PORT" node "$HERE/flow.mjs"
