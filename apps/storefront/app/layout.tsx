import "./globals.css";
import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Header from "./components/Header";
import FooterNewsletter from "./components/FooterNewsletter";
import { apiInternal } from "@/lib/api";

/* Self-hosted at build time (no runtime third-party request, no layout shift). Exposed as
   --font-sans, which tailwind.config.ts maps to `sans`, so Tailwind's preflight applies it to
   the document. `display: "swap"` keeps text visible while it loads. */
const inter = Inter({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-sans", display: "swap" });

/* Where absolute URLs (og:image) resolve against. Override with NEXT_PUBLIC_SITE_URL in a real
   deployment; the default matches the local stack (.env DOMAIN_STORE). */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://shop.rfo.localhost";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "RFO Store",
  description: "Certified refurbished, delivered across AU & NZ",
  openGraph: {
    title: "RFO Store",
    description: "Certified refurbished, delivered across AU & NZ",
    siteName: "RFO Store",
    type: "website",
    locale: "en_AU",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { themeColor: "#059669" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  let promo: string | null = null;
  try {
    const p: any[] = await apiInternal("/store/promotions", 60);
    if (p.length) { promo = p[0].name + (p[0].kind === "percent" ? " - " + p[0].value + "% off" : ""); }
  } catch { void 0; }
  return (
    <html lang="en-AU" className={inter.variable}>
      <body className="bg-surface-muted text-ink-900 min-h-screen flex flex-col">
        <Header />
        {promo && (<div className="bg-brand-700 text-white text-xs px-6 py-1.5 text-center">{promo}</div>)}
        <div className="flex-1">{children}</div>
        <footer className="bg-ink-900 text-ink-300 mt-12">
          <div className="max-w-6xl mx-auto px-6 py-8 grid gap-6 md:grid-cols-3 text-sm">
            <div>
              <p className="font-semibold text-white flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-500"></span>RFO Store</p>
              <p className="text-xs text-ink-400 mt-1">Certified refurbished electronics. Every device renewed, graded and tracked - e-waste kept out of landfill.</p>
            </div>
            <div className="text-xs space-y-1">
              <a href="/" className="block transition-colors duration-fast ease-out hover:text-brand-300 motion-reduce:transition-none">Shop</a>
              <a href="/search" className="block transition-colors duration-fast ease-out hover:text-brand-300 motion-reduce:transition-none">Search</a>
              <a href="/assistant" className="block transition-colors duration-fast ease-out hover:text-brand-300 motion-reduce:transition-none">Ask the AI</a>
              <a href="/faq" className="block transition-colors duration-fast ease-out hover:text-brand-300 motion-reduce:transition-none">FAQ</a>
              <a href="/contact" className="block transition-colors duration-fast ease-out hover:text-brand-300 motion-reduce:transition-none">Contact</a>
              <a href="/grades" className="block transition-colors duration-fast ease-out hover:text-brand-300 motion-reduce:transition-none">Our grades A-D</a>
              <a href="/returns" className="block transition-colors duration-fast ease-out hover:text-brand-300 motion-reduce:transition-none">Returns &amp; warranty</a>
            </div>
            <div className="text-xs text-ink-400">
              <p>Prices in AUD incl. applicable GST (AU 10% / NZ 15%).</p>
              <p className="mt-1">Serials shown masked for buyer confidence.</p>
            </div>
          </div>
          <div className="max-w-6xl mx-auto px-6 pb-8">
            <FooterNewsletter />
          </div>
        </footer>
      </body>
    </html>
  );
}
