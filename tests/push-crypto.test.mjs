import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDecipheriv, createECDH, createHmac, createPublicKey, randomBytes, verify,
} from "node:crypto";
import { encryptWebPush, vapidToken } from "../lib/notifications/web-push-crypto.ts";

function extract(salt,key){return createHmac("sha256",salt).update(key).digest();}
function expand(key,info,length){return createHmac("sha256",key)
  .update(info).update(Buffer.from([1])).digest().subarray(0,length);}
test("RFC8291 encrypted Web Push payload decrypts with recipient keys",()=>{
  const client=createECDH("prime256v1");const pub=client.generateKeys();
  const auth=randomBytes(16),message=Buffer.from(JSON.stringify({title:"Thông báo",body:"12.000 ₫"}));
  const content=encryptWebPush(message,pub,auth);
  assert.equal(content.readUInt32BE(16),4096);
  assert.equal(content[20],65);
  const salt=content.subarray(0,16),serverPublic=content.subarray(21,86);
  const derived=expand(extract(auth,client.computeSecret(serverPublic)),
    Buffer.concat([Buffer.from("WebPush: info\0"),pub,serverPublic]),32);
  const prk=extract(salt,derived);
  const cek=expand(prk,Buffer.from("Content-Encoding: aes128gcm\0"),16);
  const nonce=expand(prk,Buffer.from("Content-Encoding: nonce\0"),12);
  const raw=content.subarray(86),body=raw.subarray(0,-16),tag=raw.subarray(-16);
  const cipher=createDecipheriv("aes-128-gcm",cek,nonce);
  cipher.setAuthTag(tag);
  const clear=Buffer.concat([cipher.update(body),cipher.final()]);
  assert.equal(clear.at(-1),2);
  assert.deepEqual(clear.subarray(0,-1),message);
  assert.throws(()=>encryptWebPush(randomBytes(3994),pub,auth));
});
test("RFC8292 ES256 VAPID claims verify with the corresponding public key",()=>{
  const vapid=createECDH("prime256v1");const pub=vapid.generateKeys();
  const priv=vapid.getPrivateKey();
  const now=Date.now();
  const token=vapidToken("https://fcm.googleapis.com/fcm/send/test",
    pub.toString("base64url"),priv.toString("base64url"),
    "mailto:ops@example.com",now);
  const parts=token.split(".");
  assert.equal(parts.length,3);
  const claim=JSON.parse(Buffer.from(parts[1],"base64url").toString());
  assert.equal(claim.aud,"https://fcm.googleapis.com");
  assert.equal(claim.sub,"mailto:ops@example.com");
  assert.ok(claim.exp>Math.floor(now/1000)+40_000);
  const key=createPublicKey({format:"jwk",key:{kty:"EC",crv:"P-256",
    x:pub.subarray(1,33).toString("base64url"),
    y:pub.subarray(33,65).toString("base64url"),
  }});
  assert.ok(verify("sha256",Buffer.from(parts.slice(0,2).join(".")),
    {key,dsaEncoding:"ieee-p1363"},Buffer.from(parts[2],"base64url")));
});
