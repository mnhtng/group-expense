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
  amountMinor:string;initiatedBy:string;createdAt:string;resolvedAt:string|null};
type ResidualResponse={preview:ResidualPreview;history:Attempt[];writable:boolean};
type PairState={proposal:BilateralProposalPreview;
  decision:DecisionView|null;application:AppliedNoncashDocument|null;
  residual:ResidualResponse|null;};
type Command="proposal"|"approve"|"reject"|"revoke"|"apply"|"residual"|"batch";
const money=(s:string)=>new Intl.NumberFormat("vi-VN").format(BigInt(s))+" ₫";
const when=(s:string)=>new Date(s).toLocaleString("vi-VN");
const status:Record<string,string>={
  pending:"Chưa có xác nhận",partially_approved:"Một bên đã đồng ý",
  agreed:"Cả hai đã đồng ý",rejected:"Đã từ chối",
  revoked:"Đã thu hồi",invalidated:"Công nợ đã thay đổi",
  expired:"Đề xuất đã hết hạn",superseded:"Đã có phiên bản mới",
};
const commandName:Record<Command,string>={
  proposal:"Gửi đề xuất bù nợ",approve:"Đồng ý bù nợ",
  reject:"Từ chối đề xuất",revoke:"Thu hồi đồng ý",
  apply:"Bù nợ ngay",residual:"Yêu cầu trả phần còn lại",
  batch:"Yêu cầu thanh toán",
};
const explain:Record<Command,string>={
  proposal:"Gửi cho người này để cùng xác nhận.",
  approve:"Đồng ý đúng số tiền đang hiển thị.",
  reject:"Từ chối đề xuất này.",
  revoke:"Rút lại đồng ý của bạn.",
  apply:"Giảm nợ hai chiều. Không chuyển tiền.",
  residual:"Gửi yêu cầu, chờ người kia xác nhận.",
  batch:"Ghi nhận tiền đã trao ngoài ứng dụng; bên kia phải xác nhận trước khi công nợ giảm.",
};

async function getJson<T>(url:string,signal?:AbortSignal):Promise<T>{
  const response=await fetch(url,{credentials:"same-origin",cache:"no-store",signal});
  const body:unknown=await response.json().catch(()=>null);
  if(!response.ok)throw Error(
    body&&typeof body==="object"&&"error" in body&&
    typeof (body as {error?:unknown}).error==="string"
      ? String((body as {error:string}).error)
      : `Không tải được dữ liệu (HTTP ${response.status}).`);
  return body as T;
}
async function postJson(url:string,data:Record<string,unknown>):Promise<void>{
  const response=await fetch(url,{method:"POST",credentials:"same-origin",
    cache:"no-store",headers:{"content-type":"application/json"},
    body:JSON.stringify(data)});
  const body:unknown=await response.json().catch(()=>null);
  if(!response.ok){
    const error=body&&typeof body==="object"&&"error" in body&&
      typeof (body as {error?:unknown}).error==="string"
      ? String((body as {error:string}).error)
      : `Thao tác bị từ chối (HTTP ${response.status}).`;
    throw Object.assign(Error(error),{status:response.status});
  }
}
function Consent({kind,checked,onChange,onConfirm,onCancel,busy,title,description}:{
  kind:Command;checked:boolean;onChange:(v:boolean)=>void;
  onConfirm:()=>void;onCancel:()=>void;busy:boolean;
  title?:string;description?:string;
}){
  return <div role="group" aria-label={title??commandName[kind]}
    className="space-y-3 rounded-2xl border bg-secondary/60 p-4">
    <strong className="block text-sm">{title??commandName[kind]}</strong>
    <p className="text-sm text-muted-foreground">{description??explain[kind]}</p>
    <label className="flex min-h-11 items-start gap-3 text-sm">
      <input type="checkbox" checked={checked} disabled={busy}
        onChange={e=>onChange(e.target.checked)}
        className="mt-1 size-5 shrink-0 accent-primary"/>
      <span>Tôi đã kiểm tra người và số tiền.</span>
    </label>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={!checked||busy}
        onClick={onConfirm}
        className="min-h-12 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
        {busy?"Đang xử lý...":"Xác nhận thao tác"}
      </button>
      <button type="button" disabled={busy} onClick={onCancel}
        className="min-h-12 rounded-xl border px-4 text-sm">Hủy</button>
    </div>
  </div>;
}
function DisabledAction({kind,canUse,onClick,label}:{
  kind:Command;canUse:boolean;onClick:()=>void;label?:string;
}){
  return <button type="button" disabled={!canUse} onClick={onClick}
    aria-label={label??commandName[kind]} title={!canUse?"Nhóm chưa mở quyết toán":undefined}
    className="min-h-12 w-full rounded-xl border px-3 py-2 text-sm font-semibold text-left disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
    {label??commandName[kind]}
  </button>;
}

function BilateralWorkbench({groupId,cycleId,me,other,people,enabled,onUpdated}:{
  groupId:string;cycleId:string;me:string;other:string;
  people:Member[];enabled:boolean;onUpdated?:()=>void;
}){
  const router=useRouter();
  const pairUrl=`/api/groups/${groupId}/settlement-cycle/cycles/${cycleId}`;
  const proposalApi=`${pairUrl}/bilateral-proposals`;
  const [state,setState]=useState<PairState|null>(null);
  const [busy,setBusy]=useState(true);
  const [sending,setSending]=useState(false);
  const [error,setError]=useState("");
  const [info,setInfo]=useState("");
  const [revision,setRevision]=useState(0);
  const [intent,setIntent]=useState<Command|null>(null);
  const [accepted,setAccepted]=useState(false);
  const [showSources,setShowSources]=useState(false);
  const keyRef=useRef<{digest:string;key:string}|null>(null);
  const name=(id:string)=>people.find(p=>p.id===id)?.name??"Thành viên";
  useEffect(()=>{
    const ctrl=new AbortController();
    async function load(){
      try{
        const q=new URLSearchParams({partyAId:me,partyBId:other});
        const proposal=await getJson<BilateralProposalPreview>(
          `${proposalApi}?${q}`,ctrl.signal);
        let decision:DecisionView|null=null;
        let application:AppliedNoncashDocument|null=null;
        let residual:ResidualResponse|null=null;
        if(proposal.current){
          const doc=`${proposalApi}/${proposal.current.id}`;
          decision=await getJson<DecisionView>(`${doc}/decisions`,ctrl.signal);
          const applied=await getJson<{application:AppliedNoncashDocument|null}>(
            `${doc}/applications`,ctrl.signal);
          application=applied.application;
          if(application){
            residual=await getJson<ResidualResponse>(
              `${pairUrl}/bilateral-applications/${application.id}/residual`,ctrl.signal);
          }
        }
        if(!ctrl.signal.aborted){setState({proposal,decision,application,residual});setError("");}
      }catch(e){
        if(!ctrl.signal.aborted){setState(null);setError(e instanceof Error?e.message:"Không đọc được công nợ.");}
      }finally{if(!ctrl.signal.aborted)setBusy(false);}
    }
    void load();
    return ()=>ctrl.abort();
  },[me,other,proposalApi,pairUrl,revision]);
  const actionAllowed=enabled&&state?.proposal.writable===true;
  const live=state?.proposal;
  const doc=live?.current;
  const decision=state?.decision;
  const app=state?.application;
  const residual=state?.residual;
  const summary=live?summarizeBilateralPreview(live):null;
  const refresh=()=>{
    setBusy(true);setState(null);setIntent(null);setAccepted(false);
    setRevision(x=>x+1);
  };
  const begin=(next:Command)=>{
    if(!actionAllowed||sending)return;
    keyRef.current=null;setAccepted(false);setIntent(next);
  };
  const submit=async()=>{
    if(!intent||!accepted||!state||!actionAllowed||sending)return;
    let url=proposalApi;
    let payload:Record<string,unknown>;
    const current=state.proposal.current;
    if(intent==="proposal"){
      payload={partyAId:me,partyBId:other,
        expectedVersion:state.proposal.currentVersion,
        expectedFingerprint:state.proposal.fingerprint};
    }else if(intent==="apply"&&current&&decision){
      url=`${proposalApi}/${current.id}/applications`;
      payload={expectedVersion:current.version,
        expectedFingerprint:current.sourceFingerprint};
    }else if(intent==="residual"&&app&&residual){
      url=`${pairUrl}/bilateral-applications/${app.id}/residual`;
      payload={expectedCycleVersion:3,
        expectedFingerprint:residual.preview.fingerprint};
    }else if(current&&decision&&["approve","reject","revoke"].includes(intent)){
      url=`${proposalApi}/${current.id}/decisions`;
      payload={action:intent,expectedVersion:current.version,
        expectedFingerprint:current.sourceFingerprint};
    }else{return;}
    const digest=JSON.stringify([url,payload,intent]);
    if(keyRef.current?.digest!==digest)
      keyRef.current={digest,key:crypto.randomUUID()};
    setSending(true);setError("");setInfo("");
    try{
      await postJson(url,{...payload,requestKey:keyRef.current.key});
      keyRef.current=null;
      setInfo("Đã ghi nhận yêu cầu. Đang cập nhật dữ liệu mới nhất.");
      refresh();
      onUpdated?.();
      if(intent==="apply"||intent==="residual")router.refresh();
    }catch(e){
      if(e&&typeof e==="object"&&"status" in e&&e.status===409){
        keyRef.current=null;refresh();
      }
      setError(e instanceof Error?e.message:"Không thể thực hiện yêu cầu.");
    }finally{setSending(false);}
  };
  return <div className="space-y-4">
    {busy&&<p role="status" className="text-sm text-muted-foreground">Đang tải công nợ hai bên…</p>}
    {error&&<p role="alert" className="rounded-xl bg-secondary p-3 text-sm text-destructive">
      {error} <button type="button" onClick={refresh}
        className="ml-2 min-h-11 underline">Tải lại</button>
    </p>}
    {info&&<p role="status" className="text-sm">{info}</p>}
    {live&&!busy&&<>
      {live.staleCurrent&&<p role="alert" className="rounded-xl border p-3 text-sm">
        Công nợ đã thay đổi từ lúc lập đề xuất. Cần kiểm tra và lập phiên bản mới.
      </p>}
      <section aria-label="Dự tính trước và sau bù nợ" className="space-y-3 rounded-2xl border p-4">
        <h3 className="text-sm font-semibold">Trước khi bù · Số dư khả dụng</h3>
        <div className="grid grid-cols-2 gap-2">
          {[
            [live.calculation.aOwesB,summary?.beforeAMinor??"0"],
            [live.calculation.bOwesA,summary?.beforeBMinor??"0"],
          ].map(([direction,amount])=><div key={(direction as typeof live.calculation.aOwesB).debtorId}
            className="rounded-xl bg-secondary/60 p-3">
            <p className="text-xs text-muted-foreground">
              {name((direction as typeof live.calculation.aOwesB).debtorId)}
              {" → "}{name((direction as typeof live.calculation.aOwesB).creditorId)}
            </p>
            <p className="mt-1 font-semibold tabular-nums">
              {money(amount as string)}
            </p>
          </div>)}
        </div>
        <div className="rounded-xl bg-secondary/60 p-3">
          <p className="text-xs text-muted-foreground">Có thể bù nợ (mỗi chiều)</p>
          <strong className="block break-all text-2xl tabular-nums">{money(live.calculation.offsetMinor)}</strong>
          <p className="text-xs text-muted-foreground">Không chuyển tiền khi bù nợ.</p>
        </div>
        <h3 className="text-sm font-semibold">Sau khi bù · Dự kiến</h3>
        <div className="grid grid-cols-2 gap-2">
          {[
            [live.calculation.aOwesB,summary?.afterAMinor??"0"],
            [live.calculation.bOwesA,summary?.afterBMinor??"0"],
          ].map(([direction,amount])=><div key={(direction as typeof live.calculation.aOwesB).debtorId}
            className="rounded-xl border p-3">
            <p className="text-xs text-muted-foreground">
              {name((direction as typeof live.calculation.aOwesB).debtorId)}
              {" → "}{name((direction as typeof live.calculation.aOwesB).creditorId)}
            </p>
            <p className="mt-1 font-semibold tabular-nums">{money(amount as string)}</p>
          </div>)}
        </div>
        {summary&&summary.debtorId&&summary.creditorId&&<p className="text-sm font-semibold">
          Chênh lệch còn lại: {name(summary.debtorId)} → {name(summary.creditorId)}
          {" · "}{money(summary.residualMinor)}
        </p>}
        <p className="text-xs text-muted-foreground">
          Đây là dự kiến trên số dư khả dụng; công nợ chưa giảm cho tới khi cả hai
          đồng ý và có bút toán bù nợ được áp dụng.
        </p>
      </section>
      {summary&&BigInt(summary.pendingMinor)>0n&&<aside role="note"
        className="space-y-2 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
        <p className="font-semibold">Đang chờ xác nhận: {money(summary.pendingMinor)}</p>
        <p className="text-muted-foreground">
          Tiền đang chờ được giữ riêng, chưa được tính là đã thanh toán và không
          thể dùng để bù nợ. Hãy xác nhận, từ chối hoặc hủy yêu cầu liên quan để
          tính lại công nợ khả dụng.
        </p>
        <Link href={`/groups/${groupId}/settlements`} className="underline underline-offset-4">
          Xem các yêu cầu chờ xác nhận
        </Link>
      </aside>}
      <div className="rounded-2xl border p-3">
        <button type="button" aria-expanded={showSources}
          aria-controls="cycle-noncash-source-lines"
          onClick={()=>setShowSources(v=>!v)}
          className="min-h-11 w-full py-2 text-left text-sm font-semibold">
          {showSources?"Ẩn khoản nợ gốc":"Xem các khoản bù nợ"}
        </button>
        {showSources&&<div id="cycle-noncash-source-lines" className="space-y-3 pt-3">
          {[
            ["Chiều 1",live.calculation.aOwesB.allocations],
            ["Chiều 2",live.calculation.bOwesA.allocations],
          ].map(([label,items])=><div key={label as string}>
            <h4 className="text-xs font-semibold">{label as string}</h4>
            {(items as typeof live.calculation.aOwesB.allocations).map(line=>
              <p key={line.obligationId}
                className="space-y-1 border-b py-2 text-xs">
                <span className="block break-all"><code>{line.obligationId}</code></span>
                <span className="block">{line.occurredOn} · Bù nợ dự kiến {money(line.setoffMinor)}</span>
                <span className="block text-muted-foreground">Còn khả dụng: {money(line.availableAfterMinor)}</span>
              </p>)}
            {(items as typeof live.calculation.aOwesB.allocations).length===0&&
              <p className="text-xs text-muted-foreground">Không có khoản nợ đủ điều kiện.</p>}
          </div>)}
        </div>}
      </div>
      {doc&&<div className="space-y-3 rounded-2xl border p-4">
        <h3 className="font-semibold">Đề xuất hiện tại · phiên bản {doc.version}</h3>
        <p className="text-sm">Bù nợ: <strong className="tabular-nums">{money(doc.offsetMinor)}</strong> mỗi chiều</p>
        <p className="text-xs text-muted-foreground">
          Lập lúc {when(doc.createdAt)} · {name(doc.createdBy)}
        </p>
        {decision&&<>
          <span className="inline-flex rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold">
            {status[decision.status]??decision.status}
          </span>
          <p className="text-sm">Đã đồng ý: {decision.approvedBy.length}/2</p>
          <div className="space-y-1 text-xs text-muted-foreground">
            {decision.approvedBy.map(id=><p key={id}>✓ {name(id)} đã đồng ý</p>)}
            <p>Hết hiệu lực lúc {when(decision.expiresAt)}</p>
            {!decision.liveMatches&&<p role="alert">Dữ liệu đã thay đổi; không dùng đề xuất cũ.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {decision.canApprove&&<DisabledAction kind="approve" canUse={!!actionAllowed&&!live.staleCurrent}
              onClick={()=>begin("approve")}/>}
            {decision.canReject&&<DisabledAction kind="reject" canUse={!!actionAllowed}
              onClick={()=>begin("reject")}/>}
            {decision.canRevoke&&<DisabledAction kind="revoke" canUse={!!actionAllowed}
              onClick={()=>begin("revoke")}/>}
            {decision.status==="agreed"&&!app&&<DisabledAction kind="apply"
              canUse={!!actionAllowed&&decision.readyForApplication}
              onClick={()=>begin("apply")}/>}
          </div>
        </>}
      </div>}
      {app&&<div className="space-y-2 rounded-2xl border p-4">
        <h3 className="font-semibold">Đã bù nợ</h3>
        <p className="text-xl font-semibold tabular-nums">{money(app.offsetMinor)} mỗi chiều</p>
        <p className="text-sm text-muted-foreground">
          Tiền đã chuyển:
          {" "}<strong>{money(app.cashTransferredMinor)}</strong>.
        </p>
        <p className="text-xs text-muted-foreground">
          {when(app.appliedAt)} · Người áp dụng: {name(app.appliedBy)} ·
          Chứng từ <code className="break-all">{app.id}</code>
        </p>
      </div>}
      {residual&&<div className="space-y-2 rounded-2xl border p-4">
        <h3 className="font-semibold">Còn phải trả</h3>
        <p className="text-xl font-semibold tabular-nums">{money(residual.preview.amountMinor)}</p>
        {residual.preview.debtorId&&residual.preview.creditorId&&
          <p className="text-sm">{name(residual.preview.debtorId)} cần trả
            {" "}{name(residual.preview.creditorId)}</p>}
        <p className="text-sm text-muted-foreground">
          {residual.preview.status==="settled"?"Hết nợ.":
            residual.preview.blockedReason??"Chờ người kia xác nhận sau khi trả tiền."}
        </p>
        {residual.preview.status==="ready"&&<DisabledAction kind="residual"
          canUse={!!actionAllowed&&residual.writable}
          onClick={()=>begin("residual")}/>}
        {residual.history.length>0&&<div className="space-y-2 border-t pt-3">
          <h4 className="text-sm font-medium">Lịch sử yêu cầu tiền</h4>
          {residual.history.map(h=><Link key={h.id}
            href={`/groups/${groupId}/settlements/${h.id}`}
            className="flex min-h-12 items-center justify-between gap-2 rounded-xl border p-3 text-sm">
            <span>{h.status==="confirmed"?"Đã xác nhận":h.status==="pending"?"Đang chờ xác nhận":
              h.status==="rejected"?"Đã từ chối":"Đã hủy"}</span>
            <strong className="tabular-nums">{money(h.amountMinor)}</strong>
          </Link>)}
        </div>}
      </div>}
      {!app&&live.calculation.hasOffset&&(!doc||live.staleCurrent||
        (decision&&["rejected","revoked","invalidated","expired","superseded"].includes(decision.status)))&&<DisabledAction kind="proposal"
        canUse={!!actionAllowed} onClick={()=>begin("proposal")}/>}
      {!live.calculation.hasOffset&&!doc&&<p className="rounded-xl bg-secondary p-3 text-sm">
        Không có khoản nợ hai chiều để bù.
      </p>}
      {intent&&<Consent kind={intent} checked={accepted} onChange={setAccepted}
        busy={sending} onConfirm={()=>void submit()}
        onCancel={()=>{setIntent(null);setAccepted(false);}}/>}
      {!enabled&&<p role="note" className="text-xs text-muted-foreground">
        Quyết toán chưa mở cho nhóm.
      </p>}
    </>}
  </div>;
}

type BilateralPairCard={
  member:Member;
  summary:ReturnType<typeof summarizeBilateralPreview>;
};

/** Read-only discovery for every counterparty, not merely the first member.
 * At most four concurrent existing pair-authorized GETs; no financial write
 * and no assumptions about another user's obligations.
 */
function BilateralPairList({groupId,cycleId,me,counterparts,people,enabled}:{
  groupId:string;cycleId:string;me:string;counterparts:Member[];
  people:Member[];enabled:boolean;
}){
  const [cards,setCards]=useState<BilateralPairCard[]>([]);
  const [selected,setSelected]=useState<string|null>(null);
  const [quickOther,setQuickOther]=useState("");
  const [busy,setBusy]=useState(true);
  const [failed,setFailed]=useState(0);
  const [revision,setRevision]=useState(0);
  const name=(id:string)=>people.find(p=>p.id===id)?.name??"Thành viên";
  useEffect(()=>{
    const ctrl=new AbortController();
    let cursor=0,failures=0;
    const found:BilateralPairCard[]=[];
    const scan=async()=>{
      while(cursor<counterparts.length&&!ctrl.signal.aborted){
        const member=counterparts[cursor++];
        const query=new URLSearchParams({partyAId:me,partyBId:member.id});
        try{
          const preview=await getJson<BilateralProposalPreview>(
            `/api/groups/${groupId}/settlement-cycle/cycles/${cycleId}/bilateral-proposals?${query}`,
            ctrl.signal);
          const summary=summarizeBilateralPreview(preview);
          if(summary.show)found.push({member,summary});
        }catch{
          if(!ctrl.signal.aborted)failures++;
        }
      }
    };
    setBusy(true);
    void Promise.all(Array.from({length:Math.min(4,counterparts.length)},()=>scan()))
      .then(()=>{
        if(ctrl.signal.aborted)return;
        found.sort((a,b)=>{
          const aa=BigInt(a.summary.offsetMinor),bb=BigInt(b.summary.offsetMinor);
          return aa>bb?-1:aa<bb?1:a.member.name.localeCompare(b.member.name,"vi");
        });
        setCards(found);setFailed(failures);
      }).finally(()=>{if(!ctrl.signal.aborted)setBusy(false);});
    return ()=>ctrl.abort();
  },[groupId,cycleId,me,counterparts,revision]);
  const eligible=cards.filter(c=>c.summary.canOffset).length;
  return <div className="space-y-3">
    <label className="block space-y-2 text-sm font-semibold" htmlFor="cycle-pair-member">
      Chọn người
    </label>
    <select id="cycle-pair-member" value={quickOther}
      onChange={e=>{setQuickOther(e.target.value);setSelected(null);}}
      style={{height:"48px",minHeight:"48px"}}
      className="h-12 min-h-12 w-full rounded-xl border bg-background px-3 text-base">
      <option value="">Tất cả cặp có thể bù</option>
      {counterparts.map(member=><option key={member.id} value={member.id}>
        {member.name}
      </option>)}
    </select>
    {quickOther&&<div className="space-y-2 rounded-2xl border p-3">
      <button type="button" className="min-h-11 text-sm underline underline-offset-4"
        onClick={()=>setQuickOther("")}>Xem tất cả cặp</button>
      {(()=>{
        const other=quickOther;
        return <BilateralWorkbench key={other} groupId={groupId} cycleId={cycleId}
          me={me} other={other} people={people} enabled={enabled}
          onUpdated={()=>setRevision(x=>x+1)}/>;
      })()}
    </div>}
    {!quickOther&&busy&&<p role="status" className="text-sm text-muted-foreground">
      Đang kiểm tra các cặp công nợ trong kỳ…
    </p>}
    {!quickOther&&!busy&&<p className="text-sm text-muted-foreground">
      {eligible} cặp có thể bù · Chọn một cặp để xem chi tiết và xác nhận hai chiều.
    </p>}
    {!quickOther&&!busy&&failed>0&&<div role="alert" className="space-y-2 rounded-xl border p-3 text-sm">
      <p>Không tải được {failed} cặp. Danh sách có thể chưa đầy đủ.</p>
      <button type="button" className="min-h-11 underline"
        onClick={()=>setRevision(x=>x+1)}>Thử tải lại</button>
    </div>}
    {!quickOther&&!busy&&cards.length===0&&failed===0&&<p className="rounded-xl bg-secondary p-3 text-sm">
      Không có cặp nợ hai chiều khả dụng hoặc yêu cầu bù nợ cần theo dõi trong kỳ này.
    </p>}
    {!quickOther&&cards.map(({member,summary})=>{
      const other=member.id;
      const open=selected===other;
      return <article key={other} className="rounded-2xl border p-3">
        <button type="button" aria-expanded={open}
          aria-controls={`bilateral-pair-${other}`}
          onClick={()=>setSelected(v=>v===other?null:other)}
          className="w-full space-y-2 rounded-xl p-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2">
          <span className="block font-semibold">{name(me)} ↔ {member.name}</span>
          <span className="block text-sm">
            {summary.canOffset?`Có thể bù mỗi chiều: ${money(summary.offsetMinor)}`
              :"Chưa có tiền khả dụng để bù"}
          </span>
          {summary.debtorId&&summary.creditorId&&<span className="block text-sm text-muted-foreground">
            Sau bù (dự kiến): {name(summary.debtorId)} → {name(summary.creditorId)}
            {" · "}{money(summary.residualMinor)}
          </span>}
          {BigInt(summary.pendingMinor)>0n&&<span className="block text-sm text-amber-700 dark:text-amber-300">
            Đang chờ xác nhận: {money(summary.pendingMinor)} · không thể bù phần này
          </span>}
          <span className="block text-sm font-medium underline underline-offset-4">
            {open?"Thu gọn":"Xem chi tiết bù nợ"}
          </span>
        </button>
        {open&&<div id={`bilateral-pair-${other}`} className="mt-3 border-t pt-3">
          <BilateralWorkbench key={other} groupId={groupId} cycleId={cycleId}
            me={me} other={other} people={people} enabled={enabled}
            onUpdated={()=>setRevision(x=>x+1)}/>
        </div>}
      </article>;
    })}
  </div>;
}

function BatchCashPanel({groupId,cycleId,userId,people,enabled}:{
  groupId:string;cycleId:string;userId:string;people:Member[];enabled:boolean;
}){
  const router=useRouter();
  const url=`/api/groups/${groupId}/settlement-cycle/cycles/${cycleId}/repayments`;
  const [pairs,setPairs]=useState<BatchPairPreview[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [selected,setSelected]=useState<BatchPairPreview|null>(null);
  const [accepted,setAccepted]=useState(false);
  const [sending,setSending]=useState(false);
  const [revision,setRevision]=useState(0);
  const key=useRef<string|null>(null);
  const name=(id:string)=>people.find(p=>p.id===id)?.name??"Thành viên";
  useEffect(()=>{
    const abort=new AbortController();
    void getJson<{pairs:BatchPairPreview[]}>(url,abort.signal)
      .then(x=>{if(!abort.signal.aborted){setPairs(x.pairs.filter(p=>
        p.debtorId===userId||p.creditorId===userId));setError("");}})
      .catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:"Lỗi tải thanh toán gộp.");})
      .finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return ()=>abort.abort();
  },[url,userId,revision]);
  async function submit(){
    if(!enabled||!selected||!accepted||sending)return;
    if(!key.current)key.current=crypto.randomUUID();
    setSending(true);setError("");
    try{
      await postJson(url,{expectedCycleVersion:3,requestKey:key.current,
        debtorId:selected.debtorId,creditorId:selected.creditorId,
        expectedFingerprint:selected.fingerprint});
      key.current=null;setSelected(null);setAccepted(false);
      setLoading(true);setRevision(x=>x+1);
      router.refresh();
    }catch(e){
      if(e&&typeof e==="object"&&"status" in e&&e.status===409){
        key.current=null;setSelected(null);setLoading(true);setRevision(x=>x+1);
      }
      setError(e instanceof Error?e.message:"Không tạo được yêu cầu.");
    }finally{setSending(false);}
  }
  return <section className="space-y-3 rounded-3xl border bg-card p-4 sm:p-5">
    <h3 className="text-base font-semibold">Yêu cầu thanh toán</h3>
    <p className="text-sm text-muted-foreground">
      Mỗi yêu cầu ghi nhận một hoặc nhiều khoản nợ cùng chiều. Tiền được trao ngoài
      ứng dụng; chỉ giảm công nợ khi người còn lại xác nhận.
    </p>
    {loading&&<p role="status" className="text-sm">Đang tải yêu cầu thanh toán…</p>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {!loading&&pairs.length===0&&<p className="text-sm text-muted-foreground">
      Không có khoản khả dụng để yêu cầu thanh toán trong kỳ này.
    </p>}
    {!loading&&pairs.map(p=>{
      const copy=cashActionCopy(p.debtorId,p.creditorId,userId);
      const opposite=pairs.some(other=>other.debtorId===p.creditorId&&
        other.creditorId===p.debtorId);
      return <article key={p.debtorId+"-"+p.creditorId}
        className="space-y-2 rounded-2xl border p-3">
        <p className="text-sm font-medium">{name(p.debtorId)} → {name(p.creditorId)}</p>
        <p className="text-xs text-muted-foreground">{copy.relation}</p>
        <strong className="block text-lg tabular-nums">{money(p.availableMinor)}</strong>
        <p className="text-xs text-muted-foreground">
          {p.allocationCount} khoản nợ nguồn · Số tiền khả dụng
        </p>
        <Link href={`/groups/${groupId}/cycles/${cycleId}?view=sources`}
          className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
          Xem các khoản nợ nguồn
        </Link>
        {BigInt(p.pendingMinor)>0n&&<aside role="note"
          className="space-y-2 rounded-xl bg-amber-500/5 p-3 text-sm">
          <p className="font-semibold">Tiền đang chờ xác nhận: {money(p.pendingMinor)}</p>
          <p className="text-muted-foreground">
            Khoản đang chờ không được tính là đã trả và không thể dùng để bù nợ.
            Hãy xử lý yêu cầu cũ trước khi tạo yêu cầu mới cho phần tiền đó.
          </p>
          <Link href={`/groups/${groupId}/settlements`} className="underline underline-offset-4">
            Xem yêu cầu đang chờ
          </Link>
        </aside>}
        {opposite&&<p className="text-sm text-muted-foreground">
          Hai người có nợ ngược chiều. Nên{" "}
          <Link className="underline underline-offset-4"
            href={`/groups/${groupId}/cycles/${cycleId}?view=settle`}>
            bù nợ trước
          </Link>{" "}để giảm số lần chuyển tiền.
        </p>}
        <DisabledAction kind="batch" canUse={enabled} label={copy.label}
          onClick={()=>{key.current=null;setAccepted(false);setSelected(p);}}/>
      </article>;
    })}
    {selected&&<div className="space-y-2">
      <p className="text-sm font-semibold">
        {name(selected.debtorId)} → {name(selected.creditorId)}
        {" · "}{money(selected.availableMinor)}
      </p>
      <p className="text-sm text-muted-foreground">
        Áp dụng cho toàn bộ {selected.allocationCount} khoản nợ nguồn hiện còn khả dụng.
      </p>
      <Consent kind="batch" checked={accepted} onChange={setAccepted}
        title={cashActionCopy(selected.debtorId,selected.creditorId,userId).label}
        description={cashActionCopy(selected.debtorId,selected.creditorId,userId).explanation}
        busy={sending} onConfirm={()=>void submit()}
        onCancel={()=>{setSelected(null);setAccepted(false);}}/>
    </div>}
  </section>;
}

/** financialEngineEnabled is a server-derived, per-group rollout decision.
 * The UI cannot grant financial authority through a client-side opt-in.
 */
export function SettlementCycleFinancePanel({groupId,cycleId,
  currentUserId,currentUserName,counterparts,requestedEnabled,
  bilateralEnabled,financialEngineEnabled,mode="bilateral"}:{
  groupId:string;cycleId:string;currentUserId:string;currentUserName:string;
  counterparts:Member[];requestedEnabled:boolean;bilateralEnabled:boolean;
  financialEngineEnabled:boolean;mode?:"bilateral"|"cash";
}){
  const people=[{id:currentUserId,name:currentUserName},...counterparts];
  const financeReady=financialEngineEnabled&&requestedEnabled;
  return <section aria-labelledby="bilateral-cycle-heading"
    className="space-y-4 rounded-3xl border bg-card p-4 sm:p-5">
    <header className="space-y-2">
      <h2 id="bilateral-cycle-heading" className="text-lg font-semibold">
        {mode==="cash"?"Trả tiền":"Bù nợ hai người"}
      </h2>

    </header>
    {!requestedEnabled&&<p className="rounded-xl bg-secondary p-3 text-sm">
      Nhóm chưa bật quyết toán.
    </p>}
    {mode==="bilateral"&&!bilateralEnabled&&<p className="rounded-xl bg-secondary p-3 text-sm">
      Nhóm chưa bật bù nợ.
    </p>}
    {mode==="bilateral"&&bilateralEnabled&&counterparts.length>0&&
      <BilateralPairList groupId={groupId} cycleId={cycleId} me={currentUserId}
        counterparts={counterparts} people={people}
        enabled={financeReady&&bilateralEnabled}/>}

    {mode==="bilateral"&&bilateralEnabled&&counterparts.length===0&&
      <p className="text-sm text-muted-foreground">
        Cần thêm một thành viên khác để xem công nợ hai chiều.
      </p>}
    {mode==="cash"&&requestedEnabled&&<BatchCashPanel groupId={groupId} cycleId={cycleId}
      userId={currentUserId} people={people} enabled={financeReady}/>}
  </section>;
}
