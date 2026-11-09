import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {RR001_TARGET,verifyRR001Environment}
  from "../db/rr001-neon-preflight.mjs";

const url=(host,db="group_expense",role="test_role",password="fake-secret")=>
  `postgresql://${role}:${password}@${host}/${db}?sslmode=require`;
const baseline=()=>({
  RR001_PROJECT_ID:RR001_TARGET.project,
  RR001_BRANCH_ID:RR001_TARGET.branch,
  DATABASE_URL:url(RR001_TARGET.pooledHost),
  DATABASE_URL_DIRECT:url(RR001_TARGET.directHost),
});
const rejected=(patch,expected)=>{
  assert.throws(()=>verifyRR001Environment({...baseline(),...patch}),expected);
};

test("RR-001 accepts only the intended isolated Neon child endpoints",()=>{
  const result=verifyRR001Environment(baseline());
  assert.match(result.runtimeUrl,/pooler/);
  assert.match(result.directUrl,/neon\.tech/);
});
test("RR-001 rejects missing/mismatched project and branch metadata",()=>{
  rejected({RR001_PROJECT_ID:undefined},/project identity mismatch/);
  rejected({RR001_PROJECT_ID:"other-project"},/project identity mismatch/);
  rejected({RR001_BRANCH_ID:undefined},/branch identity mismatch/);
  rejected({RR001_BRANCH_ID:"br-dry-poetry-b31cudmb"},/branch identity mismatch/);
  rejected({RR001_BRANCH_ID:"br-round-salad-b39y4yce"},/branch identity mismatch/);
});
test("RR-001 refuses any other compute host, including a parent or production URL",()=>{
  rejected({DATABASE_URL_DIRECT:url("ep-production.c-4.ap-southeast-1.aws.neon.tech")},
    /outside the pinned child endpoint/);
  rejected({DATABASE_URL:url(RR001_TARGET.directHost)},
    /outside the pinned child endpoint/);
  rejected({DATABASE_URL_DIRECT:url(RR001_TARGET.pooledHost)},
    /outside the pinned child endpoint/);
});
test("RR-001 refuses wrong database name even on the isolated branch",()=>{
  rejected({DATABASE_URL_DIRECT:url(RR001_TARGET.directHost,"postgres")},
    /database mismatch/);
  rejected({DATABASE_URL:url(RR001_TARGET.pooledHost,"neondb")},
    /database mismatch/);
});
test("RR-001 refuses plaintext and missing TLS for either endpoint",()=>{
  rejected({DATABASE_URL_DIRECT:url(RR001_TARGET.directHost).replace(
    "postgresql:","http:")},/must use PostgreSQL/);
  rejected({DATABASE_URL_DIRECT:url(RR001_TARGET.directHost).replace(
    "sslmode=require","sslmode=disable")},/requires TLS/);
  rejected({DATABASE_URL:url(RR001_TARGET.pooledHost).split("?")[0]},
    /requires TLS/);
});
test("RR-001 requires identical DB roles and credentials",()=>{
  rejected({DATABASE_URL_DIRECT:url(RR001_TARGET.directHost,
    "group_expense","another_role")},/role mismatch/);
  rejected({DATABASE_URL_DIRECT:url(RR001_TARGET.directHost,
    "group_expense","test_role","other-secret")},/credential mismatch/);
});
test("RR-001 fails closed on missing URL, credentials, wrong port or fragments",()=>{
  rejected({DATABASE_URL:""},/is missing/);
  rejected({DATABASE_URL_DIRECT:"not-a-url"},/not a valid URL/);
  rejected({DATABASE_URL_DIRECT:url(RR001_TARGET.directHost).replace(
    "test_role:fake-secret@","test_role@")},/credentials missing/);
  rejected({DATABASE_URL_DIRECT:url(RR001_TARGET.directHost).replace(
    "/group_expense",":9999/group_expense")},/port mismatch/);
  rejected({DATABASE_URL_DIRECT:url(RR001_TARGET.directHost)+"#abc"},
    /URL fragment is forbidden/);
});
test("RR-001 read-only audit cannot enable finance or invoke a schema writer",()=>{
  const source=readFileSync("db/rr001-neon-preflight.mjs","utf8");
  const settings=readFileSync("lib/settlement-cycles/settings.ts","utf8");
  assert.match(source,/REPEATABLE READ READ ONLY/);
  assert.match(source,/schema_migrations ORDER BY filename/);
  assert.match(source,/sha256/);
  assert.match(source,/schemaWritePerformed:false/);
  assert.doesNotMatch(source,/\b(?:INSERT INTO|UPDATE\s+obligations|DELETE FROM|ALTER TABLE|CREATE TABLE|DROP TABLE)\b/i);
  assert.match(settings,/SETTLEMENT_CYCLE_ENGINE_READY = false/);
});

test("RR-001 historical 23-migration evidence reports new source migrations as pending",async()=>{
  const {verifyMigrationChecksums}=await import("../db/rr001-neon-preflight.mjs");
  const {readdirSync}=await import("node:fs");
  const {createHash}=await import("node:crypto");
  const names=readdirSync("db/migrations").filter(x=>x.endsWith(".sql")).sort();
  const rows=names.slice(0,23).map(filename=>({filename,
    checksum_sha256:createHash("sha256").update(readFileSync("db/migrations/"+filename)).digest("hex")}));
  const result=await verifyMigrationChecksums(rows);
  assert.equal(result.installedCount,23);
  assert.equal(result.sourceSchemaParity,false);
  assert.deepEqual(result.pendingMigrationFiles,["024_legacy_audit_immutability.sql"]);
  await assert.rejects(verifyMigrationChecksums([...rows,{filename:names[23]}]),/approved baseline/);
  rows[0].checksum_sha256="a".repeat(64);
  await assert.rejects(verifyMigrationChecksums(rows),/checksum drift/);
});
