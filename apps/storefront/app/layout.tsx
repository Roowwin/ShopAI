import "./globals.css";
import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import Header from "./components/Header";
import FooterNewsletter from "./components/FooterNewsletter";
import PaymentMarks from "./components/PaymentMarks";
import { navLinkClass } from "./components/ui";

/* The links that are about an ORDER rather than about stock, in the order a person reaches for them.
   Static, because a footer is an index and not a feed: every one of these is a page that exists. The
   catalogue is NOT indexed here - the header's Shop menu does that on every page, and a second copy
   in the footer is one more thing to keep in step. */
const HELP: [string, string][] = [
  ["FAQ", "/faq"],
  /* A PLAIN "&" HERE, not `&amp;`: this is a JavaScript string, and an entity is only decoded when
     it is written as JSX text. `["Shipping &amp; delivery", ...]` renders the four characters
     "&amp;" to the shopper, which is how the first version of this footer shipped. */
  ["Shipping & delivery", "/faq"],
  ["Returns & warranty", "/returns"],
  ["Our grades A-D", "/grades"],
  ["Track an order", "/track"],
  ["Contact us", "/contact"],
];

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

export default function RootLayout({ children }: { children: ReactNode }) {
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
          {/* A SMALL FOOTER, ON THREE SHORT ROWS.

              It was four columns - the brand and its blurb, an index of every category, and two
              link lists - which is a directory rather than a footer: it stood taller than the cart
              page it sat under, and the catalogue index inside it duplicated the Shop menu in the
              header. What is left is what a shopper at the bottom of a page actually reaches for:
              the ways to get help, and a way to hear about new stock.

                1. the help links, with the signup beside them
                2. the payment marks, one line
                3. the legal line

              The categories are NOT repeated here any more. The header's Shop menu owns that index
              and is on every page; a second copy in the footer is one more thing to keep in step. */}
          <div className="max-w-6xl mx-auto px-6 py-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <nav aria-label="Help" className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
                {HELP.map(([label, href]) => (
                  <a key={label} href={href} className={navLinkClass}>{label}</a>
                ))}
              </nav>
              {/* Beside the links on a wide screen, under them on a narrow one, and small either
                  way: a field and a button, no label and no sentence. */}
              <FooterNewsletter compact />
            </div>
          </div>
          <div className="border-t border-line">
            <div className="max-w-6xl mx-auto px-6 py-4">
              <PaymentMarks />
              <p className="mt-3 text-[11px]">
                &copy; {new Date().getFullYear()} RFO Store. Prices in AUD incl. applicable GST
                (AU 10% / NZ 15%). Serials are shown masked for buyer confidence.
              </p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
