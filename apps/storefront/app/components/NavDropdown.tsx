"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "./ui";

/* The header's Shop menu: a disclosure button and a MEGA MENU behind it - every category the shop
   has, laid out in columns, in one panel.

   WHY COLUMNS AND NOT A LIST WITH FLY-OUTS. The menu this replaced was a single 288px column in which
   the categories that have children (Parts, Accessories) opened a SECOND panel beside themselves, so
   reaching "RAM (Memory)" meant hover, wait, move sideways, click. A shop with fourteen categories
   does not need a second level - it needs a wider panel. Nothing about the taxonomy changed: the
   categories still come from the API, and the Parts/Accessories split still comes from `navMenu`,
   which remains the single place that decides which category is which.

   Deliberately NOT the facet dropdown. A facet SETS A VALUE - it earns listbox/option roles and a
   check on the value in force. A nav menu NAVIGATES: the items are real links, nothing is "in force",
   and roles that describe choosing one of a set would be a lie about what a click does. So this is the
   disclosure pattern itself - a button that reports whether the panel is open, and plain <a> links
   under it.

   That settles the keyboard contract, and it differs from the facet panel in exactly one place: Tab
   walks INTO the panel and along it (the items are links, so they are in the tab order anyway), which
   means the menu closes when focus leaves it rather than on the first Tab. Escape still closes and
   hands focus back to the button, and the arrows/Home/End walk every link in the panel - down a column
   and on into the next, which is the order a screen reader reads them in.

   The panel is `fixed`, placed from the trigger's own rect - the same reason the facet panel is: it
   has to escape the sticky header's clip and stacking context, and it has to clamp itself to the
   window instead of running off an edge or off the bottom of a short screen. */

export type NavLink = { href: string; label: string };
export type NavColumn = { heading: string; links: NavLink[] };

const PANEL_W = 640;   // three columns of category names, which is what the shop has
const EDGE = 8;
const GAP = 6;
const MIN_H = 200;     // the height below which we would rather open upwards than shrink

type Box = { w: number; left: number; top: number; bottom: number; maxH: number; flip: boolean };

type Props = {
  /** What the button says. A noun, not a value - there is no selection to report. */
  label: string;
  /** The panel, one entry per column. An empty column is dropped rather than headed with nothing. */
  columns: NavColumn[];
  /** The way to the whole catalogue, pinned under the columns. */
  all: NavLink;
  /** Open state is the header's, so nothing else in the header can be open at the same time. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function NavDropdown({ label, columns, all, open, onOpenChange }: Props) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const items = useRef<(HTMLAnchorElement | null)[]>([]);
  const [box, setBox] = useState<Box>({ w: PANEL_W, left: 0, top: 0, bottom: 0, maxH: 320, flip: false });
  // Whether this opening has already taken focus, so a re-render while open (the panel following a
  // scroll) cannot pull focus back off the link you have tabbed onto.
  const took = useRef(false);
  const id = useId();

  const shown = columns.filter((c) => c.links.length > 0);
  // Every link in the panel in READING order - down each column, then the next - which is what the
  // arrow keys walk. Rebuilt per render; it is fourteen entries.
  const flat: NavLink[] = [...shown.flatMap((c) => c.links), all];

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

  // Following the trigger: the header is sticky, so a scroll can move the button without changing
  // anything this component renders - the panel would otherwise stay where the button used to be.
  useEffect(() => {
    if (!open) { took.current = false; return; }
    place();
    const onMove = () => place();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  // Opening lands focus on the first link, which is what makes Tab walk straight into the panel and
  // what makes a screen reader announce its contents rather than only its label.
  useEffect(() => {
    if (!open || took.current) { return; }
    took.current = true;
    items.current[0]?.focus({ preventScroll: true });
  }, [open]);

  function onKey(e: KeyboardEvent<HTMLElement>) {
    const n = flat.length;
    if (e.key === "Escape") { e.preventDefault(); onOpenChange(false); trigger.current?.focus(); return; }
    const i = items.current.findIndex((el) => el === document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      items.current[((i < 0 ? 0 : i) + step + n) % n]?.focus();
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      // Sideways is the COLUMN axis in a panel laid out in columns, so these move by a column
      // - landing on the same row of the next one, clamped when that column is shorter - rather than
      // by a single link. On the "All products" row there is no column to move to, so nothing moves.
      const lens = shown.map((c) => c.links.length);
      const at = i < 0 ? 0 : i;
      if (at >= lens.reduce((s, v) => s + v, 0)) { return; }
      e.preventDefault();
      let col = 0, start = 0;
      for (let k = 0; k < lens.length; k++) { if (at < start + lens[k]) { col = k; break; } start += lens[k]; }
      const to = (col + (e.key === "ArrowRight" ? 1 : -1) + lens.length) % lens.length;
      const target = lens.slice(0, to).reduce((s, v) => s + v, 0) + Math.min(at - start, lens[to] - 1);
      items.current[target]?.focus();
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
        /* NO BLUR ON THIS PANEL, and the reason is not taste. `backdrop-filter` - which is what
           `backdrop-blur` compiles to - makes an element the CONTAINING BLOCK for `position: fixed`
           descendants, exactly as `transform` does. This panel is placed in VIEWPORT coordinates, read
           from `getBoundingClientRect()`, so a blurred ancestor silently re-anchors it. The fill stays
           at 95% so the difference is not visible.

           WHAT STILL ANCHORS IT, and it is worth knowing before anyone restyles the header: the
           header bar above IS blurred, so it is the containing block for this panel. Viewport
           coordinates stay correct only because that bar is sticky, full width and at the top of the
           window - its origin IS the window's origin. Centre it, inset it, or put a transform on it
           and the panel goes with it. */
        <div id={id + "-menu"} aria-labelledby={id + "-trigger"} onKeyDown={onKey}
          style={{ position: "fixed", width: box.w, left: box.left, maxHeight: box.maxH,
            ...(box.flip ? { bottom: box.bottom } : { top: box.top }) }}
          className="z-40 overflow-y-auto rounded-control bg-surface/95 text-ink-900 ring-1 ring-line">
          <div className={cn("grid gap-x-4 gap-y-2 p-4",
            shown.length === 3 ? "grid-cols-3" : shown.length === 2 ? "grid-cols-2" : "grid-cols-1")}>
            {shown.map((c) => (
              <div key={c.heading}>
                <p className="px-3 pb-1 pt-1 text-eyebrow uppercase text-ink-500">{c.heading}</p>
                <ul>
                  {c.links.map((l) => (
                    <li key={l.href}>
                      <a ref={(el) => { items.current[flat.findIndex((f) => f.href === l.href)] = el; }}
                        href={l.href} onClick={() => onOpenChange(false)}
                        className={cn(
                          "flex min-h-[44px] items-center rounded-control px-3 py-1 text-sm text-ink-700",
                          "transition-colors duration-fast ease-out hover:bg-surface-pressed hover:text-brand-300 active:bg-surface-pressed",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-inset",
                          "motion-reduce:transition-none",
                        )}>
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {/* The whole catalogue, under the columns and behind a hairline: the one destination that is
              not a category, and the one a shopper looking for "everything" wants. */}
          <div className="border-t border-line p-2">
            <a ref={(el) => { items.current[flat.length - 1] = el; }}
              href={all.href} onClick={() => onOpenChange(false)}
              className={cn(
                "flex min-h-[44px] items-center rounded-control px-3 py-1 text-sm font-medium text-ink-900",
                "transition-colors duration-fast ease-out hover:bg-surface-pressed hover:text-brand-300 active:bg-surface-pressed",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-inset",
                "motion-reduce:transition-none",
              )}>
              {all.label}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
