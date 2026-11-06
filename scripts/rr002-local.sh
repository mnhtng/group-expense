#!/usr/bin/env bash
# RR-002 local Chromium/WebKit E2E — disposable Docker PostgreSQL 17 only.
# Does NOT activate the settlement engine or connect to Neon.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
readonly expected_database_url='postgresql://test:test@localhost:5432/group_expense'
readonly origin='http://localhost:3112'

for executable in docker node npm pnpm; do
  if ! command -v "$executable" >/dev/null 2>&1; then
    printf 'RR-002 refused: missing %s\n' "$executable" >&2
    exit 1
  fi
done
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)' || {
  echo 'RR-002 refused: Node.js 22+ required.' >&2
  exit 1
}
if [[ "${DATABASE_URL:-}" != '' && "${DATABASE_URL}" != "$expected_database_url" ]]; then
  echo 'RR-002 refused: an unrelated DATABASE_URL is present in the shell.' >&2
  exit 1
fi
if [[ "${DATABASE_URL_DIRECT:-}" != '' || "${PGHOST:-}" != '' || "${PGSERVICE:-}" != '' ]]; then
  echo 'RR-002 refused: unrelated direct PostgreSQL connection settings are present.' >&2
  exit 1
fi
if [[ "${RR002_TEST_ONLY:-}" != '' && "${RR002_TEST_ONLY}" != 'isolated-pg17' ]]; then
  echo 'RR-002 refused: RR002_TEST_ONLY mismatch.' >&2
  exit 1
fi
if [[ "${BN004_TEST_ONLY:-}${BN006_TEST_ONLY:-}${SC005_TEST_ONLY:-}${SC007_TEST_ONLY:-}${SC009_TEST_ONLY:-}" != '' ]]; then
  echo 'RR-002 refused: financial test-write flags are set.' >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo 'RR-002 refused: Docker daemon not available.' >&2
  exit 1
fi

container="rr002-pg17-${UID:-0}-$$"
workspace="$(mktemp -d "${TMPDIR:-/tmp}/rr002-playwright.XXXXXXXX")"
cleanup() {
  status=$?
  trap - EXIT
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$workspace"
  exit "$status"
}
trap cleanup EXIT

# Bind only the machine's loopback; fails rather than adopting any running
# PostgreSQL instance. The container is deleted even after a failing test.
echo 'RR-002: starting temporary PostgreSQL 17 on 127.0.0.1:5432 ...'
docker run --rm -d --name "$container" \
  -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=group_expense \
  -p 127.0.0.1:5432:5432 postgres:17 >/dev/null
for i in {1..90}; do
  if docker exec "$container" pg_isready -q -U test -d group_expense; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "${ready:-0}" != '1' ]]; then
  echo 'RR-002: disposable PostgreSQL 17 did not become ready.' >&2
  exit 1
fi

export CI=true
export RR002_TEST_ONLY='isolated-pg17'
export DATABASE_URL="$expected_database_url"
export BETTER_AUTH_URL="$origin"
export BETTER_AUTH_SECRET='rr002-disposable-local-only-very-long-secret'
export NEXT_TELEMETRY_DISABLED=1

echo 'RR-002: installing locked application dependencies and verifying migrations ...'
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:migrate
pnpm build

echo 'RR-002: installing pinned Playwright into disposable tooling directory ...'
npm install --prefix "$workspace" \
  --no-save --no-package-lock --ignore-scripts --no-audit --no-fund \
  playwright@1.64.1
"$workspace/node_modules/.bin/playwright" install chromium webkit
export RR002_PLAYWRIGHT_ENTRY="$workspace/node_modules/playwright/index.mjs"

echo 'RR-002: running signed Chromium/WebKit E2E against disposable localhost PG17 ...'
node --test --test-reporter=spec tests/rr002-browser.e2e.mjs
printf '\nRR-002 local browser E2E PASS. Physical iOS/Android remain untested.\n'
