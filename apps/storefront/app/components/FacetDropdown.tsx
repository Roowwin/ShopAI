"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "./ui";

/* One facet of the catalog toolbar: its trigger, and the option panel it opens.

   This is a RENDER LAYER over state that already exists, and nothing more. The filter set lives in
   the URL - the server parses it, the API echoes what it really applied, and this component only
   reports "the shopper picked this value" back to its caller (LoadMore), which writes the query
   string. It holds no filter of its own, so a pasted link and a clicked one cannot disagree.

   Not a native <select>: a select cannot carry the counts, a check on the value in force, or the
   house's focus ring without fighting the platform's own popup. This is the same button + panel the
   header's search suggestions use, with the listbox roles a screen reader needs.

   The panel is `fixed`, placed from the trigger's own rect. The toolbar scrolls sideways on phones,
   and a panel left inside a scroll container would be clipped by it (overflow-x: auto makes
   overflow-y compute to auto as well) - anchoring to the viewport escapes that clip entirely, and
   lets the box clamp itself to the window on both axes: never off the right edge, and never past the
   bottom, because a panel taller than the room beneath it would run off the screen where its options
   cannot be reached at all. It takes exactly the room it has, scrolls its own overflow, and opens
   upwards when the room below the trigger is too small to be useful. */

export type FacetOption = { value: string | null; label: string };

const PANEL_W = 320;    // the panel's width on anything wider than a phone
const SHEET_MAX = 480;  // at or below this viewport width the panel is a full-width sheet instead
const EDGE = 8;
const GAP = 4;
const MIN_H = 176;      // the height below which we would rather open upwards than shrink

type Panel = { w: number; left: number; top: number; bottom: number; maxH: number; flip: boolean };

type Props = {
  /** The facet's name - "Grade". Shown alone at rest, and as "Grade: B" once a value is in force. */
  label: string;
  /** The value in force, or null. The caller derives it from the filter set (the URL), never state. */
  value: string | null;
  options: FacetOption[];
  onSelect: (value: string | null) => void;
  /** Which facet is open is the caller's state, so only one panel can be open at a time. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function FacetDropdown({ label, value, options, onSelect, open, onOpenChange }: Props) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const opts = useRef<(HTMLDivElement | null)[]>([]);
  const [panel, setPanel] = useState<Panel>({ w: PANEL_W, left: 0, top: 0, bottom: 0, maxH: 320, flip: false });
  // Whether this opening has already taken focus, so a re-render while open (the panel following a
  // scroll) cannot yank focus back off the option the shopper has arrowed onto.
  const focused = useRef(false);
  const baseId = useId();

  /* An unfound value still reads: a link can carry a value the live option list no longer offers
     (a brand that sold out, a category that moved), and the honest answer is to show it rather
     than to look unfiltered while the grid behind is filtered. */
  const current = options.find((o) => o.value === value) ?? null;
  const text = value === null ? label : label + ": " + (current?.label ?? value);
  const selIdx = options.findIndex((o) => o.value === value);

  function place() {
    const el = trigger.current;
    if (!el) { return; }
    const r = el.getBoundingClientRect();
    // Full-width sheet on a phone, a 320px column above that - and never wider than the window,
    // which is also what keeps the horizontal clamp below well defined.
    const w = window.innerWidth <= SHEET_MAX
      ? window.innerWidth - 2 * EDGE
      : Math.min(PANEL_W, window.innerWidth - 2 * EDGE);
    const below = window.innerHeight - r.bottom - 2 * EDGE;
    const above = r.top - 2 * EDGE;
    /* The height is the room the panel actually has, with NO floor under it. A floor is what an
       earlier cut of this file got wrong: it held the box at 176px even when the trigger sat near
       the bottom of the window, so the panel ran off the screen - entirely off it at the extreme,
       while `open` was true and every option was unreachable. When the room below cannot hold a
       usable panel and there is more room above the trigger, it opens upwards instead. Both
       offsets are viewport distances, which is what a fixed box needs. */
    const flip = below < MIN_H && above > below;
    const next: Panel = {
      w,
      left: Math.max(EDGE, Math.min(r.left, window.innerWidth - w - EDGE)),
      top: r.bottom + GAP,
      bottom: window.innerHeight - r.top + GAP,
      maxH: Math.max(0, flip ? above : below),
      flip,
    };
    // Bail out when nothing moved: the scroll listener would otherwise re-render on every frame.
    setPanel((p) => (p.w === next.w && p.left === next.left && p.top === next.top
      && p.bottom === next.bottom && p.maxH === next.maxH && p.flip === next.flip ? p : next));
  }

  function toggle() {
    if (open) { onOpenChange(false); return; }
    place();
    onOpenChange(true);
  }

  function close() {
    onOpenChange(false);
    trigger.current?.focus();
  }

  /* Choosing is the only thing that reaches the URL. Picking what is already in force is dropped
     rather than pushed: re-navigating to the same query string would only add a history entry that
     means nothing to walk back through. */
  function choose(o: FacetOption) {
    onOpenChange(false);
    trigger.current?.focus();
    if (o.value !== value) { onSelect(o.value); }
  }

  useEffect(() => {
    if (!open) { focused.current = false; return; }
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

  /* Opening lands focus on the value in force, so the listbox announces where you already are
     rather than dropping you at the top of a list you have to re-find. This runs on the open edge
     only (that render's `selIdx` is the one in force) and never again while open, so the panel
     re-rendering as it follows a scroll cannot pull focus off the option you arrowed onto. */
  useEffect(() => {
    if (!open || focused.current) { return; }
    focused.current = true;
    const el = opts.current[selIdx >= 0 ? selIdx : 0];
    el?.focus({ preventScroll: true });
  }, [open]);

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const n = options.length;
    const i = opts.current.findIndex((el) => el === document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    // Tab closes, and focus is handed back to the trigger first: the browser then runs its own tab
    // move from there, so focus lands on the next control instead of falling to the document when
    // the option it was sitting on is removed.
    if (e.key === "Tab") { close(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      opts.current[((i < 0 ? 0 : i) + step + n) % n]?.focus();
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      opts.current[e.key === "Home" ? 0 : n - 1]?.focus();
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const pick = options[i >= 0 ? i : selIdx >= 0 ? selIdx : 0];
      if (pick) { choose(pick); }
    }
  }

  return (
    <div ref={wrap} className="relative shrink-0">
      <button
        ref={trigger} type="button" id={baseId + "-trigger"}
        aria-haspopup="listbox" aria-expanded={open}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); place(); onOpenChange(true); } }}
        className={cn(
          "min-h-[44px] inline-flex items-center gap-1.5 rounded-control px-3 text-xs font-semibold",
          "transition-colors duration-fast ease-out motion-reduce:transition-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2",
          // A facet with nothing in force is a quiet secondary control; the one in force is the
          // brand-marked one, so a glance down the toolbar says what is actually filtering.
          value === null
            ? "bg-surface text-ink-700 ring-1 ring-line hover:bg-surface-pressed hover:ring-line-strong active:bg-surface-pressed"
            : "bg-brand-500/15 text-brand-300 ring-1 ring-brand-500/50 hover:bg-brand-500/25",
        )}>
        <span className="truncate max-w-[12rem]">{text}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          className={cn("shrink-0 transition-transform duration-fast ease-out motion-reduce:transition-none", open && "rotate-180")}>
          <path d="M2 4l3 3 3-3" />
        </svg>
      </button>

      {open && (
        <div role="listbox" aria-labelledby={baseId + "-trigger"} tabIndex={-1} onKeyDown={onKey}
          style={{ position: "fixed", width: panel.w, left: panel.left, maxHeight: panel.maxH,
            ...(panel.flip ? { bottom: panel.bottom } : { top: panel.top }) }}
          className="z-40 overflow-y-auto rounded-control bg-surface/95 backdrop-blur-md text-ink-900 ring-1 ring-line py-1">
          {options.map((o, i) => {
            const isSel = o.value === value;
            return (
              <div key={o.value ?? "\u0000none"} role="option" aria-selected={isSel} tabIndex={-1}
                ref={(el) => { opts.current[i] = el; }}
                onClick={() => choose(o)}
                className={cn(
                  "min-h-[44px] flex items-center gap-2 px-3 text-sm cursor-pointer select-none",
                  "transition-colors duration-fast ease-out motion-reduce:transition-none",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-inset",
                  isSel ? "bg-brand-500/15 text-brand-300 font-medium" : "hover:bg-surface-pressed",
                )}>
                {/* The check keeps its box when the option is not the value in force (transparent,
                    not removed), so the labels of a list do not shift sideways as you pick. */}
                <span className={cn("shrink-0", isSel ? "text-brand-300" : "text-transparent")} aria-hidden="true">
                  <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor"
                    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 8.5l3.5 3.5L13 4.5" />
                  </svg>
                </span>
                <span className="truncate">{o.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
