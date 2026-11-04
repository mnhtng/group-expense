"use client";

import {useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {DateDMYInput} from "@/components/ui/date-dmy-input";
import {formatDateDMY,formatDateTimeDMY} from "@/lib/date-format";
import {
  addCalendarDays,currentLocalDate,
} from "@/lib/settlement-cycles/calendar";
import type {ScheduleView} from "@/lib/settlement-cycles/schedule";
import type {CycleRecord} from "@/lib/settlement-cycles/lifecycle";

/** SC-003 metadata-only controls; not a cash/settlement or completion UI. */
export function SettlementCycleLifecyclePanel({groupId,requestedEnabled,
  schedule,cycles}:{
  groupId:string;requestedEnabled:boolean;
  schedule:ScheduleView;cycles:CycleRecord[];
}) {
  const router=useRouter();
  const active=schedule.current;
  const today=(()=>{
    try{return currentLocalDate(active?.timeZone??"Asia/Ho_Chi_Minh");}
    catch{return "";}
  })();
  const [start,setStart]=useState(today);
  const [end,setEnd]=useState(today?addCalendarDays(today,1):"");
  const keyRef=useRef<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");

  const root=`/api/groups/${groupId}/settlement-cycle/cycles`;
  const manualActive=active?.frequency==="manual";
  function editStart(value:string) {setStart(value);keyRef.current=null;}
  function editEnd(value:string) {setEnd(value);keyRef.current=null;}
  async function call(url:string,body:Record<string,unknown>){
    if(busy)return;
    setBusy(true);setError("");setMessage("");
    try{
      const response=await fetch(url,{
        method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{"content-type":"application/json"},body:JSON.stringify(body),
      });
      const payload:unknown=await response.json().catch(()=>null);
      if(!response.ok) {
        const reason=payload&&typeof payload==="object"&&"error" in payload
          &&typeof (payload as {error?:unknown}).error==="string"
          ? (payload as {error:string}).error:"Không xử lý được kỳ quyết toán.";
        throw Error(reason);
      }
      if(payload&&typeof payload==="object"&&"created" in payload){
        const result=payload as {created:number;reviewed:number;disabled:boolean};
        setMessage(`Đã tạo ${result.created} kỳ và chuyển ${result.reviewed} kỳ sang chờ rà soát. Không tính hoặc chuyển tiền.`);
      } else {
        keyRef.current=null;
        setMessage("Đã cập nhật trạng thái kỳ. Không có nghiệp vụ tiền nào được thực hiện.");
      }
      router.refresh();
    }catch(cause){
      setError(cause instanceof Error?cause.message:"Không thể kết nối máy chủ.");
    }finally{setBusy(false);}
  }
  const createManual=()=>{
    if(!keyRef.current)keyRef.current=crypto.randomUUID();
    void call(root,{
      expectedScheduleVersion:schedule.version,
      requestKey:keyRef.current,startDate:start,endDate:end,
    });
  };

  return <section className="space-y-4 rounded-3xl border bg-card p-5"
    aria-labelledby="cycle-lifecycle-title">
    <div className="space-y-1">
      <h2 id="cycle-lifecycle-title" className="text-lg font-semibold">
        Kỳ quyết toán (chế độ chuẩn bị)
      </h2>
      <p className="text-sm text-muted-foreground">
        Chỉ quản lý khoảng thời gian và trạng thái “Đang mở / Chờ rà soát”.
        Chưa khóa sổ, chụp công nợ, thu tiền hoặc bù trừ.
      </p>
    </div>
    {!requestedEnabled
      ? <p className="rounded-xl bg-secondary p-3 text-sm">
          Chế độ quyết toán chưa được bật cho nhóm. Không tạo kỳ mới.
        </p>
      : !active
        ? <p className="rounded-xl bg-secondary p-3 text-sm">
            Chưa có lịch đã tới ngày bắt đầu. Không thể tạo kỳ trước thời điểm hiệu lực.
          </p>
        : <div className="space-y-4">
          {manualActive&&<div className="space-y-3 rounded-2xl border p-3">
            <p className="text-sm font-medium">Tạo kỳ thủ công</p>
            <DateDMYInput value={start} onChange={editStart} label="Bắt đầu kỳ"/>
            <DateDMYInput value={end} onChange={editEnd} label="Kết thúc kỳ (không bao gồm ngày này)"/>
            <p className="text-xs text-muted-foreground">
              Không chồng lấn kỳ cũ. Chỉ chọn kỳ bắt đầu khi lịch đã hiệu lực.
              Nút tạo kỳ không phát sinh hóa đơn hoặc thanh toán.
            </p>
            <button type="button" disabled={busy||!start||!end}
              onClick={createManual}
              className="min-h-11 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {busy?"Đang xử lý...":"Tạo kỳ thủ công"}
            </button>
          </div>}
          {!manualActive&&<button type="button" disabled={busy}
            onClick={()=>void call(root+"/refresh",{})}
            className="min-h-11 rounded-xl border px-4 py-3 text-sm font-medium disabled:opacity-50">
            {busy?"Đang kiểm tra...":"Kiểm tra các kỳ đến hạn"}
          </button>}
        </div>}
    {cycles.length>0&&<div className="space-y-3 border-t pt-4">
      <h3 className="text-sm font-semibold">Các kỳ đã lưu ({cycles.length} gần nhất)</h3>
      {cycles.map(cycle=><div key={cycle.id}
        className="space-y-2 rounded-2xl border p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">
            {formatDateDMY(cycle.periodStart)} – trước {formatDateDMY(cycle.periodEnd)}
          </span>
          <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium">
            {cycle.state==="review"?"Chờ rà soát":"Đang mở"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {cycle.source==="manual"?"Kỳ thủ công":"Kỳ theo lịch"}
          {" · "}{cycle.timeZone}
          {cycle.reviewedAt?` · Chuyển trạng thái ${formatDateTimeDMY(cycle.reviewedAt)}`:""}
        </p>
        {cycle.state==="open"&&requestedEnabled&&schedule.canManage&&
          Date.parse(cycle.endAt)<=Date.now()&&
          <button type="button" disabled={busy}
            onClick={()=>void call(`${root}/${cycle.id}/review`,{
              expectedVersion:cycle.version,
            })}
            className="min-h-11 rounded-xl border px-3 py-2 text-sm font-medium disabled:opacity-50">
            Chuyển sang chờ rà soát
          </button>}
      </div>)}
    </div>}
    {message&&<p role="status" className="text-sm text-muted-foreground">{message}</p>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
