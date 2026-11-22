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
import {SettlementSnapshotPanel} from "@/components/groups/settlement-snapshot-panel";

/** SC-003 metadata-only controls; not a cash/settlement or completion UI. */
export function SettlementCycleLifecyclePanel({groupId,requestedEnabled,
  schedule,cycles,renderedAt}:{
  groupId:string;requestedEnabled:boolean;
  schedule:ScheduleView;cycles:CycleRecord[];renderedAt:string;
}) {
  const router=useRouter();
  const active=schedule.current;
  const today=(()=>{
    try{return currentLocalDate(active?.timeZone??"Asia/Ho_Chi_Minh");}
    catch{return "";}
  })();
  const manualWindows=schedule.manualWindows;
  // Default to the latest unfilled day in the most recent historic manual
  // segment. A weekly schedule may still be active after this window ends.
  const guessStart=(index:number)=>{
    const window=manualWindows[index];
    if(!window)return today;
    const lastEnd=cycles
      .filter(c=>c.periodEnd>window.startDate&&
        (!window.endDateExclusive||c.periodEnd<=window.endDateExclusive))
      .map(c=>c.periodEnd).sort().at(-1);
    const earliest=lastEnd??window.startDate;
    return !window.endDateExclusive&&today>earliest?today:earliest;
  };
  const [windowIndex,setWindowIndex]=useState(Math.max(0,manualWindows.length-1));
  const [start,setStart]=useState(()=>guessStart(Math.max(0,manualWindows.length-1)));
  const [end,setEnd]=useState(()=>addCalendarDays(
    guessStart(Math.max(0,manualWindows.length-1)),1));
  const keyRef=useRef<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [editing,setEditing]=useState<{id:string;start:string;end:string}|null>(null);
  const [confirmCancel,setConfirmCancel]=useState<string|null>(null);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");

  const root=`/api/groups/${groupId}/settlement-cycle/cycles`;
  const manualActive=active?.frequency==="manual";
  const canCreateManual=manualWindows.length>0;
  const selectedWindow=manualWindows[windowIndex]??null;
  const validManualRange=Boolean(selectedWindow&&start&&end&&start<end&&
    start>=selectedWindow.startDate&&
    (!selectedWindow.endDateExclusive||end<=selectedWindow.endDateExclusive)&&
    start<=today);
  function chooseWindow(value:string){
    const index=Number(value);
    if(!Number.isSafeInteger(index)||!manualWindows[index])return;
    const chosen=guessStart(index);
    setWindowIndex(index);
    setStart(chosen);setEnd(addCalendarDays(chosen,1));
    keyRef.current=null;
  }
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
        setMessage(`Đã tạo ${result.created} kỳ và chuyển ${result.reviewed} kỳ sang chờ kiểm tra. Không tính hoặc chuyển tiền.`);
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

  async function changeDraft(cycle:CycleRecord,action:"edit"|"cancel"){
    if(busy||cycle.state==="locked"||!schedule.canManage)return;
    if(action==="edit"&&(cycle.source!=="manual"||!editing||editing.id!==cycle.id))return;
    setBusy(true);setError("");setMessage("");
    try{
      const body=action==="edit"?{
        expectedVersion:cycle.version,expectedDraftRevision:cycle.draftRevision,
        startDate:editing!.start,endDate:editing!.end,
      }:{
        expectedVersion:cycle.version,expectedDraftRevision:cycle.draftRevision,
      };
      const response=await fetch(`${root}/${cycle.id}`,{
        method:action==="edit"?"PATCH":"DELETE",
        credentials:"same-origin",cache:"no-store",
        headers:{"content-type":"application/json"},body:JSON.stringify(body),
      });
      const payload:unknown=await response.json().catch(()=>null);
      if(!response.ok)throw Error(payload&&typeof payload==="object"&&
        "error" in payload&&typeof (payload as {error?:unknown}).error==="string"
        ? (payload as {error:string}).error:"Không cập nhật được kỳ.");
      setEditing(null);setConfirmCancel(null);
      setMessage(action==="edit"
        ?"Đã cập nhật kỳ chưa chốt. Hãy kiểm tra lại số liệu trước khi chốt."
        :"Đã hủy kỳ chưa chốt; lịch sử vẫn được lưu để kiểm toán.");
      router.refresh();
    }catch(cause){
      setError(cause instanceof Error?cause.message:"Lỗi kết nối.");
      router.refresh();
    }finally{setBusy(false);}
  }

  return <section className="space-y-4 rounded-3xl border bg-card p-5"
    aria-labelledby="cycle-lifecycle-title">
    <div className="space-y-1">
      <h2 id="cycle-lifecycle-title" className="text-lg font-semibold">
        Kỳ quyết toán (chế độ chuẩn bị)
      </h2>
      <p className="text-sm text-muted-foreground">
        Kỳ thủ công Đang mở hoặc Chờ kiểm tra có thể sửa hay xóa trước khi chốt.
        Kỳ theo lịch chỉ được hủy, không sửa ngày riêng lẻ. Kỳ đã chốt không thể
        thay đổi; hóa đơn và công nợ luôn được giữ nguyên.
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
          {canCreateManual&&<div id="manual-cycle-form" className="scroll-mt-20 space-y-3 rounded-2xl border p-3">
            <p className="text-sm font-medium">Tạo kỳ thủ công</p>
            {!manualActive&&<p className="text-xs text-muted-foreground">
              Chỉ tạo thêm kỳ thuộc lịch Thủ công cũ. Lịch định kỳ đang hoạt động
              vẫn được giữ nguyên, và không thể tạo kỳ lấn sang lịch định kỳ.
            </p>}
            {manualWindows.length>1&&<label className="block space-y-1 text-sm">
              <span className="font-medium">Khoảng lịch Thủ công</span>
              <select value={windowIndex} onChange={e=>chooseWindow(e.target.value)}
                disabled={busy} className="min-h-12 w-full rounded-xl border bg-background p-3">
                {manualWindows.map((window,index)=><option key={index} value={index}>
                  {formatDateDMY(window.startDate)}
                  {window.endDateExclusive
                    ?` – trước ${formatDateDMY(window.endDateExclusive)}`
                    :" – hiện tại"}
                </option>)}
              </select>
            </label>}
            {selectedWindow&&<p className="text-xs text-muted-foreground">
              Khoảng hợp lệ: từ {formatDateDMY(selectedWindow.startDate)}
              {selectedWindow.endDateExclusive
                ?` đến trước ${formatDateDMY(selectedWindow.endDateExclusive)}`
                :" đến hiện tại (ngày bắt đầu không ở tương lai)"}.
            </p>}
            <DateDMYInput value={start} onChange={editStart} label="Bắt đầu kỳ"/>
            <DateDMYInput value={end} onChange={editEnd} label="Kết thúc kỳ (không bao gồm ngày này)"/>
            <p className="text-xs text-muted-foreground">
              Không chồng lấn các kỳ đã lưu. Tạo kỳ không phát sinh khoản chi,
              bù nợ hoặc thanh toán.
            </p>
            <button type="button" disabled={busy||!validManualRange}
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
          <span className={cycle.settlementCompletedAt
            ?"rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
            :"rounded-full bg-secondary px-2.5 py-1 text-xs font-medium"}>
            {cycle.settlementCompletedAt?"✓ Hoàn tất":cycle.state==="locked"?"Đã khóa snapshot":cycle.state==="review"?"Chờ kiểm tra":"Đang mở"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {cycle.source==="manual"?"Kỳ thủ công":"Kỳ theo lịch"}
          {" · "}{cycle.timeZone}
          {cycle.reviewedAt?` · Chuyển trạng thái ${formatDateTimeDMY(cycle.reviewedAt)}`:""}
        </p>
        {cycle.state!=="locked"&&schedule.canManage&&
          <div className="space-y-3 rounded-xl border p-3">
            <div className="flex flex-wrap gap-2">
              {cycle.source==="manual"&&<button type="button" disabled={busy}
                onClick={()=>{setEditing({id:cycle.id,start:cycle.periodStart,end:cycle.periodEnd});setConfirmCancel(null);}}
                className="min-h-11 rounded-xl border px-3 text-sm font-medium">Sửa kỳ</button>}
              <button type="button" disabled={busy}
                onClick={()=>{setConfirmCancel(cycle.id);setEditing(null);}}
                className="min-h-11 rounded-xl border border-destructive px-3 text-sm text-destructive">
                {cycle.source==="manual"?"Xóa kỳ":"Hủy kỳ theo lịch"}
              </button>
            </div>
            {editing?.id===cycle.id&&<div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Chỉ được sửa kỳ chưa chốt số liệu. Với kỳ Chờ kiểm tra, cần xem lại bản tổng hợp trước khi chốt; hóa đơn và công nợ không thay đổi.
              </p>
              <DateDMYInput label="Bắt đầu kỳ" value={editing.start}
                onChange={value=>setEditing(old=>old&&old.id===cycle.id?{...old,start:value}:old)}/>
              <DateDMYInput label="Kết thúc kỳ (không bao gồm ngày này)" value={editing.end}
                onChange={value=>setEditing(old=>old&&old.id===cycle.id?{...old,end:value}:old)}/>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy||!editing.start||!editing.end}
                  onClick={()=>void changeDraft(cycle,"edit")}
                  className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">
                  Lưu thay đổi
                </button>
                <button type="button" disabled={busy} onClick={()=>setEditing(null)}
                  className="min-h-11 rounded-xl border px-4 text-sm">Đóng</button>
              </div>
            </div>}
            {confirmCancel===cycle.id&&<div role="group" aria-label="Xác nhận hủy kỳ chưa chốt"
              className="space-y-2">
              <p className="text-sm">
                {cycle.source==="scheduled"
                  ?"Hủy kỳ theo lịch này? Kỳ sẽ không được sinh lại. Lịch định kỳ của nhóm không đổi."
                  :"Xóa kỳ này khỏi danh sách và giải phóng khoảng ngày?"}
                {" "}Không thể hoàn tác. Lịch sử vẫn được giữ để kiểm toán.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy}
                  onClick={()=>void changeDraft(cycle,"cancel")}
                  className="min-h-11 rounded-xl bg-destructive px-4 text-sm font-semibold text-destructive-foreground">
                  Xác nhận xóa kỳ
                </button>
                <button type="button" disabled={busy} onClick={()=>setConfirmCancel(null)}
                  className="min-h-11 rounded-xl border px-4 text-sm">Giữ kỳ</button>
              </div>
            </div>}
          </div>}
        {cycle.state==="open"&&requestedEnabled&&schedule.canManage&&
          Date.parse(cycle.endAt)<=Date.parse(renderedAt)&&
          <button type="button" disabled={busy}
            onClick={()=>void call(`${root}/${cycle.id}/review`,{
              expectedVersion:cycle.version,expectedDraftRevision:cycle.draftRevision,
            })}
            className="min-h-11 rounded-xl border px-3 py-2 text-sm font-medium disabled:opacity-50">
            Chuyển sang chờ kiểm tra
          </button>}
        {(cycle.state==="review"||cycle.state==="locked")&&
          <SettlementSnapshotPanel key={cycle.id+"-"+cycle.draftRevision}
            groupId={groupId} cycleId={cycle.id} version={cycle.version}
            canManage={requestedEnabled&&schedule.canManage}
            locked={cycle.state==="locked"}/>}

      </div>)}
    </div>}
    {message&&<p role="status" className="text-sm text-muted-foreground">{message}</p>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
