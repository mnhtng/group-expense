import { NotificationInbox } from "@/components/notifications/notification-inbox";
export default function ActivityPage(){
  return <main className="app-page space-y-5">
    <header className="space-y-2">
      <h1 className="text-2xl font-semibold">Thông báo</h1>
      <p className="text-sm text-muted-foreground">Yêu cầu xác nhận, kết quả thanh toán và lịch sử chưa đọc.</p>
    </header>
    <NotificationInbox/>
  </main>;
}
