import type { Metadata, Viewport } from "next";
import { Big_Shoulders, Schibsted_Grotesk } from "next/font/google";
import { Footer } from "@/components/chrome/Footer";
import { Header } from "@/components/chrome/Header";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

// Big Shoulders has an optical-size axis: at poster sizes it draws its condensed display cut (wood type).
const wood = Big_Shoulders({ subsets: ["latin"], axes: ["opsz"], variable: "--font-wood", display: "swap" });
const text = Schibsted_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-text", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Routed: tour where the fans are dense, not where the cities are big", template: "%s · Routed" },
  description: "Name an artist. An agent reads Qloo's taste graph for the cities where their fans are unusually dense, the rooms those fans go to and the openers they share, routes the dates, and drafts a checked pitch for every venue.",
  openGraph: { type: "website", siteName: "Routed" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { themeColor: "#fbfbf9", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${wood.variable} ${text.variable}`}>
      <body>
        <a href="#main" className="skip">Skip to content</a>
        <Header />
        <main id="main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
