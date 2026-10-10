"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { API, aud } from "@/lib/api";
import { cartGet } from "@/lib/cart";

type SItem = { slug: string; title: string; units_available: number; price_from_cents: number | null };

export default function Header() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<SItem[]>([]);
  const [open, setOpen] = useState(false);
  const [cartN, setCartN] = useState(0);
  const [cats, setCats] = useState<{ name: string; n: number }[]>([]);
  const router = useRouter();
  const pathname = usePathname();
  const timer = useRef<any>(null);

  useEffect(() => { setCartN(cartGet().length); }, [pathname]);
  useEffect(() => {
    (async () => {
      try { const r = await fetch(API + "/store/categories", { cache: "no-store" }); if (r.ok) { setCats(await r.json()); } } catch { void 0; }
    })();
  }, []);
  useEffect(() => {
    const h = () => setCartN(cartGet().length);
    window.addEventListener("rfocart", h);
    return () => window.removeEventListener("rfocart", h);
  }, []);

  function onChange(v: string) {
    setQ(v); setOpen(false);
    if (timer.current) { clearTimeout(timer.current); }
    if (v.trim().length < 2) { setItems([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(API + "/store/search?q=" + encodeURIComponent(v.trim()), { cache: "no-store" });
        if (r.ok) { setItems(await r.json()); setOpen(true); }
      } catch { void 0; }
    }, 300);
  }

  return (
    <header className="sticky top-0 z-50">
      <div className="bg-emerald-700 text-white text-xs px-6 py-1.5 text-center">Renewed tech. Zero waste. - Certified refurbished, delivered AU &amp; NZ</div>
      <div className="bg-white text-slate-900 px-4 md:px-6 py-3 flex items-center gap-4 ring-1 ring-slate-200">
        <a href="/" className="flex items-center gap-1.5 font-semibold tracking-wide shrink-0">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-600"></span>
          RFO<span className="text-emerald-700">Store</span>
        </a>
        <nav className="hidden md:flex gap-4 text-sm text-slate-600">
          <a href="/" className="hover:text-emerald-700">Shop</a>
{cats.slice(0, 6).map((c) => (
            <a key={c.name} href={"/category/" + encodeURIComponent(c.name)} className="hover:text-emerald-700">{c.name}</a>
          ))}
{cats.slice(0, 6).map((c) => (
            <a key={c.name} href={"/category/" + encodeURIComponent(c.name)} className="hover:text-emerald-700">{c.name}</a>
          ))}
                    <a href="/assistant" className="hover:text-emerald-700">Ask AI</a>
        </nav>
        <div className="relative flex-1 max-w-xl mx-auto">
          <input className="w-full rounded-xl bg-slate-50 text-slate-900 placeholder-slate-400 px-4 py-2 text-sm outline-none ring-1 ring-slate-300 focus:ring-emerald-500"
            placeholder="Search devices - e.g. galaxy s21"
            value={q} onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && q.trim().length >= 2) { setOpen(false); router.push("/search?q=" + encodeURIComponent(q.trim())); } }}
            onBlur={() => setTimeout(() => setOpen(false), 150)} />
          {open && items.length > 0 && (
            <div className="absolute left-0 right-0 mt-1 bg-white text-slate-900 rounded-xl shadow-lg ring-1 ring-slate-200 overflow-hidden">
              {items.slice(0, 5).map((s) => (
                <button key={s.slug} className="w-full text-left px-4 py-2.5 hover:bg-emerald-50 text-sm"
                  onMouseDown={() => router.push("/products/" + s.slug)}>
                  <span className="font-medium">{s.title}</span>
                  <span className="text-xs text-slate-500 ml-2">{s.units_available} available{s.price_from_cents !== null ? " from " + aud(s.price_from_cents) : ""}</span>
                </button>
              ))}
              <button className="w-full text-left px-4 py-2 text-xs bg-slate-50 text-emerald-700"
                onMouseDown={() => router.push("/search?q=" + encodeURIComponent(q.trim()))}>See all results</button>
            </div>
          )}
        </div>
        <a href="/cart" className="relative shrink-0 rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm font-medium hover:bg-emerald-500">
          Cart{cartN > 0 && (<span className="absolute -top-2 -right-2 bg-slate-900 text-emerald-300 text-[10px] font-bold rounded-full h-5 w-5 flex items-center justify-center">{cartN}</span>)}
        </a>
      </div>
    </header>
  );
}