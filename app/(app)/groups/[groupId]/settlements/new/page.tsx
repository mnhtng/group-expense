import {PageHeader} from "@/components/ui/app-screen";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getGroupDetails } from "@/lib/groups/service";
import { listGroupDebts } from "@/lib/debts/service";
import { BatchSettlementForm } from "@/components/settlements/batch-settlement-form";

export default async function NewSettlementPage({params}:{params:Promise<{groupId:string}>}){
  const {groupId}=await params;
  const user=await requireUser();
  const [group,debts]=await Promise.all([
    getGroupDetails(groupId,user.id),listGroupDebts(groupId,user.id),
  ]);
  if(!group||!debts)notFound();
  const pairs=new Map<string,{key:string;label:string;debts:typeof debts}>();
  for(const debt of debts){
    if(![debt.creditorId,debt.debtorId].includes(user.id) || BigInt(debt.availableMinor)<=0n)continue;
    const key=`${debt.debtorId}:${debt.creditorId}`;
    let pair=pairs.get(key);
    if(!pair){
      pair={key,label:`${debt.debtorName} trả ${debt.creditorName}`,debts:[]};
      pairs.set(key,pair);
    }
    pair.debts.push(debt);
  }
  return <main className="app-page space-y-5">
    <PageHeader title="Trả tiền" context={group.name} backHref={`/groups/${groupId}/debts`} backLabel="Công nợ"/>
    <BatchSettlementForm groupId={groupId} pairs={[...pairs.values()]}/>
  </main>;
}
