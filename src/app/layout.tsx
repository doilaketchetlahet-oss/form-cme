import type { Metadata } from "next";
import { Be_Vietnam_Pro, Geist } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

const beVietnamPro = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  variable: "--font-display",
  weight: ["600", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: "Form CME - Đăng ký & Check-in",
  description: "Form đăng ký, QR check-in, dashboard khách tham dự và face check-in VIP cho sự kiện CME.",
  metadataBase: new URL("https://form-cme.local"),
  openGraph: {
    title: "Form CME",
    description: "Form đăng ký, QR check-in, dashboard khách tham dự và face check-in VIP.",
    url: "https://form-cme.local",
    siteName: "Form CME",
    locale: "vi_VN",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={cn(beVietnamPro.variable, "font-sans", geist.variable)}>
      <body>{children}</body>
    </html>
  );
}
