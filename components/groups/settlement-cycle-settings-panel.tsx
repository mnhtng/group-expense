"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SettlementSettingsView } from "@/lib/settlement-cycles/settings";

type Member={id:string;name:string;role:string};

export function SettlementCycleSettingsPanel({
  groupId,initial,members,
}:{
  groupId:string;initial:SettlementSettingsView;members:Member[];
}) {
  const router=useRouter();
  const [requestedEnabled,setEnabled]=useState(initial.requestedEnabled);
  const [requestedBilateralNetting,setNetting]=useState(initial.requestedBilateralNetting);
  const [selectedMember,setSelectedMember]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [info,setInfo]=useState("");
  const base=`/api/groups/${groupId}/settlement-cycle`;
  const available=members.filter(m=>m.role!=="owner" && !initial.managerIds.includes(m.id));
  const delegates=members.filter(m=>initial.managerIds.includes(m.id));
  const dirty=requestedEnabled!==initial.requestedEnabled ||
    requestedBilateralNetting!==initial.requestedBilateralNetting;

  async function request(url:string,method:"PATCH"|"POST",payload:object) {
    setBusy(true);setError("");setInfo("");
    try {
      const response=await fetch(url,{
        method,credentials:"same-origin",cache:"no-store",
        headers:{"content-type":"application/json"},
        body:JSON.stringify(payload),
      });
      const data:unknown=await response.json().catch(()=>null);
      if(!response.ok) {
        throw Error(data&&typeof data==="object"&&"error" in data &&
          typeof (data as {error:unknown}).error==="string"
            ? (data as {error:string}).error
            : "Không thể cập nhật cấu hình.");
      }
      setInfo("Đã lưu cấu hình chuẩn bị. Hệ thống quyết toán chưa được kích hoạt.");
      router.refresh();
    } catch(cause) {
      setError(cause instanceof Error?cause.message:"Lỗi kết nối. Vui lòng thử lại.");
    } finally {setBusy(false);}
  }
  return <section aria-labelledby="settlement-preparation" className="space-y-4 rounded-3xl border bg-card p-5">
    <div className="space-y-1">
      <h2 id="settlement-preparation" className="text-lg font-semibold">Chuẩn bị quyết toán theo kỳ</h2>
      <p className="text-sm text-muted-foreground">
        Tính năng đang xây dựng và chưa hoạt động. Thiết lập này chỉ lưu lựa chọn
        của nhóm; không tạo kỳ, bù trừ hoặc thay đổi công nợ hiện tại.
      </p>
    </div>
    <div className="rounded-2xl bg-secondary/70 p-3 text-sm">
      Trạng thái thực tế: <strong>{initial.effectiveEnabled?"Đã hoạt động":"Chưa kích hoạt"}</strong>
    </div>
    {initial.canManage&&<div className="space-y-4">
      <label className="flex min-h-12 items-center gap-3 rounded-xl border p-3 text-sm">
        <input type="checkbox" checked={requestedEnabled} disabled={busy}
          onChange={e=>{
            setEnabled(e.target.checked);
            if(!e.target.checked)setNetting(false);
          }}
          className="size-5 shrink-0 accent-primary"/>
        <span>Đăng ký sử dụng chế độ quyết toán theo kỳ khi phát hành đầy đủ</span>
      </label>
      <label className="flex min-h-12 items-center gap-3 rounded-xl border p-3 text-sm">
        <input type="checkbox" checked={requestedBilateralNetting}
          disabled={busy||!requestedEnabled}
          onChange={e=>setNetting(e.target.checked)}
          className="size-5 shrink-0 accent-primary"/>
        <span>Cho phép đề xuất bù trừ công nợ hai chiều giữa đúng hai thành viên</span>
      </label>
      <p className="text-xs text-muted-foreground">
        Khi hệ thống quyết toán được phát hành, bù trừ vẫn cần hai bên liên quan
        xác nhận. Không chuyển khoản nợ qua người thứ ba.
      </p>
      <button type="button" disabled={!dirty||busy}
        onClick={()=>void request(base+"/settings","PATCH",{
          expectedVersion:initial.version,requestedEnabled,requestedBilateralNetting,
        })}
        className="min-h-12 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
        {busy?"Đang lưu...":"Lưu lựa chọn cho nhóm"}
      </button>
    </div>}
    {initial.canDelegate&&<div className="space-y-3 border-t pt-4">
      <h3 className="font-semibold">Người được ủy quyền quản lý kỳ</h3>
      <p className="text-xs text-muted-foreground">
        Chỉ chủ nhóm cấp/thu hồi quyền này. Admin không được cấp quyền mặc định.
        Người được ủy quyền không thể sửa hóa đơn hoặc xác nhận tiền thay người khác.
      </p>
      {delegates.length===0
        ? <p className="text-sm text-muted-foreground">Chưa ủy quyền cho thành viên nào.</p>
        : delegates.map(m=><div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
            <span className="text-sm font-medium">{m.name}</span>
            <button type="button" disabled={busy}
              onClick={()=>void request(base+"/managers","POST",{
                action:"revoke",memberId:m.id,
              })}
              className="min-h-11 rounded-xl border px-3 text-sm disabled:opacity-50">
              Thu hồi quyền
            </button>
          </div>)}
      {available.length>0&&<div className="flex flex-wrap gap-2">
        <select aria-label="Chọn thành viên được ủy quyền"
          value={selectedMember} disabled={busy}
          onChange={e=>setSelectedMember(e.target.value)}
          className="min-h-12 min-w-0 flex-1 rounded-xl border bg-background px-3 text-base">
          <option value="">Chọn thành viên</option>
          {available.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <button type="button" disabled={!selectedMember||busy}
          onClick={()=>void request(base+"/managers","POST",{
            action:"grant",memberId:selectedMember,
          })}
          className="min-h-12 rounded-xl border px-4 text-sm font-medium disabled:opacity-50">
          Cấp quyền
        </button>
      </div>}
    </div>}
    {info&&<p role="status" className="text-sm text-muted-foreground">{info}</p>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
