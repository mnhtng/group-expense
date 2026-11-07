/**
 * RR-003: pure read-only evaluation of provider recovery metadata.
 * No Neon API calls, database connection, restore, snapshot or mutation.
 * Never accept an operational recovery promise without a measured drill.
 */
export const RR003_TARGET=Object.freeze({
  project:"withered-salad-00928018",
  sourceBranch:"br-curly-rice-b3xenws6",
  sourceParent:"br-dry-poetry-b31cudmb",
  excludedBranches:["br-dry-poetry-b31cudmb","br-round-salad-b39y4yce"],
  database:"group_expense",
});
const refuse=message=>{throw Error("RR-003 refused: "+message);};
const isObject=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const requiredId=(value,label)=>{
  if(typeof value!=="string"||!/^br-[a-z0-9-]+$/.test(value))
    refuse(label+" is invalid");
};
export function assertRestoreBranchPlan({
  projectId,sourceBranchId,targetBranchId,parentBranchId,
  restoreTimestampUtc,reviewedAtUtc,historyRetentionSeconds,
}){
  if(projectId!==RR003_TARGET.project)refuse("wrong Neon project");
  if(sourceBranchId!==RR003_TARGET.sourceBranch)refuse("source must be RR-001 isolated branch");
  requiredId(targetBranchId,"target branch");
  if(targetBranchId===sourceBranchId||
    RR003_TARGET.excludedBranches.includes(targetBranchId))
    refuse("destination must be a NEW independent isolated branch");
  if(parentBranchId!==RR003_TARGET.sourceBranch)
    refuse("restore destination must descend from isolated source");
  if(typeof historyRetentionSeconds!=="number"||
    !Number.isSafeInteger(historyRetentionSeconds)||historyRetentionSeconds<=0)
    refuse("missing positive provider retention");
  const at=Date.parse(restoreTimestampUtc);
  const now=Date.parse(reviewedAtUtc);
  if(!Number.isFinite(at)||!Number.isFinite(now)||at>now)
    refuse("restore timestamp is invalid or in the future");
  if(now-at>historyRetentionSeconds*1000)
    refuse("requested PITR point is outside reported retention");
  return {projectId,sourceBranchId,targetBranchId,parentBranchId,
    requestedRestorePoint: new Date(at).toISOString(),
    authorized:false,mutationPerformed:false,providerRestoreVerified:false};
}
/** All input objects are metadata only, never SQL rows or secret URLs. */
export function evaluateRecoveryMetadata({
  project,branches,snapshots,sourceSnapshotSchedule,
  declaredRpoSeconds=null,declaredRtoSeconds=null,
}){
  if(!isObject(project)||project.id!==RR003_TARGET.project)
    refuse("unexpected project identity");
  if(!Array.isArray(branches)||!Array.isArray(snapshots)||
    !isObject(sourceSnapshotSchedule))
    refuse("metadata arrays/schedule missing");
  const source=branches.find(b=>b.id===RR003_TARGET.sourceBranch);
  const parent=branches.find(b=>b.id===RR003_TARGET.sourceParent);
  const production=branches.find(b=>b.id==="br-round-salad-b39y4yce");
  if(!source||!parent||!production)refuse("required branch not found");
  if(source.parent_id!==RR003_TARGET.sourceParent)
    refuse("isolated source parent changed");
  if(source.default||source.primary||source.protected||
    source.current_state!=="ready")
    refuse("isolated source is not a ready non-primary branch");
  if(production.default!==true||production.primary!==true)
    refuse("production default/primary role differs from baseline");
  const retention=project.history_retention_seconds;
  if(!Number.isSafeInteger(retention)||retention<=0)
    refuse("provider history retention is not a positive integer");
  if(!Array.isArray(sourceSnapshotSchedule.schedule))
    refuse("source schedule is not an array");
  const branchSnapshots=snapshots.filter(x=>x.branch_id===RR003_TARGET.sourceBranch);
  const validRpo=Number.isSafeInteger(declaredRpoSeconds)&&declaredRpoSeconds>0;
  const validRto=Number.isSafeInteger(declaredRtoSeconds)&&declaredRtoSeconds>0;
  return {
    projectId:RR003_TARGET.project,
    sourceBranchId:RR003_TARGET.sourceBranch,
    parentBranchId:RR003_TARGET.sourceParent,
    excludedBranches:[...RR003_TARGET.excludedBranches],
    database:RR003_TARGET.database,
    providerPlan:project.owner?.subscription_type??"unknown",
    retentionSeconds:retention,
    retentionHours:retention/3600,
    snapshotsOnSource:branchSnapshots.length,
    hasScheduledSourceSnapshots:sourceSnapshotSchedule.schedule.length>0,
    declaredRpoSeconds:validRpo?declaredRpoSeconds:null,
    declaredRtoSeconds:validRto?declaredRtoSeconds:null,
    recoveryPolicyDeclared:validRpo&&validRto,
    pitrAvailabilityVerifiedByRestore:false,
    independentRestoreVerified:false,
    financialConservationVerifiedOnRestore:false,
    externalAlertDeliveryVerified:false,
    decision:"NO-GO",
    blockers:[
      ...(!validRpo||!validRto?["RPO_RTO_NOT_DECLARED"]:[]),
      "PITR_RESTORE_NOT_PERFORMED",
      "INDEPENDENT_RESTORE_LEDGER_AUDIT_PENDING",
      "EXTERNAL_ALERT_DELIVERY_NOT_VERIFIED",
      ...(branchSnapshots.length===0?["NO_MANUAL_PROVIDER_SNAPSHOT_EVIDENCE"]:[]),
      ...(sourceSnapshotSchedule.schedule.length===0?["NO_SCHEDULED_SNAPSHOT_ON_SOURCE"]:[]),
    ],
  };
}
