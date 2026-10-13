import "./globals.css";
import type { ReactNode } from "react";
import { Inter, Space_Grotesk } from "next/font/google";

export const metadata = { title: "RFO Backoffice", description: "RFO staff portal" };

/* The same two faces the storefront loads, at the same weights, exposed as the same two CSS
   variables that tailwind.config.ts maps to `sans`/`display`. This app previously loaded no
   webfont, so every screen rendered in the operating system's UI font and the staff portal and
   the shop looked like two different products.

   Both are self-hosted at build time by next/font/google - no runtime third-party request, no
   layout shift - and `display: "swap"` keeps text visible while either loads. Inter carries body
   copy, table data and controls; Space Grotesk is the display face and reaches only the Heading
   primitive. */
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans", display: "swap" });
const grotesk = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display", display: "swap" });

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-AU" className={inter.variable + " " + grotesk.variable}>
      <body className="bg-surface-sunken min-h-screen text-ink-900 antialiased">{children}</body>
    </html>
  );
}
