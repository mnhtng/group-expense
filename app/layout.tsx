import type { Metadata, Viewport } from "next";
import "./globals.css";
import { InstallBanner } from "@/components/pwa/install-banner";

export const metadata: Metadata = {
  title: "Group Expense",
  description: "Quản lý chi tiêu nhóm, chia tiền và theo dõi công nợ minh bạch.",
  applicationName: "Group Expense",
  appleWebApp: { capable: true, title: "Group Expense", statusBarStyle: "default" },
};

// Safe-area CSS variables apply to standalone PWA on iOS and Android.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="vi"
      className="h-full antialiased font-sans"
    >
      <body className="min-h-full flex flex-col">
        <InstallBanner/>
        {children}
      </body>
    </html>
  );
}
