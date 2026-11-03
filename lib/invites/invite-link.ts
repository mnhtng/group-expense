/** Convert a legacy invite URL to the current staging/production origin. */
export function normalizeInviteUrl(raw:string,origin:string):string|null {
  try{
    const parsed=new URL(raw,origin);
    const match=/^\/invite\/([A-Za-z0-9_-]{32,100})\/?$/.exec(parsed.pathname);
    if(!match)return null;
    const base=new URL(origin);
    if(!["https:","http:"].includes(base.protocol))return null;
    return new URL(`/invite/${match[1]}`,base).href;
  }catch{return null;}
}
