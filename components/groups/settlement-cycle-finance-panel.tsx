"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";
import {useEffect,useRef,useState} from "react";
import type {BilateralProposalPreview} from "@/lib/settlement-cycles/proposals";
import type {DecisionView} from "@/lib/settlement-cycles/decisions";
import type {AppliedNoncashDocument} from "@/lib/settlement-cycles/applications";
import type {ResidualPreview} from "@/lib/settlement-cycles/residual-repayments";
import type {BatchPairPreview} from "@/lib/settlement-cycles/repayments";

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
  proposal:"Gửi đề xuất bù trừ",approve:"Đồng ý bù trừ",
  reject:"Từ chối đề xuất",revoke:"Thu hồi đồng ý",
  apply:"Ghi bù trừ phi tiền mặt",residual:"Yêu cầu thanh toán phần chênh lệch",
  batch:"Yêu cầu thanh toán gộp một chiều",
};
const explain:Record<Command,string>={
  proposal:"Đây chỉ là đề xuất để hai bên rà soát, chưa giảm nợ.",
  approve:"Bạn đồng ý với đúng số tiền và hai chiều công nợ đang hiển thị. Chưa trừ tiền.",
  reject:"Đề xuất này sẽ bị từ chối; không có khoản nợ nào bị xóa.",
  revoke:"Thu hồi sự đồng ý của chính bạn, không sửa lịch sử phi tiền mặt đã áp dụng.",
  apply:"Sau khi cả hai đồng ý, bút toán phi tiền mặt sẽ giảm nợ gốc của đúng hai người. Không chuyển khoản ngân hàng.",
  residual:"Chỉ tạo một yêu cầu tiền mặt đang chờ. Phía đối ứng cần xác nhận sau khi thực sự chuyển/nhận tiền.",
  batch:"Yêu cầu gộp chỉ thuộc một chiều công nợ. Người gửi không thể tự xác nhận đã thanh toán.",
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
function Consent({kind,checked,onChange,onConfirm,onCancel,busy}:{
  kind:Command;checked:boolean;onChange:(v:boolean)=>void;
  onConfirm:()=>void;onCancel:()=>void;busy:boolean;
}){
  return <div role="group" aria-label={commandName[kind]}
    className="space-y-3 rounded-2xl border bg-secondary/60 p-4">
    <strong className="block text-sm">{commandName[kind]}</strong>
    <p className="text-sm text-muted-foreground">{explain[kind]}</p>
    <label className="flex min-h-11 items-start gap-3 text-sm">
      <input type="checkbox" checked={checked} disabled={busy}
        onChange={e=>onChange(e.target.checked)}
        className="mt-1 size-5 shrink-0 accent-primary"/>
      <span>Tôi đã kiểm tra đúng người, số tiền và trạng thái công nợ.</span>
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
function DisabledAction({kind,canUse,onClick}:{
  kind:Command;canUse:boolean;onClick:()=>void;
}){
  return <button type="button" disabled={!canUse} onClick={onClick}
    aria-label={commandName[kind]} title={!canUse?"Chưa phát hành giao dịch tài chính":undefined}
    className="min-h-12 w-full rounded-xl border px-3 py-2 text-sm font-semibold text-left disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
    {commandName[kind]}
  </button>;
}

function BilateralWorkbench({groupId,cycleId,me,other,people,enabled}:{
  groupId:string;cycleId:string;me:string;other:string;
  people:Member[];enabled:boolean;
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
        Công nợ đã thay đổi từ lúc lập đề xuất. Cần rà soát và lập phiên bản mới.
      </p>}
      <div className="grid grid-cols-2 gap-3">
        {[
          [`${name(live.calculation.aOwesB.debtorId)} → ${name(live.calculation.aOwesB.creditorId)}`,
            live.calculation.aOwesB.availableBeforeMinor],
          [`${name(live.calculation.bOwesA.debtorId)} → ${name(live.calculation.bOwesA.creditorId)}`,
            live.calculation.bOwesA.availableBeforeMinor],
        ].map(([label,amount])=><div key={label} className="rounded-2xl bg-secondary/60 p-3">
          <p className="break-words text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 break-all text-sm font-semibold tabular-nums">{money(amount)}</p>
        </div>)}
      </div>
      <div className="rounded-2xl border p-4 space-y-1">
        <p className="text-xs text-muted-foreground">Có thể bù trừ phi tiền mặt (mỗi chiều)</p>
        <strong className="block break-all text-2xl tabular-nums">{money(live.calculation.offsetMinor)}</strong>
        <p className="text-xs text-muted-foreground">
          Đây là số tính thử từ nghĩa vụ gốc. Chưa phải giao dịch đã thực hiện.
        </p>
      </div>
      <div className="rounded-2xl border p-3">
        <button type="button" aria-expanded={showSources}
          aria-controls="cycle-noncash-source-lines"
          onClick={()=>setShowSources(v=>!v)}
          className="min-h-11 w-full py-2 text-left text-sm font-semibold">
          {showSources?"Ẩn nghĩa vụ gốc":"Xem nghĩa vụ gốc dùng để tính bù trừ"}
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
                <span className="block">{line.occurredOn} · Bù trừ dự kiến {money(line.setoffMinor)}</span>
                <span className="block text-muted-foreground">Còn khả dụng: {money(line.availableAfterMinor)}</span>
              </p>)}
            {(items as typeof live.calculation.aOwesB.allocations).length===0&&
              <p className="text-xs text-muted-foreground">Không có nghĩa vụ đủ điều kiện.</p>}
          </div>)}
        </div>}
      </div>
      {doc&&<div className="space-y-3 rounded-2xl border p-4">
        <h3 className="font-semibold">Đề xuất hiện tại · phiên bản {doc.version}</h3>
        <p className="text-sm">Số tiền đề xuất: <strong className="tabular-nums">{money(doc.offsetMinor)}</strong> mỗi chiều</p>
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
        <h3 className="font-semibold">Bút toán đã áp dụng · phi tiền mặt</h3>
        <p className="text-xl font-semibold tabular-nums">{money(app.offsetMinor)} mỗi chiều</p>
        <p className="text-sm text-muted-foreground">
          Hai bên đã đồng ý với chứng từ này. Tiền chuyển khoản thực tế:
          {" "}<strong>{money(app.cashTransferredMinor)}</strong>.
        </p>
        <p className="text-xs text-muted-foreground">
          {when(app.appliedAt)} · Người áp dụng: {name(app.appliedBy)} ·
          Chứng từ <code className="break-all">{app.id}</code>
        </p>
      </div>}
      {residual&&<div className="space-y-2 rounded-2xl border p-4">
        <h3 className="font-semibold">Tiền mặt chênh lệch sau bù trừ</h3>
        <p className="text-xl font-semibold tabular-nums">{money(residual.preview.amountMinor)}</p>
        {residual.preview.debtorId&&residual.preview.creditorId&&
          <p className="text-sm">{name(residual.preview.debtorId)} cần trả
            {" "}{name(residual.preview.creditorId)}</p>}
        <p className="text-sm text-muted-foreground">
          {residual.preview.status==="settled"?"Công nợ đã được xác nhận hoàn tất.":
            residual.preview.blockedReason??"Chỉ được tạo yêu cầu chờ xác nhận, không tự báo đã chuyển tiền."}
        </p>
        {residual.preview.status==="ready"&&<DisabledAction kind="residual"
          canUse={!!actionAllowed&&residual.writable}
          onClick={()=>begin("residual")}/>}
        {residual.history.length>0&&<div className="space-y-2 border-t pt-3">
          <h4 className="text-sm font-medium">Lịch sử yêu cầu tiền mặt</h4>
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
        Hai chiều không có khoản nợ khả dụng để bù trừ. Có thể xem yêu cầu
        thanh toán riêng từng chiều ở phía dưới.
      </p>}
      {intent&&<Consent kind={intent} checked={accepted} onChange={setAccepted}
        busy={sending} onConfirm={()=>void submit()}
        onCancel={()=>{setIntent(null);setAccepted(false);}}/>}
      {!enabled&&<p role="note" className="text-xs text-muted-foreground">
        Các thao tác bù trừ và thanh toán ở trên đang khóa cho tới khi
        hệ thống tài chính được phát hành. Quyền chủ nhóm không thay thế
        sự đồng ý của hai thành viên.
      </p>}
    </>}
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
    <h3 className="text-base font-semibold">Gộp thanh toán một chiều</h3>
    <p className="text-sm text-muted-foreground">
      Chỉ hiển thị những khoản bạn phải trả hoặc được nhận. Một yêu cầu
      tiền mặt luôn cần người đối ứng xác nhận.
    </p>
    {loading&&<p role="status" className="text-sm">Đang tải thanh toán một chiều…</p>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {!loading&&pairs.length===0&&<p className="text-sm text-muted-foreground">
      Không có khoản khả dụng để gộp của bạn trong kỳ này.
    </p>}
    {!loading&&pairs.map(p=><div key={p.debtorId+"-"+p.creditorId}
      className="space-y-2 rounded-2xl border p-3">
      <p className="text-sm font-medium">{name(p.debtorId)} → {name(p.creditorId)}</p>
      <strong className="block text-lg tabular-nums">{money(p.availableMinor)}</strong>
      <p className="text-xs text-muted-foreground">
        {p.allocationCount} nghĩa vụ nguồn · Tiền mặt đang chờ: {money(p.pendingMinor)}
      </p>
      <DisabledAction kind="batch" canUse={enabled}
        onClick={()=>{key.current=null;setAccepted(false);setSelected(p);}}/>
    </div>)}
    {selected&&<Consent kind="batch" checked={accepted} onChange={setAccepted}
      busy={sending} onConfirm={()=>void submit()}
      onCancel={()=>{setSelected(null);setAccepted(false);}}/>}
  </section>;
}

/** financialEngineEnabled is a server-derived, per-group rollout decision.
 * The UI cannot grant financial authority through a client-side opt-in.
 */
export function SettlementCycleFinancePanel({groupId,cycleId,
  currentUserId,currentUserName,counterparts,requestedEnabled,
  bilateralEnabled,financialEngineEnabled}:{
  groupId:string;cycleId:string;currentUserId:string;currentUserName:string;
  counterparts:Member[];requestedEnabled:boolean;bilateralEnabled:boolean;
  financialEngineEnabled:boolean;
}){
  const [other,setOther]=useState(counterparts[0]?.id??"");
  const people=[{id:currentUserId,name:currentUserName},...counterparts];
  const financeReady=financialEngineEnabled&&requestedEnabled;
  return <section aria-labelledby="bilateral-cycle-heading"
    className="space-y-4 rounded-3xl border bg-card p-4 sm:p-5">
    <header className="space-y-2">
      <h2 id="bilateral-cycle-heading" className="text-lg font-semibold">
        Quyết toán giữa hai người
      </h2>
      <p className="text-sm text-muted-foreground">
        Bù trừ chỉ giữa bạn và đúng một thành viên khác trong nhóm.
        Số tiền trừ nợ bằng phi tiền mặt không phải tiền đã chuyển.
      </p>
    </header>
    {!requestedEnabled&&<p className="rounded-xl bg-secondary p-3 text-sm">
      Nhóm chưa đăng ký quyết toán theo kỳ. Bạn có thể xem nguồn gốc ở trên.
    </p>}
    {!bilateralEnabled&&<p className="rounded-xl bg-secondary p-3 text-sm">
      Nhóm chưa đăng ký chế độ bù trừ hai người.
    </p>}
    {bilateralEnabled&&counterparts.length>0&&<>
      <label className="block space-y-2 text-sm font-semibold" htmlFor="cycle-pair-member">
        Xem công nợ của tôi với
      </label>
      {/* WebKit/iOS was 25px in RR-002; enforce a 48px touch target
          even if utility styles load late or a native select style wins. */}
      <select id="cycle-pair-member" value={other} onChange={e=>setOther(e.target.value)}
        style={{height:"48px",minHeight:"48px"}}
        className="h-12 min-h-12 w-full rounded-xl border bg-background px-3 text-base">
        {counterparts.map(member=><option key={member.id} value={member.id}>
          {member.name}
        </option>)}
      </select>
      {other&&<BilateralWorkbench key={other} groupId={groupId}
        cycleId={cycleId} me={currentUserId} other={other}
        people={people} enabled={financeReady&&bilateralEnabled}/>}
    </>}
    {bilateralEnabled&&counterparts.length===0&&
      <p className="text-sm text-muted-foreground">
        Cần thêm một thành viên khác để xem công nợ hai chiều.
      </p>}
    {requestedEnabled&&<BatchCashPanel groupId={groupId} cycleId={cycleId}
      userId={currentUserId} people={people} enabled={financeReady}/>}
  </section>;
}
