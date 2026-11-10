import {assertDefaultEngineDisabled} from './helpers/engine-release-policy.mjs';
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {RR003_TARGET,assertRestoreBranchPlan,evaluateRecoveryMetadata}
  from "../db/rr003-recovery-policy.mjs";

const project=()=>({
  id:RR003_TARGET.project,history_retention_seconds:21600,
  owner:{subscription_type:"free_v3"},
});
const branches=()=>[
  {id:RR003_TARGET.sourceBranch,parent_id:RR003_TARGET.sourceParent,
    default:false,primary:false,protected:false,current_state:"ready"},
  {id:RR003_TARGET.sourceParent,default:false,primary:false},
  {id:"br-round-salad-b39y4yce",default:true,primary:true},
];
const meta=()=>({
  project:project(),branches:branches(),snapshots:[],
  sourceSnapshotSchedule:{schedule:[]},
});
test("RR-003 reports real six-hour provider retention without pretending PITR passed",()=>{
  const outcome=evaluateRecoveryMetadata(meta());
  assert.equal(outcome.retentionSeconds,21600);
  assert.equal(outcome.retentionHours,6);
  assert.equal(outcome.snapshotsOnSource,0);
  assert.equal(outcome.hasScheduledSourceSnapshots,false);
  assert.equal(outcome.pitrAvailabilityVerifiedByRestore,false);
  assert.equal(outcome.independentRestoreVerified,false);
  assert.equal(outcome.financialConservationVerifiedOnRestore,false);
  assert.equal(outcome.decision,"NO-GO");
  assert.ok(outcome.blockers.includes("RPO_RTO_NOT_DECLARED"));
  assert.ok(outcome.blockers.includes("NO_SNAPSHOT_ID_FOR_AVAILABLE_RESTORE_API"));
});
test("RR-003 never converts an available snapshot or declared policy into restore PASS",()=>{
  const x=meta();
  x.snapshots=[{branch_id:RR003_TARGET.sourceBranch,id:"test-snapshot"}];
  x.sourceSnapshotSchedule.schedule=[{frequency:"daily"}];
  const outcome=evaluateRecoveryMetadata({...x,
    declaredRpoSeconds:600,declaredRtoSeconds:1800});
  assert.equal(outcome.recoveryPolicyDeclared,true);
  assert.equal(outcome.decision,"NO-GO");
  assert.equal(outcome.independentRestoreVerified,false);
  assert.equal(outcome.snapshotsOnSource,1);
  assert.equal(outcome.hasScheduledSourceSnapshots,true);
});
test("RR-003 rejects wrong source, branch replacement and changed project",()=>{
  const base=meta();
  assert.throws(()=>evaluateRecoveryMetadata({...base,
    project:{...base.project,id:"other"}}),/unexpected project identity/);
  assert.throws(()=>evaluateRecoveryMetadata({...base,
    branches:base.branches.filter(b=>b.id!==RR003_TARGET.sourceBranch)}),
    /required branch not found/);
  const changed=branches();
  changed[0].parent_id="br-round-salad-b39y4yce";
  assert.throws(()=>evaluateRecoveryMetadata({...base,branches:changed}),
    /isolated source parent changed/);
  const primary=branches();
  primary[0].primary=true;
  assert.throws(()=>evaluateRecoveryMetadata({...base,branches:primary}),
    /ready non-primary/);
  assert.throws(()=>evaluateRecoveryMetadata({...base,
    project:{...project(),history_retention_seconds:0}}),
    /history retention/);
  assert.throws(()=>evaluateRecoveryMetadata({...base,
    snapshots:[{id:"missing-branch-attribution"}]}),
    /snapshot branch attribution is unavailable/);
});
const attempt=()=>({
  projectId:RR003_TARGET.project,
  sourceBranchId:RR003_TARGET.sourceBranch,
  targetBranchId:"br-rr003-new-isolated-123",
  parentBranchId:RR003_TARGET.sourceBranch,
  restoreTimestampUtc:"2026-11-07T10:00:00Z",
  reviewedAtUtc:"2026-11-07T11:00:00Z",
  historyRetentionSeconds:21600,
});
test("RR-003 target policy permits only an unperformed isolated-branch plan",()=>{
  const record=assertRestoreBranchPlan(attempt());
  assert.equal(record.authorized,false);
  assert.equal(record.mutationPerformed,false);
  assert.equal(record.providerRestoreVerified,false);
  assert.equal(record.requestedRestorePoint,"2026-11-07T10:00:00.000Z");
});
test("RR-003 target policy fails closed against dev/prod, source, stale and future points",()=>{
  for(const target of ["br-dry-poetry-b31cudmb",
    "br-round-salad-b39y4yce",RR003_TARGET.sourceBranch]){
    assert.throws(()=>assertRestoreBranchPlan({...attempt(),
      targetBranchId:target}),/NEW independent/);
  }
  assert.throws(()=>assertRestoreBranchPlan({...attempt(),
    projectId:"other"}),/wrong Neon project/);
  assert.throws(()=>assertRestoreBranchPlan({...attempt(),
    parentBranchId:"br-dry-poetry-b31cudmb"}),/descend from isolated source/);
  assert.throws(()=>assertRestoreBranchPlan({...attempt(),
    restoreTimestampUtc:"2026-11-06T04:00:00Z"}),/outside reported retention/);
  assert.throws(()=>assertRestoreBranchPlan({...attempt(),
    restoreTimestampUtc:"2026-11-08T04:00:00Z"}),/future/);
});
test("RR-003 policy must not connect to Neon, restore or write money",()=>{
  const source=readFileSync("db/rr003-recovery-policy.mjs","utf8");
  assert.doesNotMatch(source,/from ["']pg["']|from ["']@neondatabase|fetch\(/);
  assert.doesNotMatch(source,/\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\s+(?:TABLE|INTO|FROM|obligations)/i);
  assertDefaultEngineDisabled();
});
