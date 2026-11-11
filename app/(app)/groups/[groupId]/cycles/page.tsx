import Link from "next/link";
import {notFound} from "next/navigation";
import {requireUser} from "@/lib/auth/session";
import {getMemberRole,getGroupDetails} from "@/lib/groups/service";
import {getSettlementSettings} from "@/lib/settlement-cycles/settings";
import {listSettlementCycleHistoryPage} from "@/lib/settlement-cycles/lifecycle";
import {formatDateDMY} from "@/lib/date-format";

const stateText={open:"Đang mở",review:"Chờ kiểm tra",locked:"Đã khóa sổ"};
export default async function GroupCyclesPage({params,searchParams}:{
  params:Promise<{groupId:string}>;
  searchParams:Promise<{page?:string}>;
}){
  const {groupId}=await params;
  const {page:rawPage}=await searchParams;
  const proposedPage=rawPage?Number(rawPage):1;
  const page=Number.isSafeInteger(proposedPage)&&proposedPage>0&&proposedPage<=100000?proposedPage:1;
  const user=await requireUser();
  if(!await getMemberRole(groupId,user.id))notFound();
  const [group,setting,records]=await Promise.all([
    getGroupDetails(groupId,user.id),
    getSettlementSettings(groupId,user.id),
    listSettlementCycleHistoryPage(groupId,user.id,page),
  ]);
  if(!group)notFound();
  return <main className="app-page space-y-5">
    <Link href={`/groups/${groupId}`}
      className="-ml-2 inline-flex min-h-11 items-center rounded-xl px-2 text-sm text-muted-foreground">
      <span aria-hidden="true" className="mr-2">←</span> Về nhóm
    </Link>
    <header className="space-y-1">
      <h1 className="text-2xl font-semibold">Quyết toán</h1>
      <p className="text-sm text-muted-foreground">{group.name} · VND</p>
    </header>
    <p className="app-caption">{setting.effectiveEnabled?"Quyết toán đã mở cho nhóm":"Quyết toán chưa mở cho nhóm"}</p>
    <section aria-labelledby="cycle-list" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="cycle-list" className="text-lg font-semibold">Các kỳ</h2>
        {setting.canManage&&<Link
          href={`/groups/${groupId}/manage?section=periods`}
          className="inline-flex min-h-11 items-center rounded-xl border px-4 text-sm font-medium">
          Quản lý kỳ
        </Link>}
      </div>
      {records.cycles.length===0&&<div className="rounded-3xl border border-dashed p-6 text-sm text-muted-foreground">
        Chưa có kỳ quyết toán. {setting.canManage?"Bạn có thể cấu hình lịch trong Quản lý nhóm.":"Liên hệ chủ nhóm để thiết lập chu kỳ."}
      </div>}
      {records.cycles.map(cycle=><Link key={cycle.id}
        href={`/groups/${groupId}/cycles/${cycle.id}`}
        className="flex min-h-24 items-center justify-between gap-3 rounded-3xl border bg-card p-4 transition-colors hover:bg-secondary/40 active:bg-secondary/60 sm:p-5">
        <div className="min-w-0 space-y-1.5">
          <h3 className="text-base font-semibold">
            {formatDateDMY(cycle.periodStart)} – trước {formatDateDMY(cycle.periodEnd)}
          </h3>
          <p className="text-xs text-muted-foreground">
            {cycle.source==="manual"?"Kỳ thủ công":"Theo lịch"} · {cycle.timeZone}
          </p>
          <span className="inline-flex rounded-full bg-secondary px-2.5 py-1 text-xs font-medium">
            {stateText[cycle.state]}
          </span>
        </div>
        <span aria-hidden="true" className="text-muted-foreground">→</span>
      </Link>)}
      {records.total>50&&<nav aria-label="Phân trang lịch sử kỳ"
        className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
        <span>Trang {records.page}/{records.totalPages}</span>
        <div className="flex gap-2">
          {records.page>1&&<Link href={`/groups/${groupId}/cycles?page=${records.page-1}`}
            className="inline-flex min-h-11 items-center rounded-xl border px-4">Mới hơn</Link>}
          {records.page<records.totalPages&&<Link href={`/groups/${groupId}/cycles?page=${records.page+1}`}
            className="inline-flex min-h-11 items-center rounded-xl border px-4">Cũ hơn</Link>}
        </div>
      </nav>}
    </section>
  </main>;
}
