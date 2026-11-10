import "server-only";
import {createHash} from "node:crypto";
import {pool} from "@/lib/db/pool";
import {readEngineRollout} from "@/lib/settlement-cycles/engine";
import {readRuntimePrivileges,evaluateRuntimePrivileges}
  from "@/db/rr004-runtime-policy.mjs";

/** Inspect the application's actual login; return only fingerprints/codes. */
export async function readRuntimeAttestation(){
  const client=await pool.connect();
  try{
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout='5s'");
    const identity=(await client.query(`SELECT current_user AS role,
      session_user AS login,current_database() AS database`)).rows[0];
    const snapshot=await readRuntimePrivileges(client);
    const result=evaluateRuntimePrivileges(snapshot);
    const rollout=await readEngineRollout(client);
    await client.query("COMMIT");
    const fingerprint=(value:string)=>createHash("sha256").update(value).digest("hex");
    const url=new URL(process.env.DATABASE_URL!);
    const deployment=process.env.VERCEL_GIT_COMMIT_SHA;
    const sameLogin=identity.role===identity.login;
    return {
      format:"rr004-runtime-attestation-v1",checkedAt:new Date().toISOString(),
      ok:result.ok&&sameLogin,
      blockerCodes:[...result.blockerCodes,...(sameLogin?[]:["SESSION_IDENTITY_MISMATCH"])],
      roleFingerprint:fingerprint(identity.role),
      loginFingerprint:fingerprint(identity.login),
      connectionFingerprint:fingerprint(JSON.stringify([
        url.hostname.replace(/-pooler(?=\.)/,""),identity.database,
      ])),
      deploymentSha:deployment&&/^[a-f0-9]{40}$/.test(deployment)?deployment:null,
      rollout,financialEngineReady:rollout.enabled,
      releaseDecision:rollout.enabled?"CONTROLLED_ROLLOUT":"NO-GO",
    };
  }catch(error){
    await client.query("ROLLBACK");throw error;
  }finally{client.release();}
}
