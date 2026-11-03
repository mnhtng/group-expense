import type { MetadataRoute } from "next";

/** PWA manifest. Service worker handles pushes; financial pages are never cached. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Group Expense",
    short_name: "Group Expense",
    description: "Quản lý chi tiêu nhóm, chia tiền và theo dõi công nợ.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    background_color: "#ffffff",
    theme_color: "#315e50",
    lang: "vi",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
    shortcuts: [
      { name: "Công nợ", short_name: "Công nợ", url: "/debts" },
      { name: "Thông báo", short_name: "Thông báo", url: "/activity" },
    ],
  };
}
