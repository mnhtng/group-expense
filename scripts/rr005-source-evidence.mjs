/** Read-only, secret-free provenance for LOCAL readiness evidence.
 * A dirty checkout is identified by its actual source digest, never by HEAD
 * alone. This report grants no deployment/migration/financial authorization.
 */
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";

const git=(...args)=>execFileSync("git",args,{encoding:"utf8"});
const codeFile=p=>/\.(?:[cm]?js|tsx?|sql|css|json|ya?ml|sh|patch)$/.test(p)&&
  !p.startsWith("docs/")&&!p.startsWith(".env");
const tracked=git("ls-files","-z").split("\0").filter(Boolean);
const untracked=git("ls-files","--others","--exclude-standard","-z")
  .split("\0").filter(codeFile);
const files=[...new Set([...tracked.filter(codeFile),...untracked])].sort();
const hash=createHash("sha256");
for(const file of files){
  const data=readFileSync(file);
  hash.update(JSON.stringify([file,data.length])+"\n").update(data).update("\n");
}
const policy=readFileSync("db/migrations/025_settlement_engine_rollout.sql","utf8");
if(!/enabled boolean NOT NULL DEFAULT false/.test(policy)||
  !/INSERT INTO settlement_cycle_engine_control\(id\) VALUES\(1\)/.test(policy)||
  /INSERT INTO settlement_cycle_engine_cohort/.test(policy))
  throw Error("Rollout migration must default OFF without enrolling a group");
console.log(JSON.stringify({
  format:"rr005-local-source-evidence-v2",capturedAt:new Date().toISOString(),
  commit:git("rev-parse","HEAD").trim(),
  trackedTreeClean:git("status","--porcelain","--untracked-files=no").trim()==="",
  codeSha256:hash.digest("hex"),codeFiles:files.length,
  untrackedCode:untracked.sort(),
  migrations:readdirSync("db/migrations").filter(p=>p.endsWith(".sql")).sort()
    .map(filename=>({filename,sha256:createHash("sha256")
      .update(readFileSync("db/migrations/"+filename)).digest("hex")})),
  enginePolicy:"operator-controlled-group-cohort",defaultEngineEnabled:false,
  runtimeStateVerified:false,releaseDecision:"NO-GO",
  independentApproval:false,managedRestoreCertified:false,
},null,2));
