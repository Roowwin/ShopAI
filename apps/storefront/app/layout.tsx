import "./globals.css";
import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import Header from "./components/Header";
import FooterNewsletter from "./components/FooterNewsletter";
import { navLinkClass } from "./components/ui";

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
   build time, outside any stylesheet - it has to be kept in step with the palette by hand, and it
   moved with it.

   It mirrors `--surface-page` (#F5F7FA) rather than the brand, and that is a change of answer: on
   the dark ground this was the forest fill, so the chrome read as a bar across the top of the page.
   The header is transparent now, so the chrome should dissolve into the canvas it sits above
   instead of drawing a line the design deliberately does not have. */
export const viewport: Viewport = { themeColor: "#F5F7FA" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-AU" className={inter.variable + " " + grotesk.variable}>
      <body className="bg-surface-page text-ink-900 min-h-screen flex flex-col">
        <Header />
        {/* The promo band that sat here is gone, and with it the layout's only reason to read
            /store/promotions - the homepage had already stopped showing an offer when its hero was
            removed. A live promotion is still reachable: the product page prints "Sale event: ..."
            under the title. Nothing else on the shop renders one. */}
        <div className="flex-1">{children}</div>
        <footer className="bg-surface-deep text-ink-500 mt-12">
          {/* SMALL AND CLEAN, which here means FEWER ROWS rather than less content. The footer was a
              three-column grid of eight-unit gaps: the identity in one column, the seven links
              STACKED in another (which is what made the band tall), and two legal notes in a third.
              The links are a horizontal row now, so the band is three short lines instead of one
              tall block - same links, same note, same newsletter, a third of the height.

              THE LEGAL LINE IS A STRIP rather than a column, and it moved to `ink-500`. It used
              `ink-400`, which measures 4.44:1 on this soft-green band - just under the 4.5:1 bar,
              and the one place in the footer where the muted step landed on the tinted fill rather
              than on the page. */}
          <div className="max-w-6xl mx-auto px-6 py-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-ink-900 flex items-center gap-1.5 text-sm">
                  <span className="h-2 w-2 rounded-full bg-brand-500"></span>RFO Store
                </p>
                <p className="text-xs mt-0.5">Certified refurbished electronics - renewed, graded and tracked.</p>
              </div>
              <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
                <a href="/" className={navLinkClass}>Shop</a>
                <a href="/search" className={navLinkClass}>Search</a>
                <a href="/assistant" className={navLinkClass}>Ask the AI</a>
                <a href="/faq" className={navLinkClass}>FAQ</a>
                <a href="/contact" className={navLinkClass}>Contact</a>
                <a href="/grades" className={navLinkClass}>Our grades A-D</a>
                <a href="/returns" className={navLinkClass}>Returns &amp; warranty</a>
              </nav>
            </div>
            <div className="mt-5">
              <FooterNewsletter />
            </div>
          </div>
          <div className="border-t border-line">
            <p className="max-w-6xl mx-auto px-6 py-3 text-[11px]">
              Prices in AUD incl. applicable GST (AU 10% / NZ 15%). Serials are shown masked for buyer confidence.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
