"use client";

import { useState } from "react";

type Tab = "groups" | "debts" | "activity" | "account";

const sections: Record<Tab, { label: string; title: string; description: string }> = {
  groups: {
    label: "Nhóm",
    title: "Các nhóm chi tiêu",
    description: "Sau khi kết nối tài khoản và cơ sở dữ liệu, các nhóm bạn tham gia sẽ hiển thị tại đây.",
  },
  debts: {
    label: "Công nợ",
    title: "Công nợ của tôi",
    description: "Theo dõi khoản cần thu, cần trả và yêu cầu hoàn trả chờ xác nhận hai chiều.",
  },
  activity: {
    label: "Hoạt động",
    title: "Lịch sử hoạt động",
    description: "Xem lịch sử hóa đơn, thay đổi công nợ và các lần xác nhận hoàn trả.",
  },
  account: {
    label: "Cá nhân",
    title: "Tài khoản",
    description: "Quản lý hồ sơ, thông báo và phiên đăng nhập dài hạn trên thiết bị.",
  },
};

export default function Home() {
  const [tab, setTab] = useState<Tab>("groups");
  const current = sections[tab];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-background text-foreground">
      <header className="border-b border-border px-5 pb-5 pt-[max(env(safe-area-inset-top),1.5rem)]">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Group Expense
        </p>
        <h1 className="mt-3 font-heading text-2xl font-bold">
          Chi tiêu minh bạch, chia tiền dễ dàng
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Ứng dụng web quản lý chi tiêu nhóm, ưu tiên trải nghiệm điện thoại.
        </p>
      </header>

      <section className="flex-1 px-5 py-6" aria-live="polite">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="font-heading text-xl font-semibold">{current.title}</h2>
          <span className="rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground">
            Nền tảng
          </span>
        </div>
        <div className="rounded-3xl border border-dashed border-border bg-card px-6 py-12 text-center shadow-sm">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-secondary text-xl font-semibold">
            {tab === "groups" ? "01" : tab === "debts" ? "02" : tab === "activity" ? "03" : "04"}
          </div>
          <h3 className="mt-5 text-base font-semibold">Chưa có dữ liệu</h3>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
            {current.description}
          </p>
          <p className="mt-5 text-xs text-muted-foreground">
            Đây là giao diện nền tảng; dữ liệu thực và thao tác sẽ được bổ sung theo các sprint.
          </p>
        </div>
      </section>

      <nav
        className="sticky bottom-0 grid grid-cols-4 border-t border-border bg-background/95 px-2 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2 backdrop-blur"
        aria-label="Điều hướng chính"
      >
        {(Object.keys(sections) as Tab[]).map((id) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
            className={[
              "min-h-12 rounded-xl px-1 text-sm font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              tab === id
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-accent",
            ].join(" ")}
          >
            {sections[id].label}
          </button>
        ))}
      </nav>
    </main>
  );
}
