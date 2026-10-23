import type { Metadata } from "next";
import { Archivo_Black, Inter } from "next/font/google";
import { BugsnagBoundary } from "@/components/bugsnag";
import { SessionProvider } from "@/components/session";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
// Heavy, wide face for the SASH wordmark in the logo.
const brand = Archivo_Black({ variable: "--font-brand", weight: "400", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "SASH", template: "%s · SASH" },
  description: "Detects order quantity changes between uploaded supplier requirement files.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${brand.variable} h-full`}>
      <body className="min-h-full">
        <BugsnagBoundary><SessionProvider>{children}</SessionProvider></BugsnagBoundary>
      </body>
    </html>
  );
}
