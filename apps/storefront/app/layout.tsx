import "./globals.css";
import type { ReactNode } from "react";
import Header from "./components/Header";
import { apiInternal } from "@/lib/api";

export const metadata = { title: "RFO Store", description: "Certified refurbished, delivered across AU & NZ" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  let promo: string | null = null;
  try {
    const p: any[] = await apiInternal("/store/promotions", 60);
    if (p.length) { promo = p[0].name + (p[0].kind === "percent" ? " - " + p[0].value + "% off" : ""); }
  } catch { void 0; }
  return (
    <html lang="en-AU">
      <body className="bg-[#F8F9FA] text-slate-900 min-h-screen flex flex-col">
        <Header />
        {promo && (<div className="bg-emerald-600 text-white text-xs px-6 py-1.5 text-center">{promo}</div>)}
        <div className="flex-1">{children}</div>
        <footer className="bg-slate-900 text-slate-300 mt-12">
          <div className="max-w-6xl mx-auto px-6 py-8 grid gap-6 md:grid-cols-3 text-sm">
            <div>
              <p className="font-semibold text-white flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500"></span>RFO Store</p>
              <p className="text-xs text-slate-400 mt-1">Certified refurbished electronics. Every device renewed, graded and tracked - e-waste kept out of landfill.</p>
            </div>
            <div className="text-xs space-y-1">
              <a href="/" className="block hover:text-emerald-300">Shop</a>
              <a href="/search" className="block hover:text-emerald-300">Search</a>
              <a href="/assistant" className="block hover:text-emerald-300">Ask the AI</a>
            </div>
            <div className="text-xs text-slate-400">
              <p>Prices in AUD incl. applicable GST (AU 10% / NZ 15%).</p>
              <p className="mt-1">Serials shown masked for buyer confidence.</p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}