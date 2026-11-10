"use client";

import Link from "next/link";
import {useEffect,useRef,useState} from "react";
import {formatDateDMY} from "@/lib/date-format";

type LateInvoice={
  id:string;title:string;occurredOn:string;expenseVersion:number;
  totalMinor:string;createdBy:string;recurringRuleId:string|null;
  recurringPeriod:string|null;assignedTargetId:string|null;
};
type EligibleCycle={id:string;startDate:string;endDate:string;state:string};
type LateView={
  originCycleId:string;lateInvoices:LateInvoice[];total:number;
  eligibleTarget:EligibleCycle|null;waitingForReview:boolean;
  canManage:boolean;financialEngineEnabled:boolean;
};
const cash=(v:string)=>new Intl.NumberFormat("vi-VN").format(BigInt(v))+" ₫";
export function SettlementLateInvoicePanel({groupId,originCycleId,canManage,
  requestedEnabled}:{
  groupId:string;originCycleId:string;canManage:boolean;requestedEnabled:boolean;
}){
  const url=`/api/groups/${groupId}/settlement-cycle/cycles/${originCycleId}/late-adjustments`;
  const [data,setData]=useState<LateView|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [selected,setSelected]=useState<LateInvoice|null>(null);
  const [accepted,setAccepted]=useState(false);
  const [revision,setRevision]=useState(0);
  const keyRef=useRef<string|null>(null);
  useEffect(()=>{
    if(!requestedEnabled)return;
    const abort=new AbortController();
    void fetch(url,{credentials:"same-origin",cache:"no-store",signal:abort.signal})
      .then(async r=>{
        const body:unknown=await r.json().catch(()=>null);
        if(!r.ok)throw Error(body&&typeof body==="object"&&"error" in body
          ? String((body as {error:unknown}).error)
          :`Không đọc được hóa đơn muộn (HTTP ${r.status}).`);
        if(!abort.signal.aborted){setData(body as LateView);setError("");}
      })
      .catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:"Lỗi kết nối.");})
      .finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return ()=>abort.abort();
  },[url,revision,requestedEnabled]);
  async function assign(){
    if(!selected||!accepted||!canManage||!requestedEnabled||
      !data?.canManage||!data.eligibleTarget||busy)return;
    if(!keyRef.current)keyRef.current=crypto.randomUUID();
    setBusy(true);setError("");setMessage("");
    try{
      const r=await fetch(url,{method:"POST",credentials:"same-origin",
        cache:"no-store",headers:{"content-type":"application/json"},
        body:JSON.stringify({expenseId:selected.id,
          targetCycleId:data.eligibleTarget.id,
          expectedExpenseVersion:selected.expenseVersion,
          requestKey:keyRef.current,
          note:"Ghi nhận hóa đơn nhập muộn vào kỳ rà soát kế tiếp"}),
      });
      const body:unknown=await r.json().catch(()=>null);
      if(!r.ok)throw Object.assign(Error(
        body&&typeof body==="object"&&"error" in body
          ? String((body as {error:unknown}).error)
          :`Không thể gán kỳ (HTTP ${r.status}).`),{status:r.status});
      keyRef.current=null;setSelected(null);setAccepted(false);
      setLoading(true);setMessage("Đã gắn chứng từ hóa đơn gốc vào kỳ rà soát kế tiếp.");
      setRevision(x=>x+1);
    }catch(e){
      if(e&&typeof e==="object"&&"status" in e&&e.status===409){
        keyRef.current=null;setSelected(null);setLoading(true);
        setRevision(x=>x+1);
      }
      setError(e instanceof Error?e.message:"Lỗi cập nhật hóa đơn.");
    }finally{setBusy(false);}
  }
  return <section aria-labelledby="cycle-late-heading"
    className="space-y-4 rounded-3xl border bg-card p-4 sm:p-5">
    <h2 id="cycle-late-heading" className="text-lg font-semibold">Hóa đơn nhập muộn</h2>
    <p className="text-sm text-muted-foreground">
      Kỳ này đã khóa. Hóa đơn nhập sau thời điểm khóa không thể thêm vào
      snapshot cũ. Chủ nhóm/người được ủy quyền có thể gán chứng từ
      hóa đơn gốc sang kỳ sớm nhất đang rà soát; không tạo hóa đơn mới.
    </p>
    {!requestedEnabled&&<p className="rounded-xl bg-secondary p-3 text-sm">
      Nhóm chưa đăng ký chế độ quyết toán; không gán kỳ.
    </p>}
    {requestedEnabled&&loading&&<p role="status" className="text-sm">Đang tải hóa đơn nhập muộn…</p>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {message&&<p role="status" className="text-sm">{message}</p>}
    {data&&!loading&&<>
      <p className="text-sm">Có <strong>{data.total}</strong> hóa đơn gốc phát sinh muộn.</p>
      {data.waitingForReview&&<p className="rounded-xl bg-secondary p-3 text-sm">
        Kỳ tiếp theo đang mở; cần chuyển sang rà soát trước khi gán.
      </p>}
      {!data.eligibleTarget&&data.total>0&&!data.waitingForReview&&
        <p className="rounded-xl bg-secondary p-3 text-sm">
          Chưa có kỳ tiếp theo đang rà soát để tiếp nhận hóa đơn.
        </p>}
      {data.eligibleTarget&&<p className="rounded-xl bg-secondary p-3 text-sm">
        Kỳ có thể tiếp nhận: {formatDateDMY(data.eligibleTarget.startDate)}
        {" – trước "}{formatDateDMY(data.eligibleTarget.endDate)}
      </p>}
      <ol className="space-y-2">
        {data.lateInvoices.slice(0,100).map(bill=><li key={bill.id}
          className="space-y-2 rounded-2xl border p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <Link href={`/groups/${groupId}/expenses/${bill.id}`}
                className="inline-flex min-h-10 items-center font-semibold hover:underline">
                {bill.title}
              </Link>
              <p className="text-xs text-muted-foreground">
                Gốc: {formatDateDMY(bill.occurredOn)}
                {" · "}{cash(bill.totalMinor)}
              </p>
              {bill.recurringRuleId&&<p className="text-xs text-muted-foreground">
                Chi phí định kỳ · không tạo hóa đơn lần hai
              </p>}
            </div>
          </div>
          {bill.assignedTargetId
            ? <p className="text-xs font-medium">Đã có chứng từ gán kỳ</p>
            : data.eligibleTarget&&data.canManage&&canManage&&
              <button type="button" disabled={busy} onClick={()=>{
                setSelected(bill);setAccepted(false);keyRef.current=null;
              }} className="min-h-12 w-full rounded-xl border px-4 text-sm font-medium sm:w-auto">
                Gán vào kỳ đang rà soát
              </button>}
        </li>)}
      </ol>
      {data.total>100&&<p className="text-xs text-muted-foreground">
        Hiển thị 100 hóa đơn đầu. Dữ liệu gốc còn lại được giữ nguyên;
        không áp dụng bù trừ tự động.
      </p>}
      {selected&&data.eligibleTarget&&<div role="group"
        aria-label="Xác nhận gán hóa đơn muộn"
        className="space-y-3 rounded-2xl bg-secondary/60 p-4">
        <h3 className="font-semibold">Gán hóa đơn: {selected.title}</h3>
        <p className="text-sm">
          Hóa đơn vẫn có ngày gốc {formatDateDMY(selected.occurredOn)}.
          Thao tác chỉ tạo chứng từ gán kỳ mới, không xác nhận đã trả tiền.
        </p>
        <label className="flex min-h-11 items-start gap-2 text-sm">
          <input type="checkbox" checked={accepted} disabled={busy}
            onChange={e=>setAccepted(e.target.checked)}
            className="mt-1 size-5 accent-primary"/>
          <span>Tôi đã kiểm tra hóa đơn gốc và kỳ sẽ tiếp nhận.</span>
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!accepted||busy} onClick={()=>void assign()}
            className="min-h-12 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {busy?"Đang cập nhật…":"Xác nhận gán kỳ"}
          </button>
          <button type="button" disabled={busy} onClick={()=>setSelected(null)}
            className="min-h-12 rounded-xl border px-4 text-sm">Hủy</button>
        </div>
      </div>}
    </>}
  </section>;
}
