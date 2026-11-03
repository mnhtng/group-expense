import {
  createCipheriv, createECDH, createHmac, createPrivateKey,
  randomBytes, sign,
} from "node:crypto";

/** RFC 8291 + 8292, aes128gcm single-record Web Push using built-in Node crypto. */
const encoded=(x:Buffer|string)=>Buffer.from(x).toString("base64url");
const expand=(prk:Buffer, info:Buffer,length:number)=>
  createHmac("sha256",prk).update(info).update(Buffer.from([1])).digest().subarray(0,length);
const extract=(salt:Buffer, secret:Buffer)=>
  createHmac("sha256",salt).update(secret).digest();

export function encryptWebPush(plaintext:Buffer, uaPublic:Buffer, auth:Buffer) {
  if(uaPublic.length!==65 || uaPublic[0]!==4 || auth.length!==16)
    throw new Error("Invalid browser ECDH public key / auth secret");
  if(plaintext.length>3993)throw new Error("Push message exceeds 3993-byte limit");
  const local=createECDH("prime256v1");
  const serverPublic=local.generateKeys();
  const shared=local.computeSecret(uaPublic);
  const ikm=expand(extract(auth,shared),
    Buffer.concat([Buffer.from("WebPush: info\0"),uaPublic,serverPublic]),32);
  const salt=randomBytes(16);
  const prk=extract(salt,ikm);
  const cek=expand(prk,Buffer.from("Content-Encoding: aes128gcm\0"),16);
  const nonce=expand(prk,Buffer.from("Content-Encoding: nonce\0"),12);
  const cipher=createCipheriv("aes-128-gcm",cek,nonce);
  const encrypted=Buffer.concat([cipher.update(Buffer.concat([plaintext,Buffer.from([2])])),cipher.final(),cipher.getAuthTag()]);
  const rs=Buffer.alloc(4);
  rs.writeUInt32BE(4096,0);
  return Buffer.concat([salt,rs,Buffer.from([65]),serverPublic,encrypted]);
}
export function vapidToken(endpoint:string, publicKey:string, privateKey:string, subject:string, now=Date.now()) {
  const publicBytes=Buffer.from(publicKey,"base64url");
  const privateBytes=Buffer.from(privateKey,"base64url");
  if(publicBytes.length!==65||publicBytes[0]!==4||privateBytes.length!==32)
    throw new Error("Invalid VAPID P-256 key pair");
  if(!subject.startsWith("mailto:")&&!subject.startsWith("https:"))
    throw new Error("VAPID_SUBJECT must be mailto: or https:");
  const key=createPrivateKey({key:{
    kty:"EC",crv:"P-256",
    x:encoded(publicBytes.subarray(1,33)),
    y:encoded(publicBytes.subarray(33,65)),
    d:encoded(privateBytes),
  },format:"jwk"});
  const input=`${encoded(JSON.stringify({typ:"JWT",alg:"ES256"}))}.${encoded(JSON.stringify({
    aud:new URL(endpoint).origin,exp:Math.floor(now/1000)+12*3600,sub:subject,
  }))}`;
  const signature=sign("sha256",Buffer.from(input),{key,dsaEncoding:"ieee-p1363"});
  return `${input}.${encoded(signature)}`;
}
export type WebPushSubscription={endpoint:string;p256dh:string;auth:string};
export type VapidConfig={publicKey:string;privateKey:string;subject:string};
export async function sendWebPush(
  subscription:WebPushSubscription, config:VapidConfig, payload:unknown,
) {
  const plaintext=Buffer.from(JSON.stringify(payload));
  const ciphertext=encryptWebPush(plaintext,Buffer.from(subscription.p256dh,"base64url"),
    Buffer.from(subscription.auth,"base64url"));
  const jwt=vapidToken(subscription.endpoint,config.publicKey,config.privateKey,config.subject);
  return fetch(subscription.endpoint,{
    method:"POST",redirect:"error",signal:AbortSignal.timeout(8_000),
    headers:{
      "Content-Encoding":"aes128gcm",
      "Content-Type":"application/octet-stream",
      "TTL":"86400",
      "Urgency":"normal",
      "Authorization":`vapid t=${jwt}, k=${config.publicKey}`,
    },
    body:new Uint8Array(ciphertext),
  });
}
