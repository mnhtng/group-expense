#!/usr/bin/env bash
# Signed application regression with a genuine non-owner runtime LOGIN.
# Owns one new loopback-only PG17 container and removes it on every exit.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
for tool in docker node git; do command -v "$tool" >/dev/null; done
node -e 'if(process.versions.node.split(".")[0]!=="22")process.exit(1)' || {
  echo 'RR-004 requires Node 22.x to match the deployed runtime.' >&2; exit 2;
}
expected='postgresql://test:test@localhost:5432/group_expense'
owner='postgresql://rr004_owner:rr004-disposable-owner@localhost:5432/group_expense'
if [[ "${DATABASE_URL:-$expected}" != "$expected" || -n "${DATABASE_URL_DIRECT:-}${PGHOST:-}${PGSERVICE:-}${PGOPTIONS:-}" ]]; then
  echo 'RR-004 refuses unrelated database settings.' >&2; exit 2
fi
container="rr004-runtime-${UID:-0}-$$"
cleanup(){
  result=$?; trap - EXIT
  docker rm -fv "$container" >/dev/null 2>&1 || true
  exit "$result"
}
trap cleanup EXIT
docker run -d --name "$container" -e POSTGRES_USER=rr004_owner \
  -e POSTGRES_PASSWORD=rr004-disposable-owner -e POSTGRES_DB=group_expense \
  -p 127.0.0.1:5432:5432 postgres:17 >/dev/null
for i in {1..60}; do
  if docker exec "$container" pg_isready -q -U rr004_owner -d group_expense; then ready=1; break; fi
  sleep 1
done
[[ "${ready:-0}" == 1 ]] || { echo 'RR-004 PG17 startup failed.' >&2; exit 1; }
export CI=true DATABASE_URL="$expected" RR004_FIXTURE_DATABASE_URL="$owner"
export RR004_TEST_ONLY=isolated-pg17 RR004_PROVISION_RUNTIME=approved-disposable
export BETTER_AUTH_SECRET=rr004-disposable-better-auth-secret-for-local-profile
export BETTER_AUTH_URL=http://localhost:3101
export CRON_SECRET=rr004-disposable-local-cron-token-for-role-profile
export NEXT_TELEMETRY_DISABLED=1
mkdir -p rr003-artifacts/runtime-role
node scripts/rr005-source-evidence.mjs > rr003-artifacts/runtime-role/source-before.json
DATABASE_URL="$owner" node db/migrate.mjs
DATABASE_URL="$owner" node db/migrate.mjs
node db/rr004-local-runtime.mjs provision > rr003-artifacts/runtime-role/privileges-before.json
node db/rr004-local-runtime.mjs inspect
node node_modules/next/dist/bin/next build > rr003-artifacts/runtime-role/build.log 2>&1
export SC005_TEST_ONLY=isolated-pg17 BN004_TEST_ONLY=isolated-pg17 BN006_TEST_ONLY=isolated-pg17
export SC007_TEST_ONLY=isolated-pg17 SC009_TEST_ONLY=isolated-pg17
node --test tests/*.smoke.mjs > rr003-artifacts/runtime-role/http.log 2>&1
node db/sc007-audit.mjs > rr003-artifacts/runtime-role/audit.json
unset SC005_TEST_ONLY BN004_TEST_ONLY BN006_TEST_ONLY SC007_TEST_ONLY SC009_TEST_ONLY
if [[ -n "${RR002_PLAYWRIGHT_ENTRY:-}" ]]; then
  unset RR002_PROFILE
  export RR002_TEST_ONLY=isolated-pg17 BETTER_AUTH_URL=http://localhost:3112
  node --test tests/rr002-browser.e2e.mjs > rr003-artifacts/runtime-role/browser.log 2>&1
fi
node db/rr004-local-runtime.mjs inspect > rr003-artifacts/runtime-role/privileges-after.json
node scripts/rr005-source-evidence.mjs > rr003-artifacts/runtime-role/source-after.json
node --input-type=module - <<'JS'
import {readFileSync,writeFileSync} from 'node:fs';
const root='rr003-artifacts/runtime-role/';
const before=JSON.parse(readFileSync(root+'source-before.json'));
const after=JSON.parse(readFileSync(root+'source-after.json'));
if(before.codeSha256!==after.codeSha256)throw Error('Source changed during runtime-role verification');
const summary={format:'rr004-runtime-local-v1',completedAt:new Date().toISOString(),
  source:after,applicationRole:'separate-non-owner-login',fixtureRole:'isolated-owner-only',
  httpPassed:true,browserProfilesPassed:process.env.RR002_PLAYWRIGHT_ENTRY?4:0,
  financialAuditPassed:true,managedNeonRoleVerified:false,releaseDecision:'NO-GO'};
writeFileSync(root+'summary.json',JSON.stringify(summary,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(summary));
JS
