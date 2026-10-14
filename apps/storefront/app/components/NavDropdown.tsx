"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "./ui";

/* The header's Shop menu: a disclosure button and the live category list behind it.

   Deliberately NOT the facet dropdown. A facet SETS A VALUE - it earns listbox/option roles and a
   check on the value in force. A nav menu NAVIGATES: the items are real links, nothing is "in
   force", and roles that describe choosing one of a set would be a lie about what a click does. So
   this is the disclosure pattern itself - a button that reports whether the list is open, and a
   plain list of <a> links under it.

   That settles the keyboard contract, and it differs from the facet panel in exactly one place:
   Tab walks INTO the list and along it (the items are links, so they are in the tab order anyway),
   which means the menu closes when focus leaves it rather than on the first Tab. Escape still
   closes and hands focus back to the button, and the arrows/Home/End move between items for anyone
   who expects a menu to behave like one.

   The panel is `fixed`, placed from the trigger's own rect - the same reason the facet panel is:
   it has to escape the sticky header's clip and stacking context, and it has to clamp itself to the
   window instead of running off an edge or off the bottom of a short screen. */

export type NavLink = { href: string; label: string; children?: { href: string; label: string }[] };

const PANEL_W = 288;   // a nav menu is a list of words - narrower than a facet's option rows
const EDGE = 8;
const GAP = 4;
const MIN_H = 176;     // the height below which we would rather open upwards than shrink
const SUB_DELAY = 200; // how long a fly-out survives the pointer leaving its row

type Box = { w: number; left: number; top: number; bottom: number; maxH: number; flip: boolean };
type SubBox = { w: number; left: number; top: number; maxH: number };

type Props = {
  /** What the button says. A noun, not a value - there is no selection to report. */
  label: string;
  links: NavLink[];
  /** Open state is the header's, so nothing else in the header can be open at the same time. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function NavDropdown({ label, links, open, onOpenChange }: Props) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const items = useRef<(HTMLAnchorElement | null)[]>([]);
  const [box, setBox] = useState<Box>({ w: PANEL_W, left: 0, top: 0, bottom: 0, maxH: 320, flip: false });
  // Whether this opening has already taken focus, so a re-render while open (the panel following a
  // scroll) cannot pull focus back off the item you have tabbed onto.
  const took = useRef(false);
  // The second level: which parent's fly-out is open, where it sits, and what it needs to keep the
  // pointer, the focus and the timers behaving while it follows its row.
  const [sub, setSub] = useState<string | null>(null);
  const [subBox, setSubBox] = useState<SubBox>({ w: PANEL_W, left: 0, top: 0, maxH: 320 });
  const rows = useRef<Record<string, HTMLLIElement | null>>({});
  const arrowBtn = useRef<Record<string, HTMLButtonElement | null>>({});
  const subItems = useRef<Record<string, (HTMLAnchorElement | null)[]>>({});
  const subRef = useRef<string | null>(null);
  const subFocus = useRef(false);
  const closeTimer = useRef<any>(null);
  const id = useId();

  function place() {
    const el = trigger.current;
    if (!el) { return; }
    const r = el.getBoundingClientRect();
    const w = Math.min(PANEL_W, window.innerWidth - 2 * EDGE);
    const below = window.innerHeight - r.bottom - 2 * EDGE;
    const above = r.top - 2 * EDGE;
    // The height is the room the panel actually has, with no floor under it: a panel held taller
    // than the space beneath it runs off the screen, where its links cannot be clicked at all.
    const flip = below < MIN_H && above > below;
    const next: Box = {
      w,
      left: Math.max(EDGE, Math.min(r.left, window.innerWidth - w - EDGE)),
      top: r.bottom + GAP,
      bottom: window.innerHeight - r.top + GAP,
      maxH: Math.max(0, flip ? above : below),
      flip,
    };
    setBox((p) => (p.w === next.w && p.left === next.left && p.top === next.top
      && p.bottom === next.bottom && p.maxH === next.maxH && p.flip === next.flip ? p : next));
  }

  function toggle() {
    if (open) { onOpenChange(false); return; }
    place();
    onOpenChange(true);
  }

  /* ---- the second level ----

     A parent with children opens a fly-out beside its row: on hover, on the arrow button's keyboard
     handler, or (for a keyboard user) by walking to the arrow and pressing Right/Enter. The panel is a
     DOM child of that row even though it is positioned `fixed` outside it, which is what makes the
     pointer crossing the small gap count as "still inside" - so the delay only has to cover a flick
     rather than a deliberate move back to the list. */

  function placeSub(row: HTMLElement | null) {
    if (!row) { return; }
    const r = row.getBoundingClientRect();
    const w = Math.min(PANEL_W, window.innerWidth - 2 * EDGE);
    // Beside the row, or on its other side when that would run off the window - and clamped either
    // way. The height is the room below the row with no floor under it: a fly-out held taller than
    // the space it has runs off the bottom, where its links cannot be clicked at all.
    const beside = r.right + GAP;
    const left = beside + w <= window.innerWidth - EDGE ? beside : r.left - GAP - w;
    const top = Math.max(EDGE, r.top);
    const next: SubBox = {
      w,
      left: Math.max(EDGE, Math.min(left, window.innerWidth - w - EDGE)),
      top,
      maxH: Math.max(0, window.innerHeight - top - 2 * EDGE),
    };
    setSubBox((p) => (p.w === next.w && p.left === next.left && p.top === next.top && p.maxH === next.maxH ? p : next));
  }

  function openSub(href: string, focusFirst = false) {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    subRef.current = href;
    subFocus.current = focusFirst;
    placeSub(rows.current[href]);
    setSub(href);
  }

  function closeSubSoon() {
    if (closeTimer.current) { clearTimeout(closeTimer.current); }
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null; subRef.current = null; setSub(null);
    }, SUB_DELAY);
  }

  function closeSubNow() {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    subRef.current = null;
    setSub(null);
  }

  // Focus lands in the fly-out when the keyboard opened it, and only then - a hover must never steal
  // focus from wherever the shopper was.
  useEffect(() => {
    if (!sub || !subFocus.current) { return; }
    subFocus.current = false;
    subItems.current[sub]?.[0]?.focus({ preventScroll: true });
  }, [sub]);

  function onSubKey(href: string, e: KeyboardEvent<HTMLElement>) {
    if (e.key === "Escape" || e.key === "ArrowLeft") {
      e.preventDefault();
      e.stopPropagation();     // step back one level, not out of the menu
      closeSubNow();
      arrowBtn.current[href]?.focus();
      return;
    }
    const list = subItems.current[href] ?? [];
    if (list.length === 0) { return; }
    const i = list.findIndex((el) => el === document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      list[((i < 0 ? 0 : i) + step + list.length) % list.length]?.focus();
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      list[e.key === "Home" ? 0 : list.length - 1]?.focus();
    }
  }

  useEffect(() => {
    if (!open) { took.current = false; closeSubNow(); return; }
    place();
    // The fly-out follows its row too, and both are re-measured together so they cannot drift apart.
    const onMove = () => {
      place();
      if (subRef.current) { placeSub(rows.current[subRef.current]); }
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  // Its own effect, because the timer outlives the open/close cycle: a mouseleave in the last 200ms
  // before the header unmounts would otherwise fire on a component that is gone.
  useEffect(() => () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);

  useEffect(() => {
    if (!open) { return; }
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) { onOpenChange(false); }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onOpenChange]);

  // Opening lands focus on the first link, which is what makes Tab walk straight into the list and
  // what makes a screen reader announce the menu's contents rather than only its label.
  useEffect(() => {
    if (!open || took.current) { return; }
    took.current = true;
    items.current[0]?.focus({ preventScroll: true });
  }, [open]);

  function onKey(e: KeyboardEvent<HTMLElement>) {
    const n = links.length;
    if (e.key === "Escape") { e.preventDefault(); onOpenChange(false); trigger.current?.focus(); return; }
    const i = items.current.findIndex((el) => el === document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      items.current[((i < 0 ? 0 : i) + step + n) % n]?.focus();
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items.current[e.key === "Home" ? 0 : n - 1]?.focus();
    }
  }

  return (
    <div ref={wrap} className="relative shrink-0"
      // Focus leaving the wrapper entirely (a Tab past the last link, or a click into the page) is
      // what closes this menu - not the first Tab, which has to be free to walk the links.
      onBlur={(e) => { if (!wrap.current?.contains(e.relatedTarget as Node | null)) { onOpenChange(false); } }}>
      <button
        ref={trigger} type="button" id={id + "-trigger"}
        aria-expanded={open} aria-controls={open ? id + "-menu" : undefined}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); place(); onOpenChange(true); } }}
        className={cn(
          "min-h-[44px] inline-flex items-center gap-1.5 rounded-control px-3 text-sm font-medium text-ink-700",
          "transition-colors duration-fast ease-out hover:bg-surface-pressed hover:text-brand-300 active:bg-surface-pressed",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2",
          "motion-reduce:transition-none",
          open && "bg-brand-500/15 text-brand-300",
        )}>
        {label}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          className={cn("shrink-0 transition-transform duration-fast ease-out motion-reduce:transition-none", open && "rotate-180")}>
          <path d="M2 4l3 3 3-3" />
        </svg>
      </button>

      {open && (
        <ul id={id + "-menu"} role="list" aria-labelledby={id + "-trigger"} onKeyDown={onKey}
          style={{ position: "fixed", width: box.w, left: box.left, maxHeight: box.maxH,
            ...(box.flip ? { bottom: box.bottom } : { top: box.top }) }}
          className="z-40 overflow-y-auto rounded-control bg-surface/95 backdrop-blur-md text-ink-900 ring-1 ring-line py-1">
          {links.map((l, i) => {
            const kids = l.children ?? [];
            const subOpen = sub === l.href;
            return (
              <li key={l.href} ref={(el) => { rows.current[l.href] = el; }}
                // The delay lives here rather than on the panel: the panel is a child of this row, so
                // crossing the gap counts as leaving and re-entering, and the timer is cancelled by
                // the re-entry. A flick between the two never reaches the timeout at all.
                onMouseEnter={() => { if (kids.length) { openSub(l.href); } }}
                onMouseLeave={() => { if (kids.length) { closeSubSoon(); } }}>
                <div className="flex items-stretch">
                  <a ref={(el) => { items.current[i] = el; }} href={l.href}
                    onClick={() => onOpenChange(false)}
                    className={cn(
                      "min-h-[44px] flex-1 flex items-center px-4 py-2.5 text-sm text-ink-700 truncate",
                      "transition-colors duration-fast ease-out hover:bg-surface-pressed hover:text-brand-300 active:bg-surface-pressed",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-inset",
                      "motion-reduce:transition-none",
                    )}>
                    {l.label}
                  </a>
                  {/* The category link above stays a link - it has a page of its own and a shopper who
                      wants all of Accessories must be able to click the word. The arrow is the second
                      control, and the only thing that opens the sub-level. */}
                  {kids.length > 0 && (
                    <button type="button"
                      ref={(el) => { arrowBtn.current[l.href] = el; }}
                      aria-expanded={subOpen} aria-haspopup="true"
                      aria-label={"Show " + l.label + " sub-categories"}
                      onClick={() => (subOpen ? closeSubNow() : openSub(l.href))}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openSub(l.href, true);
                        }
                      }}
                      className={cn(
                        "shrink-0 w-11 flex items-center justify-center text-ink-500",
                        "transition-colors duration-fast ease-out hover:bg-surface-pressed hover:text-brand-300 active:bg-surface-pressed",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-inset",
                        "motion-reduce:transition-none",
                        subOpen && "bg-brand-500/15 text-brand-300",
                      )}>
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"
                        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M4 2l3 3-3 3" />
                      </svg>
                    </button>
                  )}
                </div>
                {kids.length > 0 && subOpen && (
                  <ul onKeyDown={(e) => onSubKey(l.href, e)}
                    aria-label={"Sub-categories of " + l.label}
                    style={{ position: "fixed", width: subBox.w, left: subBox.left, top: subBox.top,
                      maxHeight: subBox.maxH }}
                    className="z-40 overflow-y-auto rounded-control bg-surface/95 backdrop-blur-md text-ink-900 ring-1 ring-line py-1">
                    {kids.map((c, j) => (
                      <li key={c.href}>
                        <a ref={(el) => { (subItems.current[l.href] ??= [])[j] = el; }}
                          href={c.href} onClick={() => onOpenChange(false)}
                          className={cn(
                            "min-h-[44px] flex items-center px-4 py-2.5 text-sm text-ink-700 truncate",
                            "transition-colors duration-fast ease-out hover:bg-surface-pressed hover:text-brand-300 active:bg-surface-pressed",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-inset",
                            "motion-reduce:transition-none",
                          )}>
                          {c.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
