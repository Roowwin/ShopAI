"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { GROUPS, activeGroupId, activeHref, type NavIcon } from "./nav";
import { kickerClass } from "@/lib/ui";
import { cn } from "./ui";

/* The admin sidebar: the taxonomy in nav.ts, drawn as seven collapsible categories.

   This file is the taxonomy's other half. nav.ts is the ONE list of routes; this is the ONE map from
   a category's icon name to the path data that draws it, and the map is typed by nav.ts's own union
   so naming an icon there and not drawing it here fails to compile rather than leaving a gap in the
   rail.

   NO ICON PACKAGE. Every glyph is hand-written path data in a 16-unit square, stroked in
   currentColor, so a category takes the colour of the text it sits beside and the set stays one
   weight. Nothing here is fetched and nothing is imported from a font.

   OPEN STATE is the viewer's own and lives in this browser only, exactly as the sidebar's collapsed
   width already does, and both ends are guarded the same way: a private window or blocked storage
   throws on access, and navigation that cannot draw itself because it cannot remember a chevron
   would be a bad trade. Unknown remembered ids are dropped rather than carried - a renamed category
   would otherwise sit in storage for good.

   THE CURRENT CATEGORY IS OPENED BY A STATE WRITE, not by forcing it open while drawing. Forcing it
   (`isOpen = remembered || isCurrent`) would make that one category's control do nothing when
   pressed, which is the worst thing a control can do; a write keeps the press real, and it happens
   on a route change so closing the current category afterwards stays closed.

   WHERE A FOCUS CUE SITS: every control in here is inside the sidebar's own scroller, and a scroller
   trims whatever is painted outside its box, so each cue is drawn INSIDE the control's own edge
   rather than around it. That is this phase's third encounter with that trap and the reason the
   rule is written down here. */

const OPEN_KEY = "rfo.admin.nav.open";

function categoryIds(): string[] {
  return GROUPS.map((g) => g.id);
}

/* A remembered list of category ids, or none. Every branch here returns - this function cannot
   throw and cannot hand back an id the taxonomy does not know, because the drawing that follows
   has to render whatever it returns. */
function readOpen(): string[] {
  try {
    const raw = window.localStorage.getItem(OPEN_KEY);
    if (!raw) { return []; }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) { return []; }
    const known = categoryIds();
    return parsed.filter((v): v is string => typeof v === "string" && known.includes(v));
  } catch { return []; }
}

function writeOpen(ids: string[]): void {
  try { window.localStorage.setItem(OPEN_KEY, JSON.stringify(ids)); } catch { void 0; }
}

/* One control, one state pair. Each pair is written once here rather than at the call site, so the
   current-page treatment is identical wherever a link is drawn and cannot drift between them. */
const CATEGORY_BASE =
  "flex w-full min-h-[36px] items-center gap-2 rounded-control px-2 text-left " +
  "transition-colors duration-fast ease-out motion-reduce:transition-none " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500";
/* The category label is the shared eyebrow (kickerClass, lib/ui.ts), the one small-caps label this
   app has. The current category is therefore marked by its icon and its twist turning emerald
   rather than by its label changing ink - a second label style is what that shared class exists to
   prevent, and over-riding a class the primitive owns would need an important utility.

   On hover the row's own recess fill is a WEAK cue on this ground (the two are 1.10:1 apart, which
   is the same fill the entries and the old flat links already carried), so the icon and the twist
   also brighten a step. The label cannot join them - it belongs to the shared class. */
const CATEGORY_IDLE = "text-ink-500 hover:bg-surface-sunken hover:text-ink-600";
const CATEGORY_CURRENT = "text-brand-300";

const ITEM_BASE =
  "flex min-h-[36px] items-center rounded-control pr-2 pl-8 text-sm " +
  "transition-colors duration-fast ease-out motion-reduce:transition-none " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500";
/* The page you are on carries the emerald treatment AND its bloom, from the app's own boxShadow
   tokens - the glow is a token rather than a hue chosen here, so a change to the emerald is one
   edit in globals.css and not a hunt through the chrome. */
const ITEM_CURRENT = "bg-brand-50 font-semibold text-brand-300 shadow-glow-sm";
const ITEM_IDLE = "text-ink-600 hover:bg-surface-sunken hover:text-ink-900";

const RAIL_BASE =
  "mx-auto flex h-9 w-9 items-center justify-center rounded-control " +
  "transition-colors duration-fast ease-out motion-reduce:transition-none " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500";
const RAIL_CURRENT = "bg-brand-50 text-brand-300 shadow-glow-sm";
const RAIL_IDLE = "text-ink-500 hover:bg-surface-sunken hover:text-ink-600";

const ICONS: Record<NavIcon, ReactNode> = {
  /* a dial with a needle */
  gauge: <><path d="M2.5 13a5.5 5.5 0 0 1 11 0" /><path d="M8 13l3-4" /></>,
  /* a crate, drawn as its outer faces */
  crate: <><path d="M8 1.5l6 3.25v6.5L8 14.5l-6-3.25v-6.5z" /><path d="M2 4.75l6 3.25 6-3.25" /><path d="M8 8v6.5" /></>,
  /* a docket with a torn foot */
  receipt: <><path d="M4 1.5h8v13l-2-1.5-2 1.5-2-1.5-2 1.5z" /><path d="M6 5.5h4" /><path d="M6 8.5h4" /></>,
  /* a shopfront: awning over a door */
  shop: <><path d="M2.5 6.5h11" /><path d="M3.5 6.5V3.5l1-1.5h7l1 1.5v3" /><path d="M4.5 6.5V14h7V6.5" /><path d="M6.5 14v-4h3v4" /></>,
  /* a four-point spark */
  spark: <path d="M8 2l1.5 4.5L14 8l-4.5 1.5L8 14l-1.5-4.5L2 8l4.5-1.5z" />,
  /* a plug: two pins, a body and a lead */
  plug: <><path d="M5.5 1.5v4" /><path d="M10.5 1.5v4" /><path d="M3.5 5.5h9v2a4.5 4.5 0 0 1-9 0z" /><path d="M8 12v2.5" /></>,
  /* a shield with a tick */
  shield: <><path d="M8 1.5l5.5 2.2v4.1c0 3-2.2 5.6-5.5 6.9-3.3-1.3-5.5-3.9-5.5-6.9V3.7z" /><path d="M5.8 7.9l1.6 1.6 3-3.4" /></>,
};

function Glyph({ name }: { name: NavIcon }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      {ICONS[name]}
    </svg>
  );
}

type Props = {
  /** The collapsed width: one icon per category and no labels. */
  rail?: boolean;
  /** A category was picked - the narrow-width drawer closes on it. */
  onNavigate?: () => void;
  /** A rail icon was pressed: the rail gives way to the labelled list. */
  onExpand?: () => void;
};

export default function SidebarNav({ rail = false, onNavigate, onExpand }: Props) {
  const pathname = usePathname();
  const current = activeGroupId(pathname);
  const href = activeHref(pathname);

  /* The first draw is decided by the route alone, which is the one thing the server and this
     browser agree on at that moment, so the current category is already open in the shipped page
     and hydration has nothing to disagree about. Remembered categories are folded in after mount,
     which is the first moment storage may be read at all. */
  const [open, setOpen] = useState<Set<string>>(() => new Set(current ? [current] : []));

  useEffect(() => {
    const remembered = readOpen();
    if (remembered.length === 0) { return; }
    setOpen((prev) => {
      const next = new Set(prev);
      for (const id of remembered) { next.add(id); }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!current) { return; }
    setOpen((prev) => (prev.has(current) ? prev : new Set(prev).add(current)));
  }, [current]);

  function toggle(id: string) {
    const next = new Set(open);
    if (next.has(id)) { next.delete(id); } else { next.add(id); }
    setOpen(next);
    writeOpen([...next]);
  }

  /* Opening a category that is already open is not a toggle - the rail's icon is a way into the
     list, and pressing it twice should leave the same category open rather than closing it. */
  function openCategory(id: string) {
    const next = new Set(open);
    next.add(id);
    setOpen(next);
    writeOpen([...next]);
  }

  if (rail) {
    /* The collapsed width. A category can only show its icon here, so the icon carries the
       current-page treatment and the label moves to the control's own name - and pressing it
       expands the rail rather than opening a floating menu. A floating panel would have to be
       painted outside this scroller to be seen at all, and a control that depends on escaping the
       box it sits in is the same trap the focus cues above are written to avoid. There is therefore
       no floating menu here and nothing that needs Escape to dismiss. */
    return (
      <ul className="space-y-1 pt-2">
        {GROUPS.map((g) => (
          <li key={g.id}>
            <button
              type="button"
              onClick={() => { openCategory(g.id); onExpand?.(); }}
              title={g.heading}
              aria-label={"Show " + g.heading}
              className={cn(RAIL_BASE, g.id === current ? RAIL_CURRENT : RAIL_IDLE)}
            >
              <Glyph name={g.icon} />
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="pt-2">
      {GROUPS.map((g) => {
        const expanded = open.has(g.id);
        const headerId = "nav-cat-" + g.id;
        const panelId = "nav-cat-panel-" + g.id;
        return (
          <div key={g.id} className="pb-1">
            <button
              type="button"
              id={headerId}
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => toggle(g.id)}
              className={cn(CATEGORY_BASE, g.id === current ? CATEGORY_CURRENT : CATEGORY_IDLE)}
            >
              <Glyph name={g.icon} />
              <span className={cn(kickerClass, "min-w-0 flex-1")}>{g.heading}</span>
              <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor"
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                className={cn("shrink-0 transition-transform duration-fast ease-out motion-reduce:transition-none",
                  expanded && "rotate-180")}>
                <path d="M4 6.5l4 4 4-4" />
              </svg>
            </button>

            {/* The panel stays in the page whether or not it is open, so the control above always
                has something to name, and the links are in the shipped markup rather than appearing
                only once this browser has run. The browser's own boolean attribute is what closes
                it, so a rebuild that sheds a class cannot leave a closed panel on screen. */}
            <div id={panelId} hidden={!expanded}>
              <ul className="space-y-0.5 pt-0.5">
                {g.items.map((l) => {
                  const on = l.href === href;
                  return (
                    <li key={l.href}>
                      <a
                        href={l.href}
                        aria-current={on ? "page" : undefined}
                        onClick={() => onNavigate?.()}
                        className={cn(ITEM_BASE, on ? ITEM_CURRENT : ITEM_IDLE)}
                      >
                        {l.label}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        );
      })}
    </div>
  );
}
