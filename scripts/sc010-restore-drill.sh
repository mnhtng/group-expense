#!/usr/bin/env bash
# SC-010 disposable CI recovery rehearsal ONLY.
# Never runs against Neon, staging, production or any supplied URL.
set -euo pipefail
required_url='postgresql://test:test@localhost:5432/group_expense'
if [[ "${CI:-}" != "true" ||
      "${SC010_TEST_ONLY:-}" != "isolated-pg17" ||
      "${DATABASE_URL:-}" != "$required_url" ]]; then
  echo 'SC-010 restore drill refuses non-disposable PostgreSQL' >&2
  exit 2
fi
if ! command -v docker >/dev/null; then
  echo 'Docker is required for version-matched PostgreSQL 17 backup tools' >&2
  exit 2
fi
backup_path="${RUNNER_TEMP:-/tmp}/sc010-ci-restore-${GITHUB_RUN_ID:-manual}.dump"
trap 'rm -f "$backup_path"' EXIT
export RESTORE_DATABASE_URL='postgresql://test:test@localhost:5432/group_expense_sc010_restore'

# Full custom-format, consistent PostgreSQL 17 logical backup on a local
# ephemeral test DB, never a production credential or persistent artifact.
docker run --rm --network host -e PGPASSWORD=test postgres:17 \
  pg_dump -h 127.0.0.1 -p 5432 -U test -d group_expense \
  --format=custom --no-owner --no-acl > "$backup_path"
test -s "$backup_path"

# The restored database is a new disposable database inside the same PG17
# GitHub Actions service; it cannot replace the source.
docker run --rm --network host -e PGPASSWORD=test postgres:17 \
  psql -h 127.0.0.1 -U test -d postgres -v ON_ERROR_STOP=1 \
  -c 'CREATE DATABASE group_expense_sc010_restore'
docker run --rm --network host -e PGPASSWORD=test postgres:17 \
  pg_restore -h 127.0.0.1 -U test \
  -d group_expense_sc010_restore --no-owner --no-acl --exit-on-error \
  < "$backup_path"

node db/sc010-restore-verify.mjs
echo 'SC-010 disposable restore checksum and ledger verification PASSED'
