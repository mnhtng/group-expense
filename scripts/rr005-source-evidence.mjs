/** Read-only, secret-free provenance for LOCAL readiness evidence.
 * A dirty checkout is identified by its actual source digest, never by HEAD
 * alone. This report grants no deployment/migration/financial authorization.
 */
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";

const git=(...args)=>execFileSync("git",args,{encoding:"utf8"});
const codeFile=p=>/\.(?:[cm]?js|tsx?|sql|css|json|ya?ml|sh)$/.test(p)&&
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
const settings=readFileSync("lib/settlement-cycles/settings.ts","utf8");
if(!/export const SETTLEMENT_CYCLE_ENGINE_READY = false as boolean;/.test(settings))
  throw Error("Readiness source no longer has the reviewed hard-OFF gate");
console.log(JSON.stringify({
  format:"rr005-local-source-evidence-v1",capturedAt:new Date().toISOString(),
  commit:git("rev-parse","HEAD").trim(),
  trackedTreeClean:git("status","--porcelain","--untracked-files=no").trim()==="",
  codeSha256:hash.digest("hex"),codeFiles:files.length,
  untrackedCode:untracked.sort(),
  migrations:readdirSync("db/migrations").filter(p=>p.endsWith(".sql")).sort()
    .map(filename=>({filename,sha256:createHash("sha256")
      .update(readFileSync("db/migrations/"+filename)).digest("hex")})),
  financialEngineReady:false,releaseDecision:"NO-GO",
  independentApproval:false,managedRestoreCertified:false,
},null,2));
