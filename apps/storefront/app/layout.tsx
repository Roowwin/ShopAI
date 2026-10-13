import "./globals.css";
import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import Header from "./components/Header";
import FooterNewsletter from "./components/FooterNewsletter";
import { navLinkClass } from "./components/ui";
import { apiInternal } from "@/lib/api";

/* Both faces are self-hosted at build time by next/font/google (no runtime third-party request,
   no layout shift) and exposed as CSS variables that tailwind.config.ts maps to `sans`/`display`.

   Inter carries all body copy. Space Grotesk is the display face - headings and the hero only -
   and is loaded at the one weight the type scale asks for, so the display treatment is a real
   design decision rather than a second copy of the body font. `display: "swap"` keeps text
   visible while either loads. */
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans", display: "swap" });
const grotesk = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display", display: "swap" });

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

/* The mobile browser chrome colour. A literal rather than a token because Next reads this at
   build time, outside any stylesheet - it mirrors --brand-700 and moved with the palette. */
export const viewport: Viewport = { themeColor: "#245B45" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  let promo: string | null = null;
  try {
    const p: any[] = await apiInternal("/store/promotions", 60);
    if (p.length) { promo = p[0].name + (p[0].kind === "percent" ? " - " + p[0].value + "% off" : ""); }
  } catch { void 0; }
  return (
    <html lang="en-AU" className={inter.variable + " " + grotesk.variable}>
      <body className="bg-surface-page text-ink-900 min-h-screen flex flex-col">
        <Header />
        {/* The promo band and the footer are the two full-bleed strips. They were `bg-ink-900`,
            which was a deliberate dark band under white text on the light ground - and ink-900 is
            now WARM WHITE, so both would have been white on white. `surface-deep` is a fill by
            name and cannot invert into an ink. */}
        {promo && (<div className="bg-surface-deep text-ink-700 text-xs px-6 py-2 text-center tracking-wide">{promo}</div>)}
        <div className="flex-1">{children}</div>
        <footer className="bg-surface-deep text-ink-500 mt-12">
          <div className="max-w-6xl mx-auto px-6 py-8 grid gap-6 md:grid-cols-3 text-sm">
            <div>
              <p className="font-semibold text-ink-900 flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-500"></span>RFO Store</p>
              <p className="text-xs text-ink-400 mt-1">Certified refurbished electronics. Every device renewed, graded and tracked - e-waste kept out of landfill.</p>
            </div>
            <div className="text-xs space-y-1">
              <a href="/" className={"block " + navLinkClass}>Shop</a>
              <a href="/search" className={"block " + navLinkClass}>Search</a>
              <a href="/assistant" className={"block " + navLinkClass}>Ask the AI</a>
              <a href="/faq" className={"block " + navLinkClass}>FAQ</a>
              <a href="/contact" className={"block " + navLinkClass}>Contact</a>
              <a href="/grades" className={"block " + navLinkClass}>Our grades A-D</a>
              <a href="/returns" className={"block " + navLinkClass}>Returns &amp; warranty</a>
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
