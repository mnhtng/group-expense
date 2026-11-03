"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ExitEligibility } from "@/lib/groups/membership";

type Member={id:string;name:string;role:string};
const formatVnd=(n:string)=>new Intl.NumberFormat("vi-VN").format(BigInt(n))+" ₫";
export function GroupMembershipManager({groupId,userId,role,members,eligibility}:{
  groupId:string;userId:string;role:string;members:Member[];eligibility:ExitEligibility;
}){
  const router=useRouter();
  const [state,setState]=useState<ExitEligibility>(eligibility);
  const [target,setTarget]=useState(members.find(m=>m.id!==userId)?.id??"");
  const [pending,setPending]=useState(false);
  const [error,setError]=useState("");
  const [success,setSuccess]=useState("");
  const base=`/api/groups/${groupId}/membership`;
  async function call(method:"POST"|"DELETE",url:string,payload?:object){
    setPending(true);setError("");setSuccess("");
    try {
      const r=await fetch(url,{
        method,credentials:"same-origin",cache:"no-store",
        ...(payload?{headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}:{}),
      });
      const data=await r.json();
      if(!r.ok)throw new Error(data.error??"Không thực hiện được thao tác.");
      return true;
    }catch(e){setError(e instanceof Error?e.message:"Có lỗi xảy ra.");return false}
    finally{setPending(false)}
  }
  async function refreshEligibility(){
    const r=await fetch(base+"/leave",{cache:"no-store"});
    if(r.ok){const d=await r.json();setState(d.eligibility);}
  }
  async function leave(){
    if(!window.confirm("Rời nhóm? Bạn sẽ mất quyền xem và quản lý nhóm, nhưng lịch sử tài chính được giữ lại."))return;
    if(await call("POST",base+"/leave")){router.replace("/groups");router.refresh();}
    else await refreshEligibility();
  }
  async function removeMember(memberId:string,name:string){
    if(!window.confirm(`Xóa ${name} khỏi nhóm? Thành viên chỉ bị ngừng quyền truy cập sau khi tất toán công nợ.`))return;
    if(await call("DELETE",base+"/members/"+encodeURIComponent(memberId))){
      setSuccess("Đã cập nhật thành viên. Lịch sử hóa đơn vẫn được bảo toàn.");
      router.refresh();
    }
  }
  async function transfer(){
    if(!target || !window.confirm("Chuyển quyền chủ nhóm? Người được chọn sẽ có toàn quyền quản lý nhóm."))return;
    if(await call("POST",base+"/transfer",{targetId:target})){
      setSuccess("Đã chuyển quyền chủ nhóm. Bạn có thể rời nhóm sau khi tất toán.");
      router.refresh();
      await refreshEligibility();
    }
  }
  const activeMembers=members.filter(m=>m.id!==userId);
  const reasons={
    ready:"Có thể rời nhóm: không còn nghĩa vụ tài chính chưa xử lý.",
    owner:"Bạn đang là chủ nhóm. Hãy chuyển quyền sở hữu cho thành viên khác trước.",
    pending:"Có giao dịch đang chờ xác nhận hoặc hủy.",
    unsettled:"Cần hoàn tất cả khoản phải trả và khoản được nhận trước khi rời nhóm.",
  };
  return <div className="space-y-4">
    <div className="space-y-2">
      <h3 className="font-semibold text-sm">Thành viên đang hoạt động ({members.length})</h3>
      {members.map(m=><div key={m.id} className="flex justify-between items-center gap-3 rounded-xl border p-3 text-sm">
        <span className="min-w-0">{m.name} <small className="text-muted-foreground">({m.role})</small></span>
        {m.id!==userId && m.role!=="owner" && (role==="owner" ||(role==="admin"&&m.role==="member")) &&
          <button type="button" disabled={pending} className="shrink-0 text-destructive disabled:opacity-50"
            onClick={()=>void removeMember(m.id,m.name)}>Xóa</button>}
      </div>)}
    </div>
    {role==="owner"&&<div className="space-y-3 rounded-xl border p-4">
      <h3 className="font-semibold">Chuyển quyền sở hữu</h3>
      <p className="text-xs text-muted-foreground">Chỉ chuyển cho thành viên đang hoạt động. Chủ nhóm mới được quản lý và mời thành viên.</p>
      <select value={target} onChange={e=>setTarget(e.target.value)}
        className="w-full rounded-xl border bg-background p-3">
        {activeMembers.length===0&&<option value="">Không có thành viên để chuyển</option>}
        {activeMembers.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <button type="button" disabled={pending||!target} onClick={()=>void transfer()}
        className="rounded-xl border px-4 py-3 text-sm disabled:opacity-50">
        Chuyển quyền chủ nhóm
      </button>
    </div>}
    <section className="space-y-3 rounded-xl border border-destructive/30 p-4">
      <h3 className="font-semibold">Rời nhóm</h3>
      <p className="text-sm text-muted-foreground">{reasons[state.reason]}</p>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div><p className="text-xs text-muted-foreground">Tôi cần trả</p><strong>{formatVnd(state.toPayMinor)}</strong></div>
        <div><p className="text-xs text-muted-foreground">Tôi cần nhận</p><strong>{formatVnd(state.toReceiveMinor)}</strong></div>
      </div>
      {state.pendingCount>0&&<p className="text-sm">{state.pendingCount} giao dịch đang chờ xử lý.</p>}
      {!state.canLeave&&<div className="flex gap-4 text-sm">
        <a className="underline" href={`/groups/${groupId}/debts`}>Xem công nợ</a>
        <a className="underline" href={`/groups/${groupId}/settlements`}>Xem thanh toán</a>
      </div>}
      <button type="button" onClick={()=>void leave()} disabled={pending||!state.canLeave}
        className="rounded-xl border border-destructive px-4 py-3 text-sm text-destructive disabled:opacity-50">
        Rời nhóm
      </button>
    </section>
    {error&&<p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    {success&&<p role="status" className="rounded-xl bg-secondary p-3 text-sm">{success}</p>}
  </div>;
}
