"use client";

import {useState} from "react";
import {useRouter} from "next/navigation";
import {DateDMYInput} from "@/components/ui/date-dmy-input";
import {formatDateDMY} from "@/lib/date-format";
import {
  addCalendarDays,currentLocalDate,periodContaining,type CycleFrequency,
} from "@/lib/settlement-cycles/calendar";
import type {ScheduleView} from "@/lib/settlement-cycles/schedule";

const choices:{value:CycleFrequency;label:string}[]=[
  {value:"weekly",label:"Hằng tuần (7 ngày)"},
  {value:"biweekly",label:"Hai tuần (14 ngày)"},
  {value:"monthly",label:"Hằng tháng (ngày neo của tháng)"},
  {value:"manual",label:"Thủ công (không tự tạo khoảng kỳ)"},
];
const zones=[
  "Asia/Ho_Chi_Minh","Asia/Bangkok","UTC","Asia/Tokyo",
  "Asia/Singapore","Australia/Sydney","Europe/London",
  "Europe/Berlin","America/New_York","America/Los_Angeles",
];
const tomorrow=(zone:string)=>{
  try{return addCalendarDays(currentLocalDate(zone),1);}
  catch{return "";}
};
export function SettlementSchedulePanel({groupId,initial}:{
  groupId:string;initial:ScheduleView;
}) {
  const router=useRouter();
  const seed=initial.pending??initial.current;
  const initialZone=seed?.timeZone??"Asia/Ho_Chi_Minh";
  const suggest=()=>{
    if(initial.pending)return initial.pending.anchorDate;
    const today=currentLocalDate(initialZone);
    if(initial.current){
      const current=initial.current;
      return periodContaining(today,current.frequency,current.anchorDate)?.end
        ?? tomorrow(initialZone);
    }
    return tomorrow(initialZone);
  };
  const [frequency,setFrequency]=useState<CycleFrequency>(seed?.frequency??"weekly");
  const [timeZone,setTimeZone]=useState(initialZone);
  const [anchorDate,setAnchorDate]=useState(suggest);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const preview=(()=>{
    try {
      if(!anchorDate||frequency==="manual")return null;
      return periodContaining(anchorDate,frequency,anchorDate);
    }catch{return null;}
  })();
  async function save() {
    if(busy||!anchorDate)return;
    setBusy(true);setError("");setMessage("");
    try {
      const result=await fetch(`/api/groups/${groupId}/settlement-cycle/schedule`,{
        method:"PATCH",credentials:"same-origin",cache:"no-store",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({
          expectedVersion:initial.version,frequency,timeZone,anchorDate,
        }),
      });
      const data:unknown=await result.json().catch(()=>null);
      if(!result.ok)throw Error(
        data&&typeof data==="object"&&"error" in data&&
        typeof (data as {error:unknown}).error==="string"
          ? (data as {error:string}).error:"Không lưu được lịch quyết toán.",
      );
      setMessage("Đã lưu lịch dự kiến. Không tạo kỳ hoặc tính công nợ.");
      router.refresh();
    }catch(cause){setError(cause instanceof Error?cause.message:"Lỗi kết nối.");}
    finally{setBusy(false);}
  }
  return <section className="space-y-4 rounded-3xl border bg-card p-5"
    aria-labelledby="cycle-schedule-heading">
    <div className="space-y-1">
      <h2 id="cycle-schedule-heading" className="text-lg font-semibold">
        Chu kỳ quyết toán dự kiến
      </h2>
      <p className="text-sm text-muted-foreground">
        Thay đổi lịch chỉ có hiệu lực từ ngày bắt đầu đã chọn.
        Lưu lịch không tự xác nhận thanh toán hay bù nợ.
      </p>
    </div>
    {initial.current&&<div className="rounded-xl bg-secondary p-3 text-sm">
      <p className="font-medium">{initial.effectiveEnabled?"Lịch quyết toán đang hoạt động":"Lịch đã đến ngày bắt đầu; quyết toán chưa mở cho nhóm"}</p>
      <p className="text-muted-foreground">
        {choices.find(c=>c.value===initial.current?.frequency)?.label}
        {" · "}{initial.current.timeZone}
        {" · "}Từ {formatDateDMY(initial.current.anchorDate)}
      </p>
    </div>}
    {initial.pending&&<div className="rounded-xl border p-3 text-sm">
      <p className="font-medium">Lịch thay đổi đang chờ hiệu lực</p>
      <p className="text-muted-foreground">
        {choices.find(c=>c.value===initial.pending?.frequency)?.label}
        {" · "}{initial.pending.timeZone}
        {" · "}Từ {formatDateDMY(initial.pending.anchorDate)}
      </p>
    </div>}
    {!initial.canManage?null:<div className="space-y-4">
      <label className="block space-y-1.5 text-sm font-medium">
        Chu kỳ
        <select value={frequency} onChange={e=>setFrequency(e.target.value as CycleFrequency)}
          disabled={busy} className="min-h-12 w-full rounded-xl border bg-background p-3 text-base">
          {choices.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <label className="block space-y-1.5 text-sm font-medium">
        Múi giờ
        <input type="text" list="settlement-zone-options" value={timeZone}
          onChange={e=>setTimeZone(e.target.value)} disabled={busy}
          spellCheck={false} autoComplete="off"
          className="min-h-12 w-full rounded-xl border bg-background p-3 text-base"/>
        <datalist id="settlement-zone-options">
          {zones.map(zone=><option key={zone} value={zone}/>)}
        </datalist>
      </label>
      <DateDMYInput value={anchorDate} onChange={setAnchorDate}
        label="Bắt đầu từ"/>
      {preview&&<p className="app-caption">Kỳ đầu: {formatDateDMY(preview.start)} – trước {formatDateDMY(preview.end)}</p>}
      <button type="button" disabled={busy||!anchorDate||!timeZone}
        onClick={()=>void save()}
        className="min-h-12 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
        {busy?"Đang lưu...":"Lưu lịch"}
      </button>
    </div>}
    {message&&<p role="status" className="text-sm text-muted-foreground">{message}</p>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
