import {notFound} from "next/navigation";
import Link from "next/link";
import {requireUser} from "@/lib/auth/session";
import {getMemberRole,getGroupDetails,listMembers} from "@/lib/groups/service";
import {getSettlementSettings} from "@/lib/settlement-cycles/settings";
import {getSettlementCycleById} from "@/lib/settlement-cycles/lifecycle";
import {readCycleSources} from "@/lib/settlement-cycles/ui-read";
import {formatDateDMY} from "@/lib/date-format";
import {SettlementSnapshotPanel} from "@/components/groups/settlement-snapshot-panel";
import {SettlementCycleFinancePanel} from "@/components/groups/settlement-cycle-finance-panel";
import {SettlementLateInvoicePanel} from "@/components/groups/settlement-late-invoice-panel";
import {SettlementCycleSourceList} from "@/components/groups/settlement-cycle-source-list";
import {SettlementCycleOpsPanel} from "@/components/groups/settlement-cycle-ops-panel";
import {ActionLink,GroupedList,NavigationRow,PageHeader,SegmentedNav} from "@/components/ui/app-screen";
const titles={overview:"Quyết toán",sources:"Khoản trong kỳ",settle:"Trả nợ",check:"Kiểm tra & trao đổi",snapshot:"Số liệu đã chốt",late:"Khoản nhập muộn"};
export default async function CycleDetailPage({params,searchParams}:{
  params:Promise<{groupId:string;cycleId:string}>;searchParams:Promise<{page?:string;view?:string;mode?:string;panel?:string}>;
}){
  const {groupId,cycleId}=await params,q=await searchParams;
  const view=(q.view&&Object.hasOwn(titles,q.view)?q.view:q.page?"sources":"overview") as keyof typeof titles;
  const n=Number(q.page??1),page=Number.isSafeInteger(n)&&n>0&&n<=100000?n:1;
  const user=await requireUser();if(!await getMemberRole(groupId,user.id))notFound();
  const [group,members,settings,selected]=await Promise.all([getGroupDetails(groupId,user.id),listMembers(groupId,user.id),getSettlementSettings(groupId,user.id),getSettlementCycleById(groupId,cycleId,user.id)]);
  if(!group||!selected)notFound();
  const locked=selected.state==="locked",base=`/groups/${groupId}/cycles/${cycleId}`;
  const source=locked&&["overview","sources","check"].includes(view)?await readCycleSources(groupId,selected,user.id,page):null;
  const people=members.filter(x=>x.id!==user.id).map(x=>({id:x.id,name:x.name}));
  const me=members.find(x=>x.id===user.id)?.name??"Bạn";
  const mode=q.mode==="cash"?"cash":"bilateral";
  const panel=q.panel==="disputes"||q.panel==="history"?q.panel:"report";
  return <main className="app-page space-y-6">
    <PageHeader title={titles[view]} context={group.name} backHref={view==="overview"?`/groups/${groupId}/cycles`:base} backLabel={view==="overview"?"Các kỳ":"Quyết toán"}/>
    <div className="space-y-1"><p className="font-medium">{formatDateDMY(selected.periodStart)} – trước {formatDateDMY(selected.periodEnd)}</p>
      <p className="app-caption">{locked?"Đã chốt số liệu":selected.state==="review"?"Chờ kiểm tra":"Đang mở"}</p></div>
    {view==="overview"&&<>
      {locked&&source?<>
        <section className="app-panel space-y-2"><p className="text-muted-foreground">Còn nợ trong kỳ</p>
          <p className="app-money">{new Intl.NumberFormat("vi-VN").format(BigInt(source.totals.outstandingMinor))} ₫</p>
          <p className="app-caption">{settings.effectiveEnabled?"Quyết toán đã mở cho nhóm":"Quyết toán chưa mở cho nhóm"}</p></section>
        <GroupedList>
          <NavigationRow href={base+"?view=settle"} title="Trả nợ" icon="wallet"/>
          <NavigationRow href={base+"?view=sources"} title="Khoản trong kỳ" value={String(source.totals.sourceCount)} icon="groups"/>
          <NavigationRow href={base+"?view=check&panel=disputes"} title="Trao đổi về khoản nợ" icon="bell"/>
          <NavigationRow href={base+"?view=check"} title="Tổng kết & lịch sử" icon="calendar"/>
          <NavigationRow href={base+"?view=snapshot"} title="Số liệu lúc chốt"/>
          {settings.canManage&&<NavigationRow href={base+"?view=late"} title="Khoản nhập muộn"/>}
        </GroupedList>
      </>:selected.state==="review"?<section className="app-panel space-y-4">
        <h2 className="text-xl font-semibold">Kiểm tra số liệu</h2>
        <SettlementSnapshotPanel groupId={groupId} cycleId={cycleId} version={selected.version} canManage={settings.canManage&&settings.requestedEnabled} locked={false}/>
      </section>:<ActionLink href={`/groups/${groupId}`}>Xem khoản chi</ActionLink>}
      {settings.canManage&&<ActionLink secondary href={`/groups/${groupId}/manage?section=periods`}>Quản lý kỳ</ActionLink>}
    </>}
    {locked&&view==="sources"&&source&&<SettlementCycleSourceList groupId={groupId} cycleId={cycleId} source={source} members={[...people,{id:user.id,name:me}]}/>}
    {locked&&view==="settle"&&<>
      <SegmentedNav label="Cách trả nợ" items={[{href:base+"?view=settle",label:"Bù nợ",active:mode==="bilateral"},{href:base+"?view=settle&mode=cash",label:"Trả tiền",active:mode==="cash"}]}/>
      <SettlementCycleFinancePanel groupId={groupId} cycleId={cycleId} currentUserId={user.id} currentUserName={me} counterparts={people}
        requestedEnabled={settings.requestedEnabled} bilateralEnabled={settings.requestedBilateralNetting} financialEngineEnabled={settings.effectiveEnabled} mode={mode}/>
    </>}
    {locked&&view==="check"&&source&&<>
      <SegmentedNav label="Kiểm tra kỳ" items={[{href:base+"?view=check",label:"Tổng kết",active:panel==="report"},{href:base+"?view=check&panel=disputes",label:"Trao đổi",active:panel==="disputes"},{href:base+"?view=check&panel=history",label:"Lịch sử",active:panel==="history"}]}/>
      <SettlementCycleOpsPanel groupId={groupId} cycleId={cycleId} userId={user.id} visibleSources={source.lines} members={[...people,{id:user.id,name:me}]} view={panel}/>
      {panel==="disputes"&&source.totalPages>1&&<nav aria-label="Trang khoản nợ" className="flex flex-wrap items-center justify-between gap-3">
        <span className="app-caption">Trang {source.page}/{source.totalPages}</span>
        <div className="flex gap-2">
          {source.page>1&&<Link className="app-action app-action-secondary" href={`${base}?view=check&panel=disputes&page=${source.page-1}`}>Trước</Link>}
          {source.page<source.totalPages&&<Link className="app-action app-action-secondary" href={`${base}?view=check&panel=disputes&page=${source.page+1}`}>Tiếp</Link>}
        </div>
      </nav>}
    </>}
    {locked&&view==="snapshot"&&<section className="app-panel"><SettlementSnapshotPanel groupId={groupId} cycleId={cycleId} version={selected.version} canManage={false} locked/></section>}
    {locked&&view==="late"&&settings.canManage&&<SettlementLateInvoicePanel groupId={groupId} originCycleId={cycleId} canManage requestedEnabled={settings.requestedEnabled}/>}
  </main>;
}
