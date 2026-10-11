"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { API, aud } from "@/lib/api";
import { cartGet } from "@/lib/cart";
import { Button, Input } from "./ui";

type SItem = { slug: string; title: string; units_available: number; price_from_cents: number | null };

export default function Header() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<SItem[]>([]);
  const [open, setOpen] = useState(false);
  const [cartN, setCartN] = useState(0);
  const [cats, setCats] = useState<{ name: string; n: number }[]>([]);
  const [menu, setMenu] = useState(false);
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
      <div className="bg-brand-700 text-white text-xs px-6 py-1.5 text-center">Renewed tech. Zero waste. - Certified refurbished, delivered AU &amp; NZ</div>
      <div className="bg-white text-ink-900 px-4 md:px-6 py-3 flex items-center gap-2 md:gap-4 ring-1 ring-line">
        <a href="/" className="flex items-center gap-1.5 font-semibold tracking-wide shrink-0">
          <span className="h-2.5 w-2.5 rounded-full bg-brand-600"></span>
          RFO<span className="text-brand-700">Store</span>
        </a>
        <nav className="hidden md:flex gap-4 text-sm text-ink-600">
          <a href="/" className="hover:text-brand-700">Shop</a>
          {cats.slice(0, 6).map((c) => (
            <a key={c.name} href={"/category/" + encodeURIComponent(c.name)} className="hover:text-brand-700">{c.name}</a>
          ))}
          <a href="/faq" className="hover:text-brand-700">FAQ</a>
                    <a href="/assistant" className="hover:text-brand-700">Ask AI</a>
        </nav>
        <div className="relative flex-1 min-w-0 max-w-xl mx-auto">
          <Input tone="sunken"
            placeholder="Search devices - e.g. galaxy s21"
            value={q} onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && q.trim().length >= 2) { setOpen(false); router.push("/search?q=" + encodeURIComponent(q.trim())); } }}
            onBlur={() => setTimeout(() => setOpen(false), 150)} />
          {open && items.length > 0 && (
            <div className="absolute left-0 right-0 mt-1 bg-white text-ink-900 rounded-control shadow-lg ring-1 ring-line overflow-hidden">
              {items.slice(0, 5).map((s) => (
                <button key={s.slug} className="w-full text-left px-4 py-2.5 hover:bg-brand-50 text-sm"
                  onMouseDown={() => router.push("/products/" + s.slug)}>
                  <span className="font-medium">{s.title}</span>
                  <span className="text-xs text-ink-500 ml-2">{s.units_available} available{s.price_from_cents !== null ? " from " + aud(s.price_from_cents) : ""}</span>
                </button>
              ))}
              <button className="w-full text-left px-4 py-2 text-xs bg-surface-sunken text-brand-700"
                onMouseDown={() => router.push("/search?q=" + encodeURIComponent(q.trim()))}>See all results</button>
            </div>
          )}
        </div>
        <Button href="/cart" className="relative shrink-0">
          Cart{cartN > 0 && (<span className="absolute -top-2 -right-2 bg-ink-900 text-brand-300 text-[10px] font-bold rounded-full h-5 w-5 flex items-center justify-center">{cartN}</span>)}
        </Button>
        <button
          type="button"
          onClick={() => setMenu((v) => !v)}
          aria-label={menu ? "Close menu" : "Open menu"}
          aria-expanded={menu}
          className="md:hidden shrink-0 h-11 w-11 flex items-center justify-center rounded-control text-ink-600 hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            {menu
              ? (<><path d="M5 5l10 10" /><path d="M15 5L5 15" /></>)
              : (<><path d="M3 6h14" /><path d="M3 10h14" /><path d="M3 14h14" /></>)}
          </svg>
        </button>
      </div>
      {/* The category nav is hidden below md, and there was no way to reach it on a phone. */}
      {menu && (
        <nav className="md:hidden bg-white ring-1 ring-line border-t border-line px-4 py-1 flex flex-col text-sm text-ink-600">
          <a href="/" className="py-3 hover:text-brand-700" onClick={() => setMenu(false)}>Shop</a>
          {cats.slice(0, 6).map((c) => (
            <a key={c.name} href={"/category/" + encodeURIComponent(c.name)} className="py-3 hover:text-brand-700" onClick={() => setMenu(false)}>{c.name}</a>
          ))}
          <a href="/faq" className="py-3 hover:text-brand-700" onClick={() => setMenu(false)}>FAQ</a>
          <a href="/assistant" className="py-3 hover:text-brand-700" onClick={() => setMenu(false)}>Ask AI</a>
        </nav>
      )}
    </header>
  );
}
