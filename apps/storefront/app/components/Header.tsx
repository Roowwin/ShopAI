"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { API, aud } from "@/lib/api";
import { cartGet } from "@/lib/cart";
import NavDropdown, { type NavLink } from "./NavDropdown";
import { childrenOf, parentOf, shortcutHref, shortcutsFor } from "./navMenu";
import { Button, cn, Input, navLinkClass } from "./ui";

type SItem = { slug: string; title: string; units_available: number; price_from_cents: number | null };

/* A category as the menu wants it: its own page, plus the curated sub-categories when there are any.
   navMenu.ts is the curated half - the categories themselves are the API's, and this only hangs a
   second level off them, so a category with no entry there stays a single link. */
/* One category as the menu wants it: its own page, plus the second level when it has one - the
   sub-CATEGORIES filed under it (a real page each, from navMenu's curated table) followed by its
   search shortcuts (a filtered view of the same page). A category with neither stays a single link.

   The order matters: the things that are genuinely different shops come first, and the filters on
   this one come after them, so the fly-out reads as "here is what is inside" before "here is a slice
   of it". */
function catLink(c: { name: string }): NavLink {
  const href = "/category/" + encodeURIComponent(c.name);
  const children: { href: string; label: string }[] = [
    ...childrenOf(c.name).map((name) => ({ href: "/category/" + encodeURIComponent(name), label: name })),
    ...(shortcutsFor(c.name) ?? []).map((s) => ({ href: shortcutHref(c.name, s.term), label: s.label })),
  ];
  return children.length ? { href, label: c.name, children } : { href, label: c.name };
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

  /* ONE BAND NOW. The announcement strip above the control row is gone, so the header is a single
     row of chrome - wordmark, search, cart - and the page begins immediately under it. The tagline
     it carried ("Renewed tech. Zero waste. - Certified refurbished, delivered AU & NZ") is not
     reprinted anywhere else: the footer's own sentence is a different one, and the homepage's
     sr-only h1 uses only the second half of this one. */
  return (
    <header className="sticky top-0 z-50">
      {/* FLOATING, NOT A BAR. The header carries no fill of its own - a backdrop blur over a single
          hairline - so the canvas reads all the way up to the top edge and the chrome sits ON the
          page rather than across it.

          IT MATCHED THE FOOTER FOR ONE PASS, AND THAT WAS UNDONE. Both were `bg-surface-deep`, so
          the page opened and closed on one colour; the owner prefers the open top. Two things worth
          knowing before trying it again: an opaque fill defeats the blur entirely (a backdrop blur
          only does anything under a TRANSLUCENT fill, so keeping both is paying for a compositor
          read-back that shows nothing), and it makes the header a solid band the page then has to
          sit under rather than a layer the page runs beneath.

          `sticky` stays - a catalog is long, and the search and the cart have to be reachable from
          the bottom of it - and the blur is what keeps the nav legible when the catalogue scrolls
          underneath it. */}
      <div className="backdrop-blur-md border-b border-line text-ink-900 px-4 md:px-6 py-2 flex items-center gap-2 md:gap-3">
        {/* The left and right groups both take `flex-1`, which is what actually CENTRES the search:
            two equal-grow flanks around it put the field on the page's centre line whatever the
            wordmark and the controls measure. */}
        <div className="flex items-center gap-1 md:gap-2 flex-1 min-w-0">
        {/* The wordmark is a link home on every route, so it needs the same visible focus ring as
            the rest of the chrome - it had none, which made it the one control in the header a
            keyboard user could land on without seeing where they were. */}
        <a href="/" className="flex items-center gap-1.5 font-semibold tracking-wide shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2">
          <span className="h-2.5 w-2.5 rounded-full bg-brand-500"></span>
          RFO<span className="text-brand-300">Store</span>
        </a>
        {/* The centre group: [Shop v | FAQ | Ask AI], per the owner's brief of 2026-10-12. This
            REPLACES the sideways-scrolling category strip job 17 put here, whose whole point was
            that no category could be hidden. The menu is a deliberate replacement rather than a fix
            - and what it keeps of that rule is reach: every live category is one click away, read
            from the API rather than hardcoded, so a category added to the catalog turns up here
            without a code change. Below md this group is hidden and the burger drawer, which
            already lists the same links, is the way in. */}
        <div className="hidden md:flex items-center gap-1 shrink-0">
          {/* THE FIRST ROW IS "All products", NOT "Shop". It used to carry the trigger's own word,
              so the panel opened on "Shop" directly under a button reading "Shop" - which reads as
              the menu repeating itself rather than as the destination it is: the catalogue, whole,
              with its filter bar. The row stays because "show me everything" is a real thing to
              want next to a list of categories; only the label was wrong. */}
          <NavDropdown label="Shop" open={shop} onOpenChange={setShop}
            links={[{ href: "/", label: "All products" },
                    /* Only the TOP-LEVEL categories. A category filed under another is rendered
                       inside it (see catLink), so without this filter the menu lists "RAM (Memory)"
                       as a sibling of "Parts" and again underneath it. */
                    ...cats.filter((c) => !parentOf(c.name)).map(catLink)]} />
          <a href="/faq" className={cn("inline-flex items-center min-h-[44px] px-3 text-sm", navLinkClass)}>FAQ</a>
          <a href="/assistant" className={cn("inline-flex items-center min-h-[44px] px-3 text-sm", navLinkClass)}>Ask AI</a>
          {/* The way into the account, and the only one: it is where a shopper finds the orders they
              have placed, and the confirmation links themselves are unguessable so they are not a
              navigable destination. */}
          <a href="/account" className={cn("inline-flex items-center min-h-[44px] px-3 text-sm", navLinkClass)}>Account</a>
        </div>
        </div>
        <div className="relative w-full max-w-xl shrink-0">
          <Input tone="sunken"
            aria-label="Search devices"
            placeholder="Search devices - e.g. galaxy s21"
            value={q} onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && q.trim().length >= 2) { setOpen(false); router.push("/search?q=" + encodeURIComponent(q.trim())); } }}
            onBlur={() => setTimeout(() => setOpen(false), 150)} />
          {open && items.length > 0 && (
            <div className="absolute left-0 right-0 mt-1 bg-surface/95 backdrop-blur-md text-ink-900 rounded-control ring-1 ring-line overflow-hidden">
              {items.slice(0, 5).map((s) => (
                <button key={s.slug} className="w-full text-left px-4 py-2.5 text-sm transition-colors duration-fast ease-out hover:bg-surface-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-inset motion-reduce:transition-none"
                  onMouseDown={() => router.push("/products/" + s.slug)}>
                  <span className="font-medium">{s.title}</span>
                  <span className="text-xs text-ink-500 ml-2">{s.units_available} available{s.price_from_cents !== null ? " from " + aud(s.price_from_cents) : ""}</span>
                </button>
              ))}
              <button className="w-full text-left px-4 py-2 text-xs bg-surface text-brand-300 transition-colors duration-fast ease-out hover:bg-surface-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-inset motion-reduce:transition-none"
                onMouseDown={() => router.push("/search?q=" + encodeURIComponent(q.trim()))}>See all results</button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-1 justify-end">
        <Button href="/cart" className="relative shrink-0">
          {/* The count badge is the one place that keeps a raw 10px: it is a single digit centred in
              a 20px circle, and the `eyebrow` step (11px + 0.1em tracking) crowds it and shifts the
              digit off centre on one character. Deliberate, not a missed sweep.

              ITS FILL IS DARK, and that is a fix rather than a preference - it does NOT go back with
              the header. It was `bg-surface-deep` with `text-brand-300`, which on the old palette
              was a near-black bubble with light text. `surface-deep` is a soft green on this ground,
              so the badge had quietly become a pale chip on the emerald button it hangs off - and
              that is true whatever the header is doing, because the button it sits on has not
              changed. It is dark again, which is what it always meant to be: the one chip on the
              page whose job is to be noticed. */}
          Cart{cartN > 0 && (<span className="absolute -top-2 -right-2 bg-ink-900 text-white text-[10px] font-bold rounded-full h-5 w-5 flex items-center justify-center">{cartN}</span>)}
        </Button>
        <button
          type="button"
          onClick={() => setMenu((v) => !v)}
          aria-label={menu ? "Close menu" : "Open menu"}
          aria-expanded={menu}
          className="md:hidden shrink-0 h-11 w-11 flex items-center justify-center rounded-control text-ink-600 transition-colors duration-fast ease-out hover:bg-surface-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 motion-reduce:transition-none">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            {menu
              ? (<><path d="M5 5l10 10" /><path d="M15 5L5 15" /></>)
              : (<><path d="M3 6h14" /><path d="M3 10h14" /><path d="M3 14h14" /></>)}
          </svg>
        </button>
        </div>
      </div>
      {/* The category nav is hidden below md, and there was no way to reach it on a phone. */}
      {menu && (
        <nav className="md:hidden bg-surface/95 backdrop-blur-md ring-1 ring-line border-t border-line px-4 py-1 flex flex-col text-sm text-ink-600">
          <a href="/" className={cn("py-3", navLinkClass)} onClick={() => setMenu(false)}>All products</a>
          {/* A category with sub-categories becomes an accordion here, because hover does not exist on
              a phone. The word still goes to the category - a shopper who wants all of Accessories has
              to be able to tap it - and the chevron opens the same shortcuts the desktop fly-out shows,
              so both levels of the menu lead to the same places either way. */}
          {cats.filter((c) => !parentOf(c.name)).map((c) => {
            /* On a phone the second level is an accordion where the desktop has a fly-out, and it
               carries the same two kinds of child: the sub-categories filed under this one (a real
               page each), then its search shortcuts. */
            const kids = [
              ...childrenOf(c.name).map((name) => ({ href: "/category/" + encodeURIComponent(name), label: name })),
              ...(shortcutsFor(c.name) ?? []).map((s) => ({ href: shortcutHref(c.name, s.term), label: s.label })),
            ];
            const isOpen = openCat === c.name;
            return (
              <div key={c.name}>
                <div className="flex items-stretch">
                  <a href={"/category/" + encodeURIComponent(c.name)} className={cn("flex-1 py-3", navLinkClass)}
                    onClick={() => setMenu(false)}>{c.name}</a>
                  {kids.length > 0 && (
                    <button type="button" aria-expanded={isOpen}
                      aria-label={(isOpen ? "Hide " : "Show ") + c.name + " sub-categories"}
                      onClick={() => setOpenCat(isOpen ? null : c.name)}
                      className="w-11 shrink-0 flex items-center justify-center text-ink-600 transition-colors duration-fast ease-out hover:bg-surface-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 motion-reduce:transition-none">
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"
                        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                        className={cn("transition-transform duration-fast ease-out motion-reduce:transition-none", isOpen && "rotate-180")}>
                        <path d="M2 4l3 3 3-3" />
                      </svg>
                    </button>
                  )}
                </div>
                {kids.length > 0 && isOpen && (
                  <ul className="pb-1">
                    {kids.map((k) => (
                      <li key={k.href}>
                        <a href={k.href} className={cn("block py-3 pl-6", navLinkClass)}
                          onClick={() => setMenu(false)}>{k.label}</a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          <a href="/faq" className={cn("py-3", navLinkClass)} onClick={() => setMenu(false)}>FAQ</a>
          <a href="/assistant" className={cn("py-3", navLinkClass)} onClick={() => setMenu(false)}>Ask AI</a>
          <a href="/account" className={cn("py-3", navLinkClass)} onClick={() => setMenu(false)}>Account</a>
        </nav>
      )}
    </header>
  );
}
