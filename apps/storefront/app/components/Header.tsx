"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { API, aud } from "@/lib/api";
import { cartGet } from "@/lib/cart";
import NavDropdown, { type NavLink } from "./NavDropdown";
import { shortcutHref, shortcutsFor } from "./navMenu";
import { Button, cn, Input, navLinkClass } from "./ui";

type SItem = { slug: string; title: string; units_available: number; price_from_cents: number | null };

/* A category as the menu wants it: its own page, plus the curated sub-categories when there are any.
   navMenu.ts is the curated half - the categories themselves are the API's, and this only hangs a
   second level off them, so a category with no entry there stays a single link. */
function catLink(c: { name: string }): NavLink {
  const href = "/category/" + encodeURIComponent(c.name);
  const sub = shortcutsFor(c.name);
  return sub
    ? { href, label: c.name,
        children: sub.map((s) => ({ href: shortcutHref(c.name, s.term), label: s.label })) }
    : { href, label: c.name };
}

export default function Header() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<SItem[]>([]);
  const [open, setOpen] = useState(false);
  const [cartN, setCartN] = useState(0);
  const [cats, setCats] = useState<{ name: string; n: number }[]>([]);
  const [menu, setMenu] = useState(false);
  // The Shop menu's open state is the header's, not the dropdown's, so opening it is also what
  // closes any other header panel - and a navigation closes it along with the page it opened from.
  const [shop, setShop] = useState(false);
  // Which drawer category is expanded, on a phone - one at a time, and closed by the same navigation
  // that closes everything else.
  const [openCat, setOpenCat] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const timer = useRef<any>(null);

  useEffect(() => { setCartN(cartGet().length); setShop(false); setOpenCat(null); }, [pathname]);
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

  /* Two bands, both tightened: the shape stays (a micro strip over one control row), the height
     comes off the padding. The announcement line is the smallest step this type scale sanctions -
     the eyebrow size, 11px - and keeps its own sentence tracking rather than the eyebrow's 0.1em,
     which is for a two-word kicker. That sentence is copy, not chrome: it is shrunk, never dropped. */
  return (
    <header className="sticky top-0 z-50">
      <div className="bg-surface-page-alt text-ink-600 border-b border-line text-[11px] px-6 py-1 text-center tracking-wide">Renewed tech. Zero waste. - Certified refurbished, delivered AU &amp; NZ</div>
      <div className="bg-surface text-ink-900 px-4 md:px-6 py-2 flex items-center gap-2 md:gap-3 shadow-sm">
        <a href="/" className="flex items-center gap-1.5 font-semibold tracking-wide shrink-0">
          <span className="h-2.5 w-2.5 rounded-full bg-brand-600"></span>
          RFO<span className="text-brand-700">Store</span>
        </a>
        {/* The centre group: [Shop v | FAQ | Ask AI], per the owner's brief of 2026-10-12. This
            REPLACES the sideways-scrolling category strip job 17 put here, whose whole point was
            that no category could be hidden. The menu is a deliberate replacement rather than a fix
            - and what it keeps of that rule is reach: every live category is one click away, read
            from the API rather than hardcoded, so a category added to the catalog turns up here
            without a code change. Below md this group is hidden and the burger drawer, which
            already lists the same links, is the way in. */}
        <div className="hidden md:flex items-center gap-1 shrink-0">
          <NavDropdown label="Shop" open={shop} onOpenChange={setShop}
            links={[{ href: "/", label: "Shop" }, ...cats.map(catLink)]} />
          <a href="/faq" className={cn("inline-flex items-center min-h-[44px] px-3 text-sm", navLinkClass)}>FAQ</a>
          <a href="/assistant" className={cn("inline-flex items-center min-h-[44px] px-3 text-sm", navLinkClass)}>Ask AI</a>
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
          {/* A category with sub-categories becomes an accordion here, because hover does not exist on
              a phone. The word still goes to the category - a shopper who wants all of Accessories has
              to be able to tap it - and the chevron opens the same shortcuts the desktop fly-out shows,
              so both levels of the menu lead to the same places either way. */}
          {cats.map((c) => {
            const sub = shortcutsFor(c.name);
            const isOpen = openCat === c.name;
            return (
              <div key={c.name}>
                <div className="flex items-stretch">
                  <a href={"/category/" + encodeURIComponent(c.name)} className={cn("flex-1 py-3", navLinkClass)}
                    onClick={() => setMenu(false)}>{c.name}</a>
                  {sub && (
                    <button type="button" aria-expanded={isOpen}
                      aria-label={(isOpen ? "Hide " : "Show ") + c.name + " sub-categories"}
                      onClick={() => setOpenCat(isOpen ? null : c.name)}
                      className="w-11 shrink-0 flex items-center justify-center text-ink-500 transition-colors duration-fast ease-out hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 motion-reduce:transition-none">
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"
                        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                        className={cn("transition-transform duration-fast ease-out motion-reduce:transition-none", isOpen && "rotate-180")}>
                        <path d="M2 4l3 3 3-3" />
                      </svg>
                    </button>
                  )}
                </div>
                {sub && isOpen && (
                  <ul className="pb-1">
                    {sub.map((s) => (
                      <li key={s.term}>
                        <a href={shortcutHref(c.name, s.term)} className={cn("block py-3 pl-6", navLinkClass)}
                          onClick={() => setMenu(false)}>{s.label}</a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          <a href="/faq" className={cn("py-3", navLinkClass)} onClick={() => setMenu(false)}>FAQ</a>
          <a href="/assistant" className={cn("py-3", navLinkClass)} onClick={() => setMenu(false)}>Ask AI</a>
        </nav>
      )}
    </header>
  );
}
