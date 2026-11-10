import {PageHeader} from "@/components/ui/app-screen";
import { NotificationInbox } from "@/components/notifications/notification-inbox";
export default function ActivityPage(){
  return <main className="app-page space-y-5">
    <PageHeader title="Thông báo"/>
    <NotificationInbox/>
  </main>;
}
