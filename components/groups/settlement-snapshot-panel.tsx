"use client";
import {useRef,useState} from "react";
import {useRouter} from "next/navigation";
import type {EligibilityPreview,LockedSnapshot} from "@/lib/settlement-cycles/snapshot";

type Display=EligibilityPreview|LockedSnapshot;
const asVnd=(value:string)=>new Intl.NumberFormat("vi-VN")
  .format(BigInt(value))+"đ";

/** Review fingerprint is an explicit two-step authorization:
 * preview -> inspect -> lock the exact same data. Any intervening invoice
 * edit/confirmed cash/pending reservation MUST yield 409 on the server.
 */
export function SettlementSnapshotPanel({groupId,cycleId,version,canManage,
  locked}:{groupId:string;cycleId:string;version:number;
    canManage:boolean;locked:boolean}) {
  const router=useRouter();
  const [data,setData]=useState<Display|null>(null);
  const [lateCount,setLateCount]=useState(0);
  const [accepted,setAccepted]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const requestKey=useRef<string|null>(null);
  const url=`/api/groups/${groupId}/settlement-cycle/cycles/${cycleId}/snapshot`;

  async function getPreview(){
    if(busy)return;
    setBusy(true);setError("");setMessage("");setAccepted(false);
    try{
      const response=await fetch(url,{credentials:"same-origin",cache:"no-store"});
      const body:unknown=await response.json().catch(()=>null);
      if(!response.ok) {
        const detail=body&&typeof body==="object"&&"error" in body&&
          typeof (body as {error?:unknown}).error==="string"
          ? (body as {error:string}).error:"Không đọc được dữ liệu kỳ.";
        throw Error(detail);
      }
      const value=body as {snapshot:Display|null;lateExpenseCount:number};
      setData(value.snapshot);setLateCount(value.lateExpenseCount);
      requestKey.current=null;
      if(!value.snapshot)setMessage("Kỳ chưa sẵn sàng đối soát.");
    }catch(cause){setError(cause instanceof Error?cause.message:"Lỗi kết nối.");}
    finally{setBusy(false);}
  }

  async function lock(){
    if(busy||!canManage||!accepted||!data||data.state!=="review")return;
    setBusy(true);setError("");setMessage("");
    try{
      // Include synchronous WebCrypto errors in the normal error path.
      // Previously randomUUID() ran outside try, so a browser-side error
      // could leave the lock button busy without an alert or API request.
      if(!requestKey.current)requestKey.current=crypto.randomUUID();
      const response=await fetch(url,{
        method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          expectedVersion:version,requestKey:requestKey.current,
          expectedFingerprint:data.fingerprint,
        }),
      });
      const result:unknown=await response.json().catch(()=>null);
      if(!response.ok){
        const detail=result&&typeof result==="object"&&"error" in result&&
          typeof (result as {error?:unknown}).error==="string"
          ? (result as {error:string}).error:"Không khóa được snapshot.";
        if(response.status===409){
          setData(null);setAccepted(false);requestKey.current=null;
        }
        throw Error(detail);
      }
      setData((result as {snapshot:LockedSnapshot}).snapshot);
      setAccepted(false);requestKey.current=null;
      setMessage("Đã chốt số liệu.");
      router.refresh();
    }catch(cause){setError(cause instanceof Error?cause.message:"Lỗi kết nối.");}
    finally{setBusy(false);}
  }

  return <div className="space-y-3 border-t pt-3 text-sm">
    <button type="button" disabled={busy} onClick={()=>void getPreview()}
      className="min-h-11 rounded-xl border px-3 py-2 font-medium disabled:opacity-50">
      {busy?"Đang xử lý...":locked?"Xem số liệu":"Kiểm tra số liệu"}
    </button>
    {data&&<div className="space-y-3 rounded-xl bg-secondary/60 p-3">
      <p className="font-semibold">
        {data.state==="locked"?"Số liệu đã chốt":"Chưa chốt"}
      </p>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <p>Khoản chi: <strong>{data.expenseCount}</strong></p>
        <p>Khoản nợ: <strong>{data.obligationCount}</strong></p>
        <p>Nợ gốc: <strong>{asVnd(data.originalMinor)}</strong></p>
        <p>Đã xác nhận tiền: <strong>{asVnd(data.confirmedCashMinor)}</strong></p>
        <p>Đang chờ xác nhận: <strong>{asVnd(data.pendingCashMinor)}</strong></p>
        <p>Còn phải trả: <strong>{asVnd(data.outstandingMinor)}</strong></p>
        <p>Khả dụng: <strong>{asVnd(data.availableMinor)}</strong></p>
      </div>

      {data.state==="locked"&&
        <p className="text-xs">Khoản chi xuất hiện sau khóa cần điều chỉnh: <strong>{lateCount}</strong></p>}
      {data.state==="review"&&canManage&&
        <>
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={accepted}
              onChange={e=>setAccepted(e.target.checked)}
              className="mt-0.5 size-4"/>
            <span>Tôi đã kiểm tra số liệu. Chốt sổ không xác nhận trả tiền.</span>
          </label>
          <button type="button" disabled={!accepted||busy}
            onClick={()=>void lock()}
            className="min-h-11 rounded-xl bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50">
            {busy?"Đang khóa...":"Chốt số liệu"}
          </button>
        </>}
    </div>}
    {message&&<p role="status" className="text-xs text-muted-foreground">{message}</p>}
    {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
