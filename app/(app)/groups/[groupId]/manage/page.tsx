import {requireUser} from "@/lib/auth/session";
import {getGroupDetails,getMemberRole,listMembers} from "@/lib/groups/service";
import {getExitEligibility} from "@/lib/groups/membership";
import {GroupMembershipManager} from "@/components/groups/group-membership-manager";
import {GroupRenameForm} from "@/components/groups/group-rename-form";
import {GroupArchiveForm} from "@/components/groups/group-archive-form";
import {GroupInviteForm} from "@/components/groups/group-invite-form";
import {SettlementCycleSettingsPanel} from "@/components/groups/settlement-cycle-settings-panel";
import {SettlementSchedulePanel} from "@/components/groups/settlement-schedule-panel";
import {SettlementCycleLifecyclePanel} from "@/components/groups/settlement-cycle-lifecycle-panel";
import {getSettlementSchedule} from "@/lib/settlement-cycles/schedule";
import {listSettlementCycles} from "@/lib/settlement-cycles/lifecycle";
import {getSettlementSettings} from "@/lib/settlement-cycles/settings";
import {ActionLink,GroupedList,NavigationRow,PageHeader} from "@/components/ui/app-screen";
import {notFound} from "next/navigation";

const titles={members:"Thành viên",rename:"Đổi tên nhóm",invite:"Mời thành viên",cycle:"Cài đặt quyết toán",schedule:"Lịch quyết toán",periods:"Tạo kỳ",archive:"Lưu trữ nhóm"};
type Section=keyof typeof titles;
export default async function ManageGroupPage({params,searchParams}:{
  params:Promise<{groupId:string}>;searchParams:Promise<{invite?:string;section?:string}>;
}){
  const {groupId}=await params,{invite,section:raw}=await searchParams;
  const section=(raw&&Object.hasOwn(titles,raw)?raw:invite?"invite":null) as Section|null;
  const user=await requireUser();
  const role=await getMemberRole(groupId,user.id);if(!role)notFound();
  const [group,members,settings]=await Promise.all([getGroupDetails(groupId,user.id),listMembers(groupId,user.id),getSettlementSettings(groupId,user.id)]);
  if(!group)notFound();
  const canManage=role==="owner"||role==="admin";
  if((section==="rename"||section==="invite")&&!canManage)notFound();
  if(section==="archive"&&role!=="owner")notFound();
  if((section==="cycle"||section==="schedule"||section==="periods")&&!settings.canManage)notFound();
  const base=`/groups/${groupId}`,manage=base+"/manage";
  const eligibility=section==="members"?await getExitEligibility(groupId,user.id):null;
  const schedule=section==="schedule"||section==="periods"?await getSettlementSchedule(groupId,user.id):null;
  const cycles=section==="periods"?await listSettlementCycles(groupId,user.id):null;
  const inviteUrl=invite?`${process.env.BETTER_AUTH_URL??"http://localhost:3000"}/invite/${invite}`:undefined;
  return <main className="app-page space-y-6">
    <PageHeader title={section?titles[section]:"Quản lý nhóm"} context={group.name}
      backHref={section?manage:base} backLabel={section?"Quản lý":"Nhóm"}
      action={section==="members"&&canManage?<ActionLink href={manage+"?section=invite"}>Mời</ActionLink>:undefined}/>
    {!section&&<GroupedList>
      <NavigationRow href={manage+"?section=members"} title="Thành viên" value={String(members.length)} icon="groups"/>
      <NavigationRow href={base+"/cycles"} title="Quyết toán" icon="wallet"/>
      <NavigationRow href={base+"/recurring"} title="Chi cố định" icon="repeat"/>
      {settings.canManage&&<NavigationRow href={manage+"?section=cycle"} title="Cài đặt quyết toán" icon="calendar"/>}
      {canManage&&<NavigationRow href={manage+"?section=rename"} title="Thông tin nhóm" icon="settings"/>}
    </GroupedList>}
    {section==="members"&&eligibility&&<GroupMembershipManager groupId={groupId} userId={user.id} role={role} members={members} eligibility={eligibility}/>}
    {section==="rename"&&<>
      <section className="app-panel"><GroupRenameForm groupId={groupId} initialName={group.name}/></section>
      {role==="owner"&&<GroupedList><NavigationRow href={manage+"?section=archive"} title="Lưu trữ nhóm" danger/></GroupedList>}
    </>}
    {section==="invite"&&<section className="app-panel"><GroupInviteForm groupId={groupId} groupName={group.name} initialInviteUrl={inviteUrl}/></section>}
    {section==="cycle"&&<>
      <SettlementCycleSettingsPanel key={`${settings.version}-${settings.managerIds.join(",")}`} groupId={groupId} initial={settings} members={members}/>
      <GroupedList><NavigationRow href={manage+"?section=schedule"} title="Lịch quyết toán"/>
        <NavigationRow href={manage+"?section=periods"} title="Tạo kỳ"/></GroupedList>
    </>}
    {section==="schedule"&&schedule&&<SettlementSchedulePanel key={schedule.version} groupId={groupId} initial={schedule}/>}
    {section==="periods"&&schedule&&cycles&&<SettlementCycleLifecyclePanel groupId={groupId} requestedEnabled={settings.requestedEnabled} schedule={schedule} cycles={cycles.cycles} renderedAt={new Date().toISOString()}/>}
    {section==="archive"&&<section className="app-panel"><GroupArchiveForm groupId={groupId} groupName={group.name}/></section>}
  </main>;
}
