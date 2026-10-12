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

export type NavLink = { href: string; label: string };

const PANEL_W = 288;   // a nav menu is a list of words - narrower than a facet's option rows
const EDGE = 8;
const GAP = 4;
const MIN_H = 176;     // the height below which we would rather open upwards than shrink

type Box = { w: number; left: number; top: number; bottom: number; maxH: number; flip: boolean };

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

  useEffect(() => {
    if (!open) { took.current = false; return; }
    place();
    const onMove = () => place();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

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
          "transition-colors duration-fast ease-out hover:bg-surface-sunken hover:text-brand-700 active:bg-surface-pressed",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2",
          "motion-reduce:transition-none",
          open && "bg-surface-sunken text-brand-700",
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
          className="z-40 overflow-y-auto rounded-control bg-white text-ink-900 shadow-lg ring-1 ring-line py-1">
          {links.map((l, i) => (
            <li key={l.href}>
              <a ref={(el) => { items.current[i] = el; }} href={l.href}
                onClick={() => onOpenChange(false)}
                className={cn(
                  "min-h-[44px] flex items-center px-4 py-2.5 text-sm text-ink-700 truncate",
                  "transition-colors duration-fast ease-out hover:bg-surface-sunken hover:text-brand-700 active:bg-surface-pressed",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-inset",
                  "motion-reduce:transition-none",
                )}>
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
