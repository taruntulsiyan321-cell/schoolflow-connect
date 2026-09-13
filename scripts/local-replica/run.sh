#!/usr/bin/env bash
# Build a LOCAL replica of the Gurukul schema and drive the test and homework
# flows through it as the real signed-in roles.
#
# WHY THIS EXISTS
#   The database gates this repo relies on — verify:caller-privileges,
#   db:verify-integrity, apply-one-migration — all need the live project. In an
#   environment whose network policy refuses `*.supabase.co` and
#   `api.supabase.com` (see KNOWN_ISSUES 50), that is every one of them, and a
#   migration would otherwise ship on inspection alone.
#
#   This builds the same schema from the repo's own migrations against a
#   throwaway postgres, and runs `flow.mjs` — the test journey and the homework
#   journey end to end, each claim driven under RLS as the role that would make
#   the call, each refusal paired with a positive control.
#
#   It is NOT a substitute for applying the migrations to the project. It
#   proves the SQL is right; it says nothing about what the live database
#   currently holds.
#
#   Everything talks to the server through the `pg` client (apply.mjs, flow.mjs),
#   so the only thing needed is a reachable server — no psql. The block below
#   starts one only when none answers, and only where the Linux cluster tools
#   exist; anywhere else, start postgres on $GK_PORT yourself first.
#
# USAGE
#   scripts/local-replica/run.sh            build, apply, probe
#   GK_PORT=5433 scripts/local-replica/run.sh
set -euo pipefail

PORT="${GK_PORT:-5433}"
PGDATA="${GK_PGDATA:-/var/lib/postgresql/gurukul-replica}"
PGBIN="${GK_PGBIN:-/usr/lib/postgresql/16/bin}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! GK_PORT="$PORT" node "$HERE/apply.mjs" --ready; then
  if [ ! -x "$PGBIN/pg_ctl" ]; then
    echo "no postgres answers on 127.0.0.1:$PORT, and $PGBIN/pg_ctl does not exist to start one." >&2
    echo "Start a postgres 16 server on that port (user postgres, trust auth), or set GK_PGBIN." >&2
    exit 2
  fi
  echo "── starting a throwaway postgres on :$PORT"
  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    mkdir -p "$PGDATA" && chown -R postgres:postgres "$PGDATA"
    su postgres -s /bin/bash -c "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust -E UTF8" >/dev/null
  fi
  su postgres -s /bin/bash -c "$PGBIN/pg_ctl -D $PGDATA -l /tmp/gurukul-replica.log \
    -o '-c listen_addresses=127.0.0.1 -p $PORT -c unix_socket_directories=/tmp -c fsync=off' start" >/dev/null
fi

echo "── rebuilding the replica and applying every migration in supabase/migrations"
GK_PORT="$PORT" node "$HERE/apply.mjs" | tail -4

echo "── driving the flows as the real callers"
GK_PORT="$PORT" node "$HERE/flow.mjs"
