import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {expectedRuntimePrivileges} from '../../db/rr004-runtime-policy.mjs';
export function assertDefaultEngineDisabled(){
  const sql=readFileSync('db/migrations/025_settlement_engine_rollout.sql','utf8');
  assert.match(sql,/enabled boolean NOT NULL DEFAULT false/);
  assert.match(sql,/INSERT INTO settlement_cycle_engine_control\(id\) VALUES\(1\)/);
  assert.doesNotMatch(sql,/INSERT INTO settlement_cycle_engine_cohort/);
  for(const table of ['settlement_cycle_engine_control','settlement_cycle_engine_cohort','settlement_cycle_engine_events']){
    const p=expectedRuntimePrivileges(table);
    assert.equal(p.select,true);assert.equal(p.insert,false);assert.equal(p.update,false);assert.equal(p.delete,false);
  }
}
