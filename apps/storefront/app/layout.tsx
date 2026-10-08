import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "RFO Store", description: "Certified refurbished, delivered across AU & NZ" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-AU">
      <body className="bg-white text-slate-900 min-h-screen flex flex-col">
        <header className="bg-slate-900 text-white px-6 py-3 flex items-center gap-6">
          <a href="/" className="font-semibold">RFO Store</a>
          <a href="/search" className="hover:text-slate-300 text-sm">Search</a>
          <a href="/cart" className="hover:text-slate-300 text-sm ml-auto">Cart</a>
        </header>
        <div className="flex-1">{children}</div>
        <footer className="text-xs text-slate-400 px-6 py-4">Prices in AUD incl. applicable GST (AU 10% / NZ 15%). Serials shown masked for buyer confidence.</footer>
      </body>
    </html>
  );
}
