"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { API, aud } from "@/lib/api";
import { cartGet } from "@/lib/cart";
import NavDropdown, { type NavColumn, type NavLink } from "./NavDropdown";
import { NAV_CHILDREN, childrenOf, parentOf, shortcutHref, shortcutsFor } from "./navMenu";
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
  return { href: "/category/" + encodeURIComponent(c.name), label: c.name };
}

/* THE MEGA MENU'S COLUMNS, in one place: the shop's own categories, grouped by what the things ARE.

   "Devices" is every category that is not filed under another - the top level of `navMenu`'s table.
   "Parts" and "Accessories" are that table's two lists, FILTERED TO WHAT THE CATALOGUE ACTUALLY
   STOCKS: the table also names categories nobody sells (Processors, today), and a menu entry that
   opens an empty grid is worse than a missing one. Nothing here invents a category name - if a
   category is added to the catalogue it appears in "Devices" by itself, and if one is moved between
   the two lists in navMenu it moves here with it. */
function shopColumns(cats: { name: string }[]): NavColumn[] {
  const known = new Set(cats.map((c) => c.name));
  const link = (name: string): NavLink => ({ href: "/category/" + encodeURIComponent(name), label: name });
  return [
    { heading: "Devices", links: cats.filter((c) => !parentOf(c.name)).map((c) => link(c.name)) },
    { heading: "Parts", links: NAV_CHILDREN.Parts.filter((n) => known.has(n)).map(link) },
    { heading: "Accessories", links: NAV_CHILDREN.Accessories.filter((n) => known.has(n)).map(link) },
  ];
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
      <div className="backdrop-blur-md border-b border-line text-ink-900 px-4 md:px-6 py-2 flex flex-wrap md:flex-nowrap items-center gap-2 md:gap-3">
        {/* TWO ROWS ON A PHONE, ONE FROM md UP - which is the one thing about this row that is not
            a matter of taste.

            It was a single line at every width, and below md that line did not work at all: the
            field is `w-full`, so on a phone it measured the whole row. The wordmark and the
            cart/burger sit in the two `flex-1` flanks around it, and with no space left to grow
            into they collapsed to nothing - and because the field's wrapper is `relative` it then
            painted OVER them. A phone showed a search box, and no logo, no cart and no way into
            the menu.

            So the phone reads this row in a different ORDER than it is written: `order-*` puts the
            wordmark and the controls on the first line and the search below them, whole. From md
            up `order-none` restores DOM order - wordmark, field, controls - and `md:flex-nowrap`
            is what stops the field wrapping once it grows to a third of the line instead of all
            of it. */}
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
        {/* The centre group: [Shop v | FAQ], per the owner's brief of 2026-10-12 - and "Ask AI" was
            removed from it on 2026-10-16 at the owner's request, along with every other way into the
            assistant (the homepage's link, the product page's invite band, the cart's empty state
            and the /assistant page itself). This comment used to read "[Shop v | FAQ | Ask AI]" and
            is kept as the record of what the row was.

            This REPLACES the sideways-scrolling category strip job 17 put here, whose whole point was
            that no category could be hidden. The menu is a deliberate replacement rather than a fix
            - and what it keeps of that rule is reach: every live category is one click away, read
            from the API rather than hardcoded, so a category added to the catalog turns up here
            without a code change. Below xl this group is hidden and the burger drawer, which
            already lists the same links, is the way in.

            IT WAS `md` AND THAT WAS A LIE, not a preference. These three links and the wordmark
            measure about 316px together; between md and xl the field took a fixed 576 of the row
            and left the flanks 188 each, so the tail of this group - FAQ and, past it, Account -
            was painted under the field while the burger that could have replaced it was
            `md:hidden`. On a 1024px window the shop had no way into the account at all. At xl the
            row is long enough for all three to fit beside the field with room to spare, and
            everything narrower gets the drawer, which lists the same links plus every category. */}
        <div className="hidden xl:flex items-center gap-1 shrink-0">
          {/* THE FIRST ROW IS "All products", NOT "Shop". It used to carry the trigger's own word,
              so the panel opened on "Shop" directly under a button reading "Shop" - which reads as
              the menu repeating itself rather than as the destination it is: the catalogue, whole,
              with its filter bar. The row stays because "show me everything" is a real thing to
              want next to a list of categories; only the label was wrong. */}
          <NavDropdown label="Shop" open={shop} onOpenChange={setShop}
            columns={shopColumns(cats)} all={{ href: "/", label: "All products" }} />
          <a href="/faq" className={cn("inline-flex items-center min-h-[44px] px-3 text-sm", navLinkClass)}>FAQ</a>
          {/* The way into the account, and the only one: it is where a shopper finds the orders they
              have placed, and the confirmation links themselves are unguessable so they are not a
              navigable destination. */}
          <a href="/account" className={cn("inline-flex items-center min-h-[44px] px-3 text-sm", navLinkClass)}>Account</a>
        </div>
        </div>
        {/* A THIRD OF THE ROW FROM md UP, NOT ALL OF IT. `w-full` is what wraps it onto its own
            line on a phone - 100% of the row cannot fit beside anything else - and from md the
            three parts share the line instead.

            THE FIELD USED TO BE `shrink-0` AT A FIXED `max-w-xl`, which is what took the row apart
            on both sides of this breakpoint: a 576px field that cannot shrink leaves the flanks
            whatever is left over, and at 1024 that was 188px each for a wordmark and a nav that
            need 316. Growing to a third (still capped at the same max-w-xl, so above ~1800 it is
            576px again) means the three always fit, the field keeps the centre line - equal flanks
            around it are still what holds it there - and nothing is ever painted under it. */}
        <div className="relative order-3 w-full md:order-none md:max-w-xl md:flex-1 md:min-w-0">
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
        <div className="flex items-center gap-2 flex-1 justify-end order-2 md:order-none">
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
          className="xl:hidden shrink-0 h-11 w-11 flex items-center justify-center rounded-control text-ink-600 transition-colors duration-fast ease-out hover:bg-surface-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 motion-reduce:transition-none">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            {menu
              ? (<><path d="M5 5l10 10" /><path d="M15 5L5 15" /></>)
              : (<><path d="M3 6h14" /><path d="M3 10h14" /><path d="M3 14h14" /></>)}
          </svg>
        </button>
        </div>
      </div>
      {/* The category nav is hidden below xl, and there was no way to reach it without it - on a
          phone, and until this pass on any window narrower than xl as well. */}
      {menu && (
        <nav className="xl:hidden bg-surface/95 backdrop-blur-md ring-1 ring-line border-t border-line px-4 py-1 flex flex-col text-sm text-ink-600">
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
                    <a href="/account" className={cn("py-3", navLinkClass)} onClick={() => setMenu(false)}>Account</a>
        </nav>
      )}
    </header>
  );
}
