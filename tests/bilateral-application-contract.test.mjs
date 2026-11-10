import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(path,"utf8");
test("BN-004 requires operator cohort authorization or a strictly local fixture, never edits original cash",()=>{
  const s=read("lib/settlement-cycles/applications.ts");
  assert.match(s,/requireEngineAccess\(client,groupId,"BN004_TEST_ONLY"\)/);
  assert.doesNotMatch(s,/UPDATE\s+obligations|UPDATE\s+settlements|INSERT INTO settlements|INSERT INTO settlement_allocations/i);
});
test("only original-source proof is applied with exact two-direction conservation",()=>{
  const sql=read("db/migrations/018_bilateral_noncash_applications.sql");
  assert.match(sql,/bn004_one_application_per_cycle_pair/);
  assert.match(sql,/bn004_one_noncash_discharge_per_obligation/);
  assert.match(sql,/bn004_conservation_on_commit/);
  assert.match(sql,/DEFERRABLE INITIALLY DEFERRED/);
  assert.match(sql,/a<>NEW\.offset_minor OR b<>NEW\.offset_minor/);
  assert.match(sql,/UPDATE OR DELETE/);
  assert.match(sql,/SELECT \* INTO p FROM group_settlement_bilateral_proposals\s+WHERE id=NEW\.proposal_id FOR UPDATE/);
  const s=read("lib/settlement-cycles/applications.ts");
  assert.match(s,/const live=await computed\(/);
  assert.match(s,/live\.fingerprint!==p\.fingerprint/);
  assert.match(s,/SET CONSTRAINTS bn004_conservation_on_commit IMMEDIATE/);
  assert.match(s,/SELECT \$1,s\.proposal_id,s\.group_id,s\.cycle_id,s\.obligation_id/);
});
test("no client-supplied actor or money allocation in the apply API",()=>{
  const route=read("app/api/groups/[groupId]/settlement-cycle/cycles/[cycleId]/bilateral-proposals/[proposalId]/applications/route.ts");
  assert.match(route,/getCurrentSession\(/);
  assert.match(route,/expectedVersion","expectedFingerprint","requestKey/);
  assert.match(route,/session\.user\.id/);
  assert.doesNotMatch(route,/clientAmount|actorId:fields|allocations:fields/);
});
