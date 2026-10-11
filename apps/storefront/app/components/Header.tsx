"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { API, aud } from "@/lib/api";
import { cartGet } from "@/lib/cart";
import { Button, cn, Input, navLinkClass } from "./ui";

type SItem = { slug: string; title: string; units_available: number; price_from_cents: number | null };

export default function Header() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<SItem[]>([]);
  const [open, setOpen] = useState(false);
  const [cartN, setCartN] = useState(0);
  const [cats, setCats] = useState<{ name: string; n: number }[]>([]);
  const [menu, setMenu] = useState(false);
  // Whether there is more category strip off each edge. Only used to fade it, so a missed
  // measurement costs nothing but the cue - it is never a reason to hide a link.
  const [edges, setEdges] = useState({ left: false, right: false });
  const router = useRouter();
  const pathname = usePathname();
  const timer = useRef<any>(null);
  const strip = useRef<HTMLElement | null>(null);

  const measure = useCallback(() => {
    const el = strip.current;
    if (!el) { return; }
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ left: el.scrollLeft > 1, right: max > 1 && el.scrollLeft < max - 1 });
  }, []);

  // Re-measured when the category list lands: the strip is empty on the first paint (the header
  // fetches its categories itself), so the first measurement would always say "nothing to scroll".
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, cats.length]);

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
      <div className="bg-surface-page-alt text-ink-600 border-b border-line text-xs px-6 py-2 text-center tracking-wide">Renewed tech. Zero waste. - Certified refurbished, delivered AU &amp; NZ</div>
      <div className="bg-surface text-ink-900 px-4 md:px-6 py-3 flex items-center gap-2 md:gap-4 shadow-sm">
        <a href="/" className="flex items-center gap-1.5 font-semibold tracking-wide shrink-0">
          <span className="h-2.5 w-2.5 rounded-full bg-brand-600"></span>
          RFO<span className="text-brand-700">Store</span>
        </a>
        {/* Every live category, not the first six: the strip scrolls sideways when it runs out of
            room, and the two edge fades are the only cue that it does (no scrollbar, no arrows -
            the links stay where a nav link is expected). Only the strip scrolls; Shop/FAQ/Ask AI
            stay put at their ends. */}
        <div className="relative hidden md:block min-w-0 flex-1">
          <nav ref={strip} onScroll={measure} aria-label="Categories"
            className="flex gap-4 text-sm text-ink-600 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <a href="/" className={cn("shrink-0", navLinkClass)}>Shop</a>
            {cats.map((c) => (
              <a key={c.name} href={"/category/" + encodeURIComponent(c.name)} className={cn("shrink-0", navLinkClass)}>{c.name}</a>
            ))}
            <a href="/faq" className={cn("shrink-0", navLinkClass)}>FAQ</a>
            <a href="/assistant" className={cn("shrink-0", navLinkClass)}>Ask AI</a>
          </nav>
          {edges.left && (
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-surface to-transparent" />
          )}
          {edges.right && (
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface to-transparent" />
          )}
        </div>
        <div className="relative flex-1 min-w-0 max-w-xl mx-auto">
          <Input tone="sunken"
            placeholder="Search devices - e.g. galaxy s21"
            value={q} onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && q.trim().length >= 2) { setOpen(false); router.push("/search?q=" + encodeURIComponent(q.trim())); } }}
            onBlur={() => setTimeout(() => setOpen(false), 150)} />
          {open && items.length > 0 && (
            <div className="absolute left-0 right-0 mt-1 bg-white text-ink-900 rounded-control shadow-lg ring-1 ring-line overflow-hidden">
              {items.slice(0, 5).map((s) => (
                <button key={s.slug} className="w-full text-left px-4 py-2.5 text-sm transition-colors duration-fast ease-out hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 motion-reduce:transition-none"
                  onMouseDown={() => router.push("/products/" + s.slug)}>
                  <span className="font-medium">{s.title}</span>
                  <span className="text-xs text-ink-500 ml-2">{s.units_available} available{s.price_from_cents !== null ? " from " + aud(s.price_from_cents) : ""}</span>
                </button>
              ))}
              <button className="w-full text-left px-4 py-2 text-xs bg-surface-sunken text-brand-700 transition-colors duration-fast ease-out hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 motion-reduce:transition-none"
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
          className="md:hidden shrink-0 h-11 w-11 flex items-center justify-center rounded-control text-ink-600 transition-colors duration-fast ease-out hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 motion-reduce:transition-none">
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
          <a href="/" className={cn("py-3", navLinkClass)} onClick={() => setMenu(false)}>Shop</a>
          {cats.map((c) => (
            <a key={c.name} href={"/category/" + encodeURIComponent(c.name)} className={cn("py-3", navLinkClass)} onClick={() => setMenu(false)}>{c.name}</a>
          ))}
          <a href="/faq" className={cn("py-3", navLinkClass)} onClick={() => setMenu(false)}>FAQ</a>
          <a href="/assistant" className={cn("py-3", navLinkClass)} onClick={() => setMenu(false)}>Ask AI</a>
        </nav>
      )}
    </header>
  );
}
