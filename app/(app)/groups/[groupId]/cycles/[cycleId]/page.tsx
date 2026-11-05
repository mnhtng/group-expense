import Link from "next/link";
import {notFound} from "next/navigation";
import {requireUser} from "@/lib/auth/session";
import {getMemberRole,getGroupDetails,listMembers} from "@/lib/groups/service";
import {getSettlementSettings} from "@/lib/settlement-cycles/settings";
import {listSettlementCycles} from "@/lib/settlement-cycles/lifecycle";
import {readCycleSources} from "@/lib/settlement-cycles/ui-read";
import {formatDateDMY} from "@/lib/date-format";
import {SettlementSnapshotPanel} from "@/components/groups/settlement-snapshot-panel";
import {SettlementCycleFinancePanel} from "@/components/groups/settlement-cycle-finance-panel";
import {SettlementLateInvoicePanel} from "@/components/groups/settlement-late-invoice-panel";
import {SettlementCycleSourceList} from "@/components/groups/settlement-cycle-source-list";

export default async function CycleDetailPage({params,searchParams}:{
  params:Promise<{groupId:string;cycleId:string}>;
  searchParams:Promise<{page?:string}>;
}){
  const {groupId,cycleId}=await params;
  const {page:pageParam}=await searchParams;
  const requestedPage=pageParam?Number(pageParam):1;
  const page=Number.isSafeInteger(requestedPage)&&requestedPage>0&&
    requestedPage<=100000?requestedPage:1;
  const user=await requireUser();
  if(!await getMemberRole(groupId,user.id))notFound();
  const [group,members,settings,cycles]=await Promise.all([
    getGroupDetails(groupId,user.id),listMembers(groupId,user.id),
    getSettlementSettings(groupId,user.id),listSettlementCycles(groupId,user.id,100),
  ]);
  if(!group)notFound();
  const selected=cycles.cycles.find(c=>c.id===cycleId);
  if(!selected)notFound();
  const isLocked=selected.state==="locked";
  const originalSources=isLocked?await readCycleSources(groupId,selected,user.id,page):null;
  const people=members.filter(x=>x.id!==user.id).map(x=>({id:x.id,name:x.name}));
  const me=members.find(x=>x.id===user.id)?.name??"Bạn";
  return <main className="app-page space-y-6">
    <Link href={`/groups/${groupId}/cycles`}
      className="-ml-2 inline-flex min-h-11 items-center rounded-xl px-2 text-sm text-muted-foreground">
      <span aria-hidden="true" className="mr-2">←</span> Tất cả các kỳ
    </Link>
    <header className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground">{group.name}</p>
      <h1 className="text-2xl font-semibold">Chi tiết kỳ quyết toán</h1>
      <p className="text-sm text-muted-foreground">
        {formatDateDMY(selected.periodStart)} – trước {formatDateDMY(selected.periodEnd)}
        {" · "}{selected.timeZone}
      </p>
      <span className="inline-flex rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold">
        {selected.state==="open"?"Đang mở":selected.state==="review"?"Chờ rà soát":"Snapshot đã khóa"}
      </span>
    </header>
    <section aria-label="Trạng thái phát hành" role="note"
      className="space-y-1 rounded-2xl border bg-secondary/60 p-4 text-sm">
      <p className="font-semibold">Chưa phát hành giao dịch quyết toán</p>
      <p className="text-muted-foreground">
        Chỉ hiển thị dữ liệu và các thao tác chuẩn bị được cho phép.
        Bù trừ không phải tiền chuyển khoản; yêu cầu tiền mặt đang chờ
        không đồng nghĩa đã thanh toán. Các nút ghi nhận tài chính vẫn khóa.
      </p>
    </section>
    {selected.state==="open"&&<section className="rounded-2xl border bg-card p-5 space-y-2">
      <h2 className="font-semibold">Kỳ đang mở</h2>
      <p className="text-sm text-muted-foreground">
        Tiếp tục nhập hóa đơn tại nhóm. Kỳ cần chuyển sang rà soát và
        khóa snapshot trước khi tính bù trừ.
      </p>
      <Link href={`/groups/${groupId}`}
        className="inline-flex min-h-11 items-center rounded-xl border px-4 text-sm">
        Xem hóa đơn nhóm
      </Link>
    </section>}
    {selected.state==="review"&&<section className="space-y-3 rounded-3xl border bg-card p-5">
      <h2 className="text-lg font-semibold">Rà soát trước khi khóa</h2>
      <p className="text-sm text-muted-foreground">
        Số liệu là bản xem trước. Chỉ chủ nhóm hoặc người được ủy quyền
        có thể khóa; không xác nhận thu tiền.
      </p>
      <SettlementSnapshotPanel groupId={groupId} cycleId={cycleId}
        version={selected.version}
        canManage={settings.canManage&&settings.requestedEnabled}
        locked={false}/>
    </section>}
    {isLocked&&originalSources&&<>
      <SettlementCycleSourceList groupId={groupId} cycleId={cycleId}
        source={originalSources} members={[...people,{id:user.id,name:me}]}/>
      <SettlementCycleFinancePanel groupId={groupId} cycleId={cycleId}
        currentUserId={user.id} currentUserName={me}
        counterparts={people} requestedEnabled={settings.requestedEnabled}
        bilateralEnabled={settings.requestedBilateralNetting}
        financialEngineEnabled={settings.effectiveEnabled}/>
      <section className="rounded-3xl border bg-card p-5 space-y-2">
        <h2 className="font-semibold">Ảnh chụp số liệu lúc khóa kỳ</h2>
        <p className="text-sm text-muted-foreground">
          Snapshot bất biến có thể khác số dư hiện tại vì tiền mặt được
          xác nhận hoặc bù trừ sau thời điểm khóa kỳ.
        </p>
        <SettlementSnapshotPanel groupId={groupId} cycleId={cycleId}
          version={selected.version} canManage={false} locked/>
      </section>
    </>}
    {settings.canManage&&selected.state==="locked"&&
      <SettlementLateInvoicePanel groupId={groupId} originCycleId={cycleId}
        canManage={settings.canManage} requestedEnabled={settings.requestedEnabled}/>}
    {settings.canManage&&<Link href={`/groups/${groupId}/manage`}
      className="inline-flex min-h-12 items-center justify-center rounded-xl border px-4 text-sm font-medium">
      Quản lý lịch và quyền kỳ
    </Link>}
  </main>;
}
