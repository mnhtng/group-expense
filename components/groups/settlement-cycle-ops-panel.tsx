"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import type {CycleSourceLine} from "@/lib/settlement-cycles/ui-read";
import type {CycleReconciliation,CycleAuditEvent}
  from "@/lib/settlement-cycles/reconciliation";
import type {CycleDispute} from "@/lib/settlement-cycles/disputes";

type Member={id:string;name:string};
type Disputes={disputes:CycleDispute[];limit:number};
type Audit={items:CycleAuditEvent[];page:number;total:number;
  totalPages:number};
const money=(value:string)=>new Intl.NumberFormat("vi-VN").format(BigInt(value))+" ₫";
const date=(s:string)=>new Date(s).toLocaleString("vi-VN");
async function request<T>(url:string,body?:Record<string,unknown>):Promise<T>{
  const r=await fetch(url,{method:body?"POST":"GET",
    credentials:"same-origin",cache:"no-store",
    headers:body?{"content-type":"application/json"}:{},
    body:body?JSON.stringify(body):undefined});
  const b:unknown=await r.json().catch(()=>null);
  if(!r.ok)throw Object.assign(Error(b&&typeof b==="object"&&"error" in b
    ? String((b as {error:unknown}).error):`Không thể tải dữ liệu (HTTP ${r.status}).`),
    {status:r.status});
  return b as T;
}
const actionText:Record<"respond"|"resolve"|"withdraw",string>={
  respond:"Gửi phản hồi cho người mở tranh chấp",
  resolve:"Tôi xác nhận đã giải quyết xong",
  withdraw:"Rút yêu cầu tranh chấp",
};
const statusText:Record<CycleDispute["status"],string>={
  open:"Chờ người đối ứng phản hồi",
  awaiting_reporter:"Chờ người mở xác nhận phương án",
  resolved:"Hai bên đã kết thúc trao đổi",
  withdrawn:"Người mở đã thu hồi",
};
export function SettlementCycleOpsPanel({groupId,cycleId,userId,
  members,visibleSources}:{
    groupId:string;cycleId:string;userId:string;
    members:Member[];visibleSources:CycleSourceLine[];
}){
  const base=`/api/groups/${groupId}/settlement-cycle/cycles/${cycleId}`;
  const [report,setReport]=useState<CycleReconciliation|null>(null);
  const [audit,setAudit]=useState<Audit|null>(null);
  const [disputes,setDisputes]=useState<Disputes|null>(null);
  const [busy,setBusy]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [revision,setRevision]=useState(0);
  const [source,setSource]=useState("");
  const [reason,setReason]=useState("");
  const [consent,setConsent]=useState(false);
  const [reply,setReply]=useState("");
  const [active,setActive]=useState<{id:string;action:"respond"|"resolve"|"withdraw"}|null>(null);
  const key=useRef<string|null>(null);
  const label=(id:string)=>members.find(x=>x.id===id)?.name??"Thành viên";
  const mySources=visibleSources.filter(v=>v.debtorId===userId||v.creditorId===userId);
  const load=useCallback(async()=>{
    try{
      const [r,a,d]=await Promise.all([
        request<CycleReconciliation>(base+"/reconciliation"),
        request<Audit>(base+"/audit?page=1"),
        request<Disputes>(base+"/disputes"),
      ]);
      setReport(r);setAudit(a);setDisputes(d);setError("");
    }catch(e){setError(e instanceof Error?e.message:"Không thể đối soát kỳ.");}
    finally{setBusy(false);}
  },[base]);
  useEffect(()=>{queueMicrotask(()=>void load());},[load,revision]);
  async function create(){
    if(saving||!consent||reason.trim().length<10||reason.trim().length>500||!source)return;
    if(!key.current)key.current=crypto.randomUUID();
    setSaving(true);setError("");
    try{
      await request(base+"/disputes",{obligationId:source,
        reason:reason.trim(),requestKey:key.current});
      setReason("");setSource("");setConsent(false);key.current=null;
      setMessage("Đã mở tranh chấp cho đúng nghĩa vụ gốc. Người đối ứng sẽ nhận thông báo.");
      setBusy(true);setRevision(n=>n+1);
    }catch(e){setError(e instanceof Error?e.message:"Không thể mở tranh chấp.");
      if(e&&typeof e==="object"&&"status" in e&&e.status===409)key.current=null;
    }finally{setSaving(false);}
  }
  async function act(){
    if(!active||saving||reply.trim().length<5||reply.trim().length>500)return;
    if(!key.current)key.current=crypto.randomUUID();
    setSaving(true);setError("");
    try{
      await request(`${base}/disputes/${active.id}/events`,
        {eventType:active.action,body:reply.trim(),requestKey:key.current});
      setActive(null);setReply("");key.current=null;
      setMessage("Phản hồi đã được ghi vào lịch sử bất biến; không có khoản tiền nào tự thay đổi.");
      setBusy(true);setRevision(n=>n+1);
    }catch(e){setError(e instanceof Error?e.message:"Không thể cập nhật tranh chấp.");
      if(e&&typeof e==="object"&&"status" in e&&e.status===409)key.current=null;
    }finally{setSaving(false);}
  }
  async function next(){
    if(!audit||audit.page>=audit.totalPages||saving)return;
    setSaving(true);setError("");
    try{
      const next=await request<Audit>(base+`/audit?page=${audit.page+1}`);
      setAudit({...next,items:[...audit.items,...next.items]});
    }catch(e){setError(e instanceof Error?e.message:"Không tải được lịch sử.");}
    finally{setSaving(false);}
  }
  return <section aria-labelledby="sc009-heading" className="space-y-5">
    <header className="space-y-1">
      <h2 id="sc009-heading" className="text-lg font-semibold">Đối soát và trao đổi</h2>
      <p className="text-sm text-muted-foreground">
        Dữ liệu từ nghĩa vụ gốc, không tạo hóa đơn khác. Trao đổi tranh chấp
        không tự thay đổi tiền mặt, bù trừ hoặc snapshot đã khóa.
      </p>
    </header>
    {busy&&<p role="status" className="text-sm text-muted-foreground">
      Đang đọc số dư, thông báo và lịch sử kiểm toán…
    </p>}
    {error&&<div role="alert" className="space-y-2 rounded-xl border p-3 text-sm text-destructive">
      <p>{error}</p>
      <button type="button" className="min-h-11 rounded-xl border px-4"
        onClick={()=>{setBusy(true);setRevision(n=>n+1);}}>Tải lại</button>
    </div>}
    {message&&<p role="status" className="rounded-xl bg-secondary p-3 text-sm">{message}</p>}
    {report&&<section aria-label="Báo cáo đối soát" className="space-y-3 rounded-3xl border bg-card p-4 sm:p-5">
      <h3 className="font-semibold">Báo cáo đối soát trực tiếp</h3>
      <p className="text-xs text-muted-foreground">
        {report.sourceCount} nghĩa vụ gốc trong kỳ · không giới hạn bởi phân trang.
      </p>
      <dl className="grid grid-cols-2 gap-2">
        {[
          ["Nợ ban đầu",report.originalMinor],
          ["Đã xác nhận tiền mặt",report.confirmedCashMinor],
          ["Đã bù trừ phi tiền mặt",report.confirmedSetoffMinor],
          ["Đang chờ xác nhận tiền mặt",report.pendingCashMinor],
          ["Nợ còn lại",report.outstandingMinor],
          ["Có thể thanh toán",report.availableMinor],
        ].map(([name,value])=><div key={name}
          className="min-w-0 space-y-1 rounded-xl bg-secondary/60 p-3">
          <dt className="text-xs text-muted-foreground">{name}</dt>
          <dd className="break-all text-sm font-semibold tabular-nums">{money(value)}</dd>
        </div>)}
      </dl>
      <div className="space-y-1 rounded-xl border p-3 text-sm">
        <p>Tranh chấp chưa kết thúc: <strong>{report.unresolvedDisputes}</strong></p>
        <p>Yêu cầu tiền mặt chờ: <strong>{report.pendingCashRequests}</strong></p>
        <p>Hóa đơn chưa được người tạo chốt: <strong>{report.uncompletedInvoices}</strong></p>
        <p>Đề xuất bù trừ chưa áp dụng: <strong>{report.currentProposals}</strong></p>
      </div>
      <p role="status" className="text-sm font-medium">
        {report.readyForManualReview
          ?"Số dư và các điều kiện đã đối soát. Đây không phải hành động tự hoàn tất kỳ."
          :"Kỳ còn nghĩa vụ hoặc chứng từ cần xử lý. Không được tự tuyên bố đã quyết toán."}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <a className="inline-flex min-h-12 items-center justify-center rounded-xl border px-4 text-sm font-medium"
          href={base+"/export?kind=ledger"}>Xuất nguồn công nợ (CSV)</a>
        <a className="inline-flex min-h-12 items-center justify-center rounded-xl border px-4 text-sm font-medium"
          href={base+"/export?kind=audit"}>Xuất lịch sử kiểm toán (CSV)</a>
      </div>
    </section>}
    <section className="space-y-3 rounded-3xl border bg-card p-4 sm:p-5">
      <h3 className="font-semibold">Tranh chấp giữa đúng hai người</h3>
      <p className="text-sm text-muted-foreground">
        Chỉ bạn và người đối ứng của một nghĩa vụ gốc được gửi hoặc xem nội dung.
        Chủ nhóm không được xác nhận thay hai bên.
      </p>
      {mySources.length>0&&<div className="space-y-3 rounded-2xl border p-3">
        <label htmlFor="sc009-obligation" className="block text-sm font-medium">
          Chọn nghĩa vụ gốc cần đối soát
        </label>
        <select id="sc009-obligation" value={source} onChange={e=>{
            setSource(e.target.value);key.current=null;
          }} className="min-h-12 w-full rounded-xl border bg-background p-3 text-base">
          <option value="">Chọn hóa đơn và người đối ứng</option>
          {mySources.map(x=><option key={x.obligationId} value={x.obligationId}>
            {x.expenseTitle} · {label(x.debtorId)} → {label(x.creditorId)}
          </option>)}
        </select>
        <label htmlFor="sc009-reason" className="block text-sm font-medium">
          Lý do (10–500 ký tự)
        </label>
        <textarea id="sc009-reason" rows={3} maxLength={500}
          value={reason} onChange={e=>{setReason(e.target.value);key.current=null;}}
          placeholder="Nêu hóa đơn, khoản tiền hoặc cách chia cần đối soát"
          className="w-full rounded-xl border bg-background p-3 text-base"/>
        <label className="flex min-h-11 items-start gap-2 text-sm">
          <input type="checkbox" checked={consent}
            onChange={e=>setConsent(e.target.checked)} className="mt-1 size-5"/>
          <span>Tôi hiểu tranh chấp không tự hủy nợ hoặc chuyển tiền.</span>
        </label>
        <button type="button" disabled={saving||!consent||!source||reason.trim().length<10}
          onClick={()=>void create()}
          className="min-h-12 w-full rounded-xl border px-4 font-semibold disabled:opacity-50">
          {saving?"Đang lưu…":"Gửi tranh chấp"}
        </button>
        <p className="text-xs text-muted-foreground">
          Danh sách lựa chọn theo trang nghĩa vụ phía trên. Chuyển trang
          nếu chưa thấy hóa đơn cần đối soát.
        </p>
      </div>}
      {disputes?.disputes.length===0&&<p className="text-sm text-muted-foreground">
        Bạn chưa có tranh chấp nào trong kỳ.
      </p>}
      {disputes?.disputes.map(d=><article key={d.id}
        className="space-y-3 rounded-2xl border p-4">
        <p className="text-xs font-semibold">{statusText[d.status]}</p>
        <p className="text-sm">{d.reason}</p>
        <p className="text-xs text-muted-foreground">
          {label(d.reporterId)} gửi {date(d.createdAt)} ·
          <code className="ml-1 break-all">{d.obligationId}</code>
        </p>
        <ol aria-label="Lịch sử phản hồi tranh chấp" className="space-y-2">
          {d.events.map(e=><li key={e.id} className="rounded-xl bg-secondary/60 p-3 text-sm">
            <p className="text-xs text-muted-foreground">
              {label(e.actorId)} · {date(e.recordedAt)} · {e.eventType}
            </p>
            <p>{e.body}</p>
          </li>)}
        </ol>
        {(d.canRespond||d.canResolve||d.canWithdraw)&&<div className="flex flex-wrap gap-2">
          {([
            ["respond",d.canRespond],["resolve",d.canResolve],
            ["withdraw",d.canWithdraw],
          ] as const).filter(x=>x[1]).map(([kind])=>
            <button key={kind} type="button"
              onClick={()=>{setActive({id:d.id,action:kind});setReply("");key.current=null;}}
              className="min-h-11 rounded-xl border px-3 text-sm">{actionText[kind]}</button>)}
        </div>}
        {active?.id===d.id&&<div role="group" aria-label="Phản hồi tranh chấp"
          className="space-y-2 rounded-xl bg-secondary/60 p-3">
          <p className="text-sm font-medium">{actionText[active.action]}</p>
          <label htmlFor="sc009-reply" className="block text-xs">Giải thích/biên bản (5–500 ký tự)</label>
          <textarea id="sc009-reply" rows={3} value={reply} maxLength={500}
            onChange={e=>{setReply(e.target.value);key.current=null;}}
            className="w-full rounded-xl border bg-background p-3 text-base"/>
          <div className="flex gap-2">
            <button type="button" disabled={saving||reply.trim().length<5}
              onClick={()=>void act()}
              className="min-h-12 rounded-xl border px-4 font-medium disabled:opacity-50">
              {saving?"Đang lưu…":"Ghi nhận vào lịch sử"}</button>
            <button type="button" disabled={saving}
              onClick={()=>setActive(null)} className="min-h-12 rounded-xl border px-4">Hủy</button>
          </div>
        </div>}
      </article>)}
    </section>
    <section aria-labelledby="sc009-audit" className="space-y-3 rounded-3xl border bg-card p-4 sm:p-5">
      <h3 id="sc009-audit" className="font-semibold">Lịch sử kiểm toán</h3>
      <p className="text-sm text-muted-foreground">
        Sự kiện được lấy từ chứng từ gốc. Nội dung tranh chấp/bù trừ
        của các cặp khác không được hiển thị.
      </p>
      {audit?.items.length===0&&<p className="text-sm text-muted-foreground">
        Chưa có sự kiện nào trong kỳ này.
      </p>}
      <ol className="space-y-2">
        {audit?.items.map(e=><li key={e.id}
          className="space-y-1 rounded-2xl border p-3 text-sm">
          <p className="font-medium">{e.description}</p>
          <p className="text-xs text-muted-foreground">
            {date(e.at)} · {e.kind}/{e.eventType} ·
            {e.actorId?label(e.actorId):"Hệ thống"}
          </p>
          <p className="break-all text-[11px] text-muted-foreground">
            {e.subjectId}
          </p>
        </li>)}
      </ol>
      {audit&&audit.page<audit.totalPages&&
        <button type="button" disabled={saving} onClick={()=>void next()}
          className="min-h-12 w-full rounded-xl border px-4 text-sm font-medium disabled:opacity-50">
          Tải thêm sự kiện ({audit.items.length}/{audit.total})
        </button>}
    </section>
  </section>;
}
