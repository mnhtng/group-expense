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
        SC-002 chỉ lưu lịch cấu hình. Hệ thống chưa tạo kỳ, thu tiền hoặc bù trừ.
      </p>
    </div>
    {initial.current&&<div className="rounded-xl bg-secondary p-3 text-sm">
      <p className="font-medium">Lịch đang có hiệu lực về thời gian (chưa kích hoạt engine)</p>
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
        Múi giờ IANA của nhóm
        <input type="text" list="settlement-zone-options" value={timeZone}
          onChange={e=>setTimeZone(e.target.value)} disabled={busy}
          spellCheck={false} autoComplete="off"
          className="min-h-12 w-full rounded-xl border bg-background p-3 text-base"/>
        <datalist id="settlement-zone-options">
          {zones.map(zone=><option key={zone} value={zone}/>)}
        </datalist>
      </label>
      <DateDMYInput value={anchorDate} onChange={setAnchorDate}
        label="Ngày bắt đầu kỳ đầu tiên / ngày áp dụng lịch mới"/>
      <div className="space-y-1 rounded-xl bg-secondary/60 p-3 text-xs text-muted-foreground">
        {frequency==="manual"
          ? <p>Kỳ thủ công không có ranh giới tự động. Phạm vi từng kỳ sẽ do bước nghiệp vụ riêng quản lý.</p>
          : preview
            ? <p>Ví dụ kỳ đầu: từ {formatDateDMY(preview.start)} đến trước {formatDateDMY(preview.end)}.</p>
            : <p>Nhập ngày bắt đầu hợp lệ để xem ranh giới kỳ.</p>}
        <p>Ngày bắt đầu phải là một ngày tương lai. Nếu đã có lịch đang chạy,
          thay đổi phải ở đúng đầu kỳ cũ, không được cắt ngang kỳ.</p>
        <p>Ngày 29–31 sẽ dùng ngày cuối tháng với những tháng ngắn hơn.
          Đổi múi giờ không được làm lệch thời điểm khóa kỳ.</p>
      </div>
      <button type="button" disabled={busy||!anchorDate||!timeZone}
        onClick={()=>void save()}
        className="min-h-12 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
        {busy?"Đang lưu...":"Lưu lịch quyết toán dự kiến"}
      </button>
    </div>}
    {message&&<p role="status" className="text-sm text-muted-foreground">{message}</p>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
