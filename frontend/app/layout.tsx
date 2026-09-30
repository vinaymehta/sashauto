import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SessionProvider } from "@/components/session";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Order Change Tracker", template: "%s · Order Change Tracker" },
  description: "Detects order quantity changes between uploaded supplier requirement files.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
