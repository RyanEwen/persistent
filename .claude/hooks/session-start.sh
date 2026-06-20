#!/bin/bash
#
# SessionStart hook. In the remote (web) environment it reproduces what the
# devcontainer's postCreateCommand does locally: install deps, build the shared
# package that the apps import as built output, stand up Postgres, and apply the
# Prisma schema. Idempotent and non-interactive. Local devs use the devcontainer
# and skip this.

set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

DB_URL="postgresql://postgres:postgres@localhost:5432/persistent?schema=public"
export DATABASE_URL="$DB_URL"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export DATABASE_URL=\"$DB_URL\"" >> "$CLAUDE_ENV_FILE"
fi

# 1. Dependencies (install, not ci, to reuse a cached node_modules).
npm install

# 2. Build the workspace package consumed as built dist/ output.
npm run build --workspace @persistent/shared

# 3. Local Postgres (refuses to run as root; owned by the postgres system user).
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
PGDATA=/tmp/pgdata
PGRUN=/tmp/pgrun

if [ -n "$PGBIN" ]; then
  mkdir -p "$PGDATA" "$PGRUN"
  chown -R postgres:postgres "$PGDATA" "$PGRUN"

  if [ ! -s "$PGDATA/PG_VERSION" ]; then
    su postgres -c "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust"
  fi
  if ! su postgres -c "$PGBIN/pg_ctl -D $PGDATA status" >/dev/null 2>&1; then
    su postgres -c "$PGBIN/pg_ctl -D $PGDATA -l /tmp/pg.log -w \
      -o '-p 5432 -k $PGRUN -c listen_addresses=localhost' start"
  fi
  for _ in $(seq 1 30); do
    if su postgres -c "$PGBIN/pg_isready -h localhost -p 5432" >/dev/null 2>&1; then break; fi
    sleep 1
  done
  if ! su postgres -c "$PGBIN/psql -h localhost -p 5432 -U postgres -tAc \
      \"SELECT 1 FROM pg_database WHERE datname='persistent'\"" | grep -q 1; then
    su postgres -c "$PGBIN/psql -h localhost -p 5432 -U postgres -c 'CREATE DATABASE persistent;'"
  fi

  # 4. Prisma client + schema.
  npm run db:generate
  npm run prisma:migrate:deploy --workspace @persistent/api
fi

echo "session-start hook complete: deps installed, schema applied, Postgres ready."
