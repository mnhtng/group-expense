import {CreateGroupForm} from "@/components/groups/create-group-form";
import {PageHeader} from "@/components/ui/app-screen";
export default function NewGroupPage(){
  return <main className="app-page space-y-6">
    <PageHeader title="Tạo nhóm" backHref="/groups" backLabel="Nhóm"/>
    <section className="app-panel"><CreateGroupForm/></section>
  </main>;
}
