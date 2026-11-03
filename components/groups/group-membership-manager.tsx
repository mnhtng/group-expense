"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { InlineConfirmation } from "@/components/ui/inline-confirmation";
import type { ExitEligibility } from "@/lib/groups/membership";

type Member={id:string;name:string;role:string};
type Confirmation=
  | {kind:"leave"}
  | {kind:"remove";memberId:string;name:string}
  | {kind:"transfer";memberId:string;name:string};
const formatVnd=(n:string)=>new Intl.NumberFormat("vi-VN").format(BigInt(n))+" ₫";

export function GroupMembershipManager({groupId,userId,role,members,eligibility}:{
  groupId:string;userId:string;role:string;members:Member[];eligibility:ExitEligibility;
}){
  const router=useRouter();
  // Always derive eligibility from refreshed server props: a local useState
  // snapshot would strand former owners in a stale "owner" state.
  const [target,setTarget]=useState(members.find(m=>m.id!==userId)?.id??"");
  const [confirmation,setConfirmation]=useState<Confirmation|null>(null);
  const [pending,setPending]=useState(false);
  const [error,setError]=useState("");
  const [success,setSuccess]=useState("");
  const base=`/api/groups/${groupId}/membership`;
  const activeMembers=members.filter(m=>m.id!==userId);
  const targetId=activeMembers.some(m=>m.id===target)
    ? target:activeMembers[0]?.id??"";

  async function call(method:"POST"|"DELETE",url:string,payload?:object){
    if(pending)return false;
    setPending(true);setError("");setSuccess("");
    try {
      const response=await fetch(url,{
        method,credentials:"same-origin",cache:"no-store",
        ...(payload?{headers:{"Content-Type":"application/json"},
          body:JSON.stringify(payload)}:{}),
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error??"Không thực hiện được thao tác.");
      return true;
    }catch(e){
      setError(e instanceof Error?e.message:"Có lỗi xảy ra.");
      // Server always re-checks outstanding debts and ownership, even if the
      // preflight shown to the user became stale.
      router.refresh();
      return false;
    }finally{setPending(false)}
  }
  async function proceed(){
    if(!confirmation||pending)return;
    if(confirmation.kind==="leave"){
      if(await call("POST",base+"/leave")){
        setConfirmation(null);
        router.replace("/groups");
        router.refresh();
      }
    }else if(confirmation.kind==="remove"){
      if(await call("DELETE",base+"/members/"+encodeURIComponent(confirmation.memberId))){
        setConfirmation(null);
        setSuccess("Đã cập nhật thành viên. Lịch sử hóa đơn vẫn được bảo toàn.");
        router.refresh();
      }
    }else {
      if(await call("POST",base+"/transfer",{targetId:confirmation.memberId})){
        setConfirmation(null);
        setSuccess("Đã chuyển quyền chủ nhóm. Bạn có thể rời sau khi tất toán.");
        router.refresh();
      }
    }
  }

  const reasons:Record<ExitEligibility["reason"],string>={
    ready:"Có thể rời nhóm: không còn nghĩa vụ tài chính chưa xử lý.",
    owner:"Bạn đang là chủ nhóm. Hãy chuyển quyền sở hữu cho thành viên khác trước.",
    pending:"Có giao dịch đang chờ xác nhận hoặc hủy.",
    unsettled:"Cần hoàn tất cả khoản phải trả và khoản được nhận trước khi rời nhóm.",
  };
  return <div className="space-y-4">
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Thành viên đang hoạt động ({members.length})</h3>
      {members.map(m=><div key={m.id} className="space-y-2">
        <div className="flex min-h-16 items-center justify-between gap-3 rounded-xl border p-3 text-sm">
          <span className="min-w-0">{m.name} <small className="text-muted-foreground">({m.role})</small></span>
          {m.id!==userId && m.role!=="owner" &&
            (role==="owner" ||(role==="admin"&&m.role==="member")) &&
            <button type="button" disabled={pending}
              className="min-h-11 shrink-0 rounded-xl px-3 text-destructive disabled:opacity-50"
              onClick={()=>{setError("");setConfirmation({kind:"remove",memberId:m.id,name:m.name});}}>
              Xóa
            </button>}
        </div>
        {confirmation?.kind==="remove"&&confirmation.memberId===m.id&&
          <InlineConfirmation title={`Xóa ${m.name} khỏi nhóm?`}
            description="Chỉ có thể xóa thành viên đã tất toán toàn bộ công nợ. Hóa đơn và lịch sử vẫn được lưu."
            confirmLabel="Xác nhận xóa" danger busy={pending}
            onCancel={()=>setConfirmation(null)} onConfirm={()=>void proceed()}/>}
      </div>)}
    </div>

    {role==="owner"&&<section className="space-y-3 rounded-2xl border p-4">
      <h3 className="font-semibold">Chuyển quyền sở hữu</h3>
      <p className="text-sm text-muted-foreground">
        Chỉ chuyển cho thành viên đang hoạt động. Chủ nhóm mới được quản lý và mời thành viên.
      </p>
      <select value={targetId} onChange={e=>{setTarget(e.target.value);setConfirmation(null);}}
        className="w-full rounded-xl border bg-background p-3">
        {activeMembers.length===0&&<option value="">Không có thành viên để chuyển</option>}
        {activeMembers.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <button type="button" disabled={pending||!targetId}
        onClick={()=>{
          const member=activeMembers.find(m=>m.id===targetId);
          if(member){setError("");setConfirmation({kind:"transfer",memberId:member.id,name:member.name});}
        }}
        className="min-h-12 rounded-xl border px-4 py-3 text-sm disabled:opacity-50">
        Chuyển quyền chủ nhóm
      </button>
      {confirmation?.kind==="transfer"&&
        <InlineConfirmation title={`Chuyển quyền cho ${confirmation.name}?`}
          description="Người này sẽ có toàn quyền quản lý nhóm. Bạn sẽ trở thành thành viên thông thường."
          confirmLabel="Xác nhận chuyển quyền" busy={pending}
          onCancel={()=>setConfirmation(null)} onConfirm={()=>void proceed()}/>}
    </section>}

    <section className="space-y-3 rounded-2xl border border-destructive/30 p-4">
      <h3 className="font-semibold">Rời nhóm</h3>
      <p className="text-sm text-muted-foreground">{reasons[eligibility.reason]}</p>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><p className="text-xs text-muted-foreground">Tôi cần trả</p><strong>{formatVnd(eligibility.toPayMinor)}</strong></div>
        <div><p className="text-xs text-muted-foreground">Tôi cần nhận</p><strong>{formatVnd(eligibility.toReceiveMinor)}</strong></div>
      </div>
      {eligibility.pendingCount>0&&
        <p className="text-sm">{eligibility.pendingCount} giao dịch đang chờ xử lý.</p>}
      {!eligibility.canLeave&&<div className="flex flex-wrap gap-4 text-sm">
        <a className="underline" href={`/groups/${groupId}/debts`}>Xem công nợ</a>
        <a className="underline" href={`/groups/${groupId}/settlements`}>Xem thanh toán</a>
      </div>}
      <button type="button" disabled={pending||!eligibility.canLeave}
        onClick={()=>{setError("");setConfirmation({kind:"leave"});}}
        className="min-h-12 rounded-xl border border-destructive px-4 py-3 text-sm text-destructive disabled:opacity-50">
        Rời nhóm
      </button>
      {confirmation?.kind==="leave"&&eligibility.canLeave&&
        <InlineConfirmation title="Xác nhận rời nhóm?"
          description="Bạn sẽ không còn quyền xem hoặc quản lý nhóm. Các hóa đơn và lịch sử tài chính vẫn được giữ lại."
          confirmLabel="Xác nhận rời nhóm" danger busy={pending}
          onCancel={()=>setConfirmation(null)} onConfirm={()=>void proceed()}/>}
    </section>
    {error&&<p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    {success&&<p role="status" className="rounded-xl bg-secondary p-3 text-sm">{success}</p>}
  </div>;
}
