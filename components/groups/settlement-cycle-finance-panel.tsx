"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";
import {useEffect,useRef,useState} from "react";
import type {BilateralProposalPreview} from "@/lib/settlement-cycles/proposals";
import type {DecisionView} from "@/lib/settlement-cycles/decisions";
import type {AppliedNoncashDocument} from "@/lib/settlement-cycles/applications";
import type {ResidualPreview} from "@/lib/settlement-cycles/residual-repayments";
import type {BatchPairPreview} from "@/lib/settlement-cycles/repayments";
import {summarizeBilateralPreview,cashActionCopy} from "@/lib/settlement-cycles/finance-ux";

type Member={id:string;name:string};
type Attempt={id:string;status:"pending"|"confirmed"|"rejected"|"cancelled";
  amountMinor:string};
type Residual={preview:ResidualPreview;history:Attempt[];writable:boolean};
type PairState={proposal:BilateralProposalPreview;decision:DecisionView|null;
  application:AppliedNoncashDocument|null;residual:Residual|null};
type PairCard={member:Member;preview:BilateralProposalPreview};
const money=(s:string)=>new Intl.NumberFormat("vi-VN").format(BigInt(s))+" ₫";
const endpoint=(g:string,c:string)=>"/api/groups/"+g+"/settlement-cycle/cycles/"+c;
async function json<T>(url:string,method="GET",data?:Record<string,unknown>,
  signal?:AbortSignal):Promise<T>{
  const res=await fetch(url,{method,credentials:"same-origin",cache:"no-store",signal,
    ...(data?{headers:{"content-type":"application/json"},body:JSON.stringify(data)}:{})});
  const body:unknown=await res.json().catch(()=>null);
  if(!res.ok){
    const message=body&&typeof body==="object"&&"error" in body&&
      typeof body.error==="string"?body.error:"Không thể xử lý. Hãy thử lại.";
    throw Object.assign(Error(message),{status:res.status});
  }
  return body as T;
}
function PairDetail({groupId,cycleId,me,member,people,enabled,onUpdated}:{
  groupId:string;cycleId:string;me:string;member:Member;people:Member[];
  enabled:boolean;onUpdated:()=>void;
}){
  const router=useRouter(),other=member.id;
  const root=endpoint(groupId,cycleId);
  const proposalUrl=root+"/bilateral-proposals";
  const [data,setData]=useState<PairState|null>(null);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  const [revision,setRevision]=useState(0);
  const [createdCash,setCreatedCash]=useState<string|null>(null);
  const retryKey=useRef<{operation:string;key:string}|null>(null);
  const name=(id:string)=>people.find(p=>p.id===id)?.name??"Thành viên";
  useEffect(()=>{
    const ctrl=new AbortController();
    async function load(){
      try{
        const q=new URLSearchParams({partyAId:me,partyBId:other});
        const proposal=await json<BilateralProposalPreview>(proposalUrl+"?"+q,"GET",undefined,ctrl.signal);
        let decision:DecisionView|null=null,application:AppliedNoncashDocument|null=null;
        let residual:Residual|null=null;
        if(proposal.current){
          const path=proposalUrl+"/"+proposal.current.id;
          decision=await json<DecisionView>(path+"/decisions","GET",undefined,ctrl.signal);
          const applied=await json<{application:AppliedNoncashDocument|null}>(
            path+"/applications","GET",undefined,ctrl.signal);
          application=applied.application;
          if(application)residual=await json<Residual>(
            root+"/bilateral-applications/"+application.id+"/residual","GET",undefined,ctrl.signal);
        }
        if(!ctrl.signal.aborted){setData({proposal,decision,application,residual});setError("");}
      }catch(e){
        if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:"Không tải được công nợ.");
      }finally{if(!ctrl.signal.aborted)setLoading(false);}
    }
    void load();
    return ()=>ctrl.abort();
  },[proposalUrl,root,me,other,revision]);
  const reload=()=>{setLoading(true);setRevision(x=>x+1);onUpdated();router.refresh();};
  const run=async(action:"agree"|"reject"|"residual")=>{
    if(!data||!enabled||saving)return;
    const operation=action+":"+data.proposal.fingerprint;
    if(retryKey.current?.operation!==operation)
      retryKey.current={operation,key:crypto.randomUUID()};
    const requestKey=retryKey.current.key;
    setSaving(true);setError("");
    try{
      if(action==="residual"){
        if(!data.application||!data.residual||data.residual.preview.status!=="ready")return;
        const r=await json<{id:string}>(
          root+"/bilateral-applications/"+data.application.id+"/residual","POST",{
            expectedCycleVersion:3,expectedFingerprint:data.residual.preview.fingerprint,requestKey});
        setCreatedCash(r.id);
      }else{
        await json(root+"/quick-setoff","POST",{
          action,otherId:other,expectedFingerprint:data.proposal.fingerprint,
          expectedVersion:data.proposal.currentVersion,requestKey});
      }
      retryKey.current=null;reload();
    }catch(e){
      if(e&&typeof e==="object"&&"status" in e&&e.status===409){
        retryKey.current=null;reload();
      }
      setError(e instanceof Error?e.message:"Không có kết nối. Hãy thử lại.");
    }finally{setSaving(false);}
  };
  if(loading)return <p role="status" className="py-3 text-sm text-muted-foreground">Đang tải…</p>;
  if(!data)return <div role="alert" className="space-y-2 text-sm">
    <p>{error||"Không tải được."}</p>
    <button type="button" onClick={reload} className="min-h-11 underline">Thử lại</button>
  </div>;
  const {proposal,decision,application,residual}=data;
  const p=summarizeBilateralPreview(proposal);
  const completed=proposal.completedSetoff;
  const active=enabled&&proposal.writable&&!proposal.staleCurrent;
  const approved=decision?.approvedBy.includes(me)??false;
  const finished=decision&&["rejected","revoked","expired","invalidated","superseded"].includes(decision.status);
  const canAgree=!completed&&!application&&p.canOffset&&active&&
    (!proposal.current||finished||decision?.canApprove||decision?.status==="agreed");
  const canReject=!completed&&active&&Boolean(decision?.canReject)&&!application;
  return <div className="space-y-3 border-t pt-3">
    {completed&&<p className="text-sm text-muted-foreground">
      Hoàn tất ngày {" "}
      {new Intl.DateTimeFormat("vi-VN",{day:"numeric",month:"numeric",year:"numeric"})
        .format(new Date(completed.appliedAt))}
    </p>}
    <div className="grid grid-cols-2 gap-2">
      <div className="rounded-xl bg-secondary/60 p-3">
        <p className="text-xs text-muted-foreground">{name(proposal.calculation.aOwesB.debtorId)} → {name(proposal.calculation.aOwesB.creditorId)}</p>
        <strong className="text-sm tabular-nums">{money(p.beforeAMinor)}</strong>
      </div>
      <div className="rounded-xl bg-secondary/60 p-3">
        <p className="text-xs text-muted-foreground">{name(proposal.calculation.bOwesA.debtorId)} → {name(proposal.calculation.bOwesA.creditorId)}</p>
        <strong className="text-sm tabular-nums">{money(p.beforeBMinor)}</strong>
      </div>
    </div>
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm">{completed?"Đã bù mỗi chiều":"Có thể bù mỗi chiều"}</p>
      <strong className="text-lg tabular-nums">{money(completed?.amountMinor??p.offsetMinor)}</strong>
    </div>
    {p.debtorId&&p.creditorId&&<div className="flex items-center justify-between gap-3 rounded-xl bg-secondary/60 p-3">
      <p className="text-sm">Còn {name(p.debtorId)} trả {name(p.creditorId)}</p>
      <strong className="text-base tabular-nums">{money(p.residualMinor)}</strong>
    </div>}
    {BigInt(p.pendingMinor)>0n&&<p className="text-sm text-amber-700 dark:text-amber-300">
      {money(p.pendingMinor)} đang chờ xác nhận ·
      {" "}<Link className="underline" href={"/groups/"+groupId+"/settlements"}>Xem</Link>
    </p>}
    {proposal.staleCurrent&&<p role="alert" className="text-sm text-destructive">
      Công nợ đã thay đổi. Tải lại để kiểm tra.
    </p>}
    {completed?null
      :approved&&decision?.status==="partially_approved"
        ?<p className="text-sm font-medium">Bạn đã đồng ý · Chờ {member.name}</p>
        :decision?.status==="agreed"
          ?<p className="text-sm font-medium">Đã đồng ý hai bên · Đang hoàn tất bù nợ</p>
          :finished?<p className="text-sm text-muted-foreground">Lần bù trước đã kết thúc</p>:null}
    {!completed&&!application&&<div className="flex flex-wrap gap-2">
      {canAgree&&<button type="button" disabled={saving}
        onClick={()=>void run("agree")}
        className="min-h-12 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
        {saving?"Đang xử lý…":decision?.status==="agreed"?"Hoàn tất bù nợ":"Đồng ý bù nợ"}
      </button>}
      {canReject&&<button type="button" disabled={saving}
        onClick={()=>void run("reject")}
        className="min-h-12 rounded-xl border px-4 text-sm font-medium disabled:opacity-50">
        Từ chối
      </button>}
    </div>}
    {residual?.preview.status==="ready"&&
      <button type="button" disabled={saving||!enabled||!residual.writable}
        onClick={()=>void run("residual")}
        className="min-h-12 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
        {residual.preview.debtorId===me?"Đã chuyển tiền":"Đã nhận tiền"}
        {" · "}{money(residual.preview.amountMinor)}
      </button>}
    {residual?.preview.status==="blocked"&&<p className="text-sm text-muted-foreground">
      {residual.preview.blockedReason??"Có khoản thanh toán đang chờ xác nhận."}
    </p>}
    {createdCash&&<p className="text-sm">
      Đang chờ bên kia xác nhận ·
      {" "}<Link className="underline" href={"/groups/"+groupId+"/settlements/"+createdCash}>
        Xem khoản trả
      </Link>
    </p>}
    {residual&&residual.history.length>0&&<Link
      className="inline-flex min-h-11 items-center text-sm underline"
      href={"/groups/"+groupId+"/settlements"}>Xem lịch sử trả tiền</Link>}
    <Link href={"/groups/"+groupId+"/cycles/"+cycleId+"?view=sources"}
      className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline underline-offset-4">
      Xem hóa đơn trong kỳ
    </Link>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}

function BilateralPairList({groupId,cycleId,me,counterparts,people,enabled}:{
  groupId:string;cycleId:string;me:string;counterparts:Member[];
  people:Member[];enabled:boolean;
}){
  const [cards,setCards]=useState<PairCard[]>([]);
  const [selected,setSelected]=useState<string|null>(null);
  const [quickOther,setQuickOther]=useState("");
  const [busy,setBusy]=useState(true);
  const [failed,setFailed]=useState(0);
  const [revision,setRevision]=useState(0);
  const name=(id:string)=>people.find(p=>p.id===id)?.name??"Thành viên";
  useEffect(()=>{
    const ctrl=new AbortController();
    let cursor=0,failures=0;
    const found:PairCard[]=[];
    async function scan(){
      while(cursor<counterparts.length&&!ctrl.signal.aborted){
        const member=counterparts[cursor++];
        const q=new URLSearchParams({partyAId:me,partyBId:member.id});
        try{
          const preview=await json<BilateralProposalPreview>(
            endpoint(groupId,cycleId)+"/bilateral-proposals?"+q,"GET",undefined,ctrl.signal);
          if(summarizeBilateralPreview(preview).show)found.push({member,preview});
        }catch{if(!ctrl.signal.aborted)failures++;}
      }
    }
    void Promise.all(Array.from({length:Math.min(4,counterparts.length)},()=>scan()))
      .then(()=>{
        if(ctrl.signal.aborted)return;
        found.sort((a,b)=>{
          // Keep unfinished pairs first, committed noncash entries afterwards.
          const aDone=Boolean(a.preview.completedSetoff),bDone=Boolean(b.preview.completedSetoff);
          if(aDone!==bDone)return aDone?1:-1;
          const aa=BigInt(a.preview.calculation.offsetMinor),
                bb=BigInt(b.preview.calculation.offsetMinor);
          return aa>bb?-1:aa<bb?1:a.member.name.localeCompare(b.member.name,"vi");
        });
        setCards(found);setFailed(failures);
      }).finally(()=>{if(!ctrl.signal.aborted)setBusy(false);});
    return ()=>ctrl.abort();
  },[groupId,cycleId,me,counterparts,revision]);
  const refresh=()=>{setBusy(true);setRevision(v=>v+1);};
  const visible=quickOther?cards.filter(x=>x.member.id===quickOther):cards;
  return <div className="space-y-3">
    <label htmlFor="cycle-pair-member" className="block text-sm font-medium">Chọn người</label>
    <select id="cycle-pair-member" value={quickOther}
      onChange={e=>{setQuickOther(e.target.value);setSelected(e.target.value||null);}}
      style={{height:"48px",minHeight:"48px"}}
      className="h-12 min-h-12 w-full rounded-xl border bg-background px-3 text-base">
      <option value="">Tất cả</option>
      {counterparts.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
    </select>
    {busy&&<p role="status" className="text-sm text-muted-foreground">Đang tải công nợ…</p>}
    {!busy&&failed>0&&<p role="alert" className="text-sm">
      Không tải được {failed} cặp. <button type="button" className="underline" onClick={refresh}>Thử lại</button>
    </p>}
    {!busy&&visible.length===0&&<p className="rounded-xl bg-secondary p-3 text-sm">
      {quickOther?"Không có khoản bù nợ khả dụng với người này.":"Chưa có khoản nợ hai chiều để bù."}
    </p>}
    {!busy&&visible.map(({member,preview})=>{
      const s=summarizeBilateralPreview(preview),other=member.id,open=selected===other;
      return <article key={other}
        className={"rounded-2xl border p-3 "+(s.hasCompletedSetoff?"bg-secondary/20":"bg-card")}>
        <button type="button" aria-expanded={open}
          aria-controls={"bilateral-pair-"+other}
          onClick={()=>setSelected(v=>v===other?null:other)}
          className="min-h-12 w-full space-y-1 text-left">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{name(me)} ↔ {member.name}</span>
            {s.hasCompletedSetoff&&<span aria-label="Đã bù nợ"
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              <span aria-hidden="true">✓</span> Đã bù
            </span>}
          </span>
          {s.hasCompletedSetoff&&s.appliedSetoffMinor&&<span className="block text-sm tabular-nums">
            Đã bù {money(s.appliedSetoffMinor)} mỗi chiều
          </span>}
          {!s.hasCompletedSetoff&&s.canOffset&&<span className="block text-base font-semibold tabular-nums">
            Bù {money(s.offsetMinor)} mỗi chiều
          </span>}
          {s.debtorId&&s.creditorId&&<span className="block text-sm text-muted-foreground">
            Còn {name(s.debtorId)} trả {name(s.creditorId)} · {money(s.residualMinor)}
          </span>}
          {BigInt(s.pendingMinor)>0n&&<span className="block text-xs text-amber-700 dark:text-amber-300">
            {money(s.pendingMinor)} đang chờ
          </span>}
          <span className="block text-xs font-medium text-primary">
            {open?"Thu gọn":s.hasCompletedSetoff?"Xem chi tiết":"Xem và xác nhận"}
          </span>
        </button>
        {open&&<div id={"bilateral-pair-"+other}>
          <PairDetail key={other} groupId={groupId} cycleId={cycleId}
            me={me} member={member} people={people} enabled={enabled} onUpdated={refresh}/>
        </div>}
      </article>;
    })}
  </div>;
}

function BatchCashPanel({groupId,cycleId,userId,people,enabled}:{
  groupId:string;cycleId:string;userId:string;people:Member[];enabled:boolean;
}){
  const router=useRouter(),url=endpoint(groupId,cycleId)+"/repayments";
  const [pairs,setPairs]=useState<BatchPairPreview[]>([]);
  const [loading,setLoading]=useState(true);
  const [sending,setSending]=useState<string|null>(null);
  const [error,setError]=useState("");
  const [created,setCreated]=useState<string|null>(null);
  const [revision,setRevision]=useState(0);
  const key=useRef<{pair:string;id:string}|null>(null);
  const name=(id:string)=>people.find(p=>p.id===id)?.name??"Thành viên";
  useEffect(()=>{
    const ctrl=new AbortController();
    void json<{pairs:BatchPairPreview[]}>(url,"GET",undefined,ctrl.signal)
      .then(x=>{if(!ctrl.signal.aborted){setPairs(x.pairs.filter(p=>
        p.debtorId===userId||p.creditorId===userId));setError("");}})
      .catch(e=>{if(!ctrl.signal.aborted)
        setError(e instanceof Error?e.message:"Không thể tải khoản nợ.");})
      .finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
    return ()=>ctrl.abort();
  },[url,userId,revision]);
  const pay=async(p:BatchPairPreview)=>{
    const pair=p.debtorId+":"+p.creditorId+":"+p.fingerprint;
    if(sending)return;
    if(key.current?.pair!==pair)key.current={pair,id:crypto.randomUUID()};
    setSending(pair);setError("");
    try{
      const result=await json<{id:string}>(url,"POST",{
        expectedCycleVersion:3,requestKey:key.current.id,
        debtorId:p.debtorId,creditorId:p.creditorId,
        expectedFingerprint:p.fingerprint,
      });
      setCreated(result.id);key.current=null;setLoading(true);setRevision(x=>x+1);
      router.refresh();
    }catch(e){
      if(e&&typeof e==="object"&&"status" in e&&e.status===409){
        key.current=null;setLoading(true);setRevision(x=>x+1);
      }
      setError(e instanceof Error?e.message:"Không tạo được khoản trả.");
    }finally{setSending(null);}
  };
  return <section className="space-y-3 rounded-3xl border bg-card p-4">
    <h2 className="text-base font-semibold">Trả tiền</h2>
    {created&&<p role="status" className="rounded-xl bg-secondary p-3 text-sm">
      Chờ người kia xác nhận ·
      {" "}<Link href={"/groups/"+groupId+"/settlements/"+created}
        className="underline">Xem khoản trả</Link>
    </p>}
    {loading&&<p role="status" className="text-sm text-muted-foreground">Đang tải…</p>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {!loading&&pairs.length===0&&<p className="text-sm text-muted-foreground">
      Không còn khoản khả dụng để trả.
    </p>}
    {!loading&&pairs.map(p=>{
      const copy=cashActionCopy(p.debtorId,p.creditorId,userId);
      const opposite=pairs.some(q=>q.debtorId===p.creditorId&&q.creditorId===p.debtorId);
      return <article key={p.debtorId+":"+p.creditorId} className="space-y-2 rounded-2xl border p-3">
        <p className="font-semibold">{name(p.debtorId)} → {name(p.creditorId)}</p>
        <strong className="block text-xl tabular-nums">{money(p.availableMinor)}</strong>
        <p className="text-xs text-muted-foreground">{p.allocationCount} khoản</p>
        {BigInt(p.pendingMinor)>0n&&<p className="text-xs text-amber-700 dark:text-amber-300">
          Đang chờ: {money(p.pendingMinor)}
        </p>}
        {opposite&&<Link className="block text-sm underline"
          href={"/groups/"+groupId+"/cycles/"+cycleId+"?view=settle"}>Bù nợ trước</Link>}
        <button type="button" disabled={!enabled||Boolean(sending)}
          onClick={()=>void pay(p)}
          className="min-h-12 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {sending?"Đang xử lý…":copy.label}
        </button>
      </article>;
    })}
    <Link href={"/groups/"+groupId+"/settlements"}
      className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
      Lịch sử và khoản đang chờ
    </Link>
  </section>;
}
export function SettlementCycleFinancePanel({groupId,cycleId,
  currentUserId,currentUserName,counterparts,requestedEnabled,
  bilateralEnabled,financialEngineEnabled,mode="bilateral"}:{
  groupId:string;cycleId:string;currentUserId:string;currentUserName:string;
  counterparts:Member[];requestedEnabled:boolean;bilateralEnabled:boolean;
  financialEngineEnabled:boolean;mode?:"bilateral"|"cash";
}){
  const people=[{id:currentUserId,name:currentUserName},...counterparts];
  const financeReady=financialEngineEnabled&&requestedEnabled;
  return <div className="space-y-3">
    {!requestedEnabled&&<p className="rounded-xl bg-secondary p-3 text-sm">Nhóm chưa bật quyết toán.</p>}
    {mode==="bilateral"&&!bilateralEnabled&&<p className="rounded-xl bg-secondary p-3 text-sm">
      Nhóm chưa bật bù nợ.
    </p>}
    {mode==="bilateral"&&bilateralEnabled&&counterparts.length>0&&
      <BilateralPairList groupId={groupId} cycleId={cycleId} me={currentUserId}
        counterparts={counterparts} people={people} enabled={financeReady&&bilateralEnabled}/>}
    {mode==="bilateral"&&bilateralEnabled&&counterparts.length===0&&
      <p className="rounded-xl bg-secondary p-3 text-sm">Chưa có người để bù nợ.</p>}
    {mode==="cash"&&requestedEnabled&&<BatchCashPanel groupId={groupId}
      cycleId={cycleId} userId={currentUserId} people={people} enabled={financeReady}/>}
  </div>;
}
