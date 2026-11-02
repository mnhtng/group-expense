import type { MetadataRoute } from "next";

/** Initial manifest; add audited PNG icons and a service worker in Sprint 5. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Group Expense",
    short_name: "Group Expense",
    description: "Quản lý chi tiêu nhóm, chia tiền và theo dõi công nợ.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#315e50",
    lang: "vi",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
