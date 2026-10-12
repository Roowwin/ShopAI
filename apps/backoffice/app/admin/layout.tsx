"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { logout } from "@/lib/api";
import { useMe } from "@/lib/session";
import { Badge, Button, cn } from "@/app/components/ui";
import { kickerClass } from "@/lib/ui";
import CommandPalette from "@/app/components/CommandPalette";
import { GROUPS } from "@/app/components/nav";

/* The admin chrome. A grouped sidebar beside the content replaces the horizontal strip that had
   grown to twelve entries and wrapped on a narrow window: the twelve become six named sections,
   so the portal reads as Overview / Catalogue / Commerce / Storefront / AI / Account instead of
   one flat run.

   The taxonomy itself now lives in app/components/nav.ts, because the command palette renders the
   same thirteen entries - one list, so a link with no page behind it cannot appear in the chrome
   twice. Each heading's "Operations / Commerce / Intelligence" reading was considered and NOT
   adopted: the six group names above are the ones this app settled on, and regrouping them is a
   taxonomy change rather than a restyle.

   A group's label is the shared eyebrow (lib/ui.ts), the same class Table's header row and Stat's
   label take, so the app has ONE small-caps label style rather than a second one grown here.

   Every entry must have a page behind it - a link with no page is a 404 in the chrome. Orders,
   Customers and Audit were deliberately withheld until the ops pages existed and landed in the
   same commit as those pages; Agents landed with the agent-identity job; Dashboard landed with the
   dashboard job. Thirteen entries, thirteen pages.

   Narrow width: the content column keeps its own width and the sidebar is what gives way. In a
   narrow window the section list is closed by default and opens from the toggle in the strip
   across the top, so it comes down ABOVE the content rather than squeezing it into a 16rem
   remainder - which at 375px would leave the content almost nothing. The toggle takes a 44px
   touch target on purpose: it is the one control in this app on a phone-width surface, where the
   pointer-first 36px control height that holds everywhere else is too small to hit. */
const COLLAPSE_KEY = "rfo.admin.nav.collapsed";

/* The desktop sidebar's collapsed state is a VIEWER preference and lives in this browser only.
   Both ends are guarded: a private window or blocked storage throws on access, and chrome that
   cannot render because it cannot remember a width would be a bad trade. */
function readCollapsed(): boolean {
  try { return window.localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
}
function writeCollapsed(v: boolean): void {
  try { window.localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0"); } catch { void 0; }
}

/* One sub-topic link and the two states it can be in, defined once so the current-page treatment
   is identical wherever a link is drawn. */
const LINK_BASE = "flex min-h-[36px] items-center rounded-control px-2 text-sm";
const LINK_ACTIVE = "bg-brand-50 font-semibold text-brand-300";
const LINK_IDLE = "text-ink-600 hover:bg-surface-sunken";

/* The narrow-width toggle. A plain button rather than the Button primitive on purpose: this one
   control carries a 44px touch target, and Button's own 36px minimum height cannot be replaced
   through `className` - there is no tailwind-merge, so the two minimums would both be emitted and
   the winner decided by stylesheet order rather than by intent. */
const TOGGLE =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control px-3 " +
  "text-sm font-semibold text-brand-300 ring-1 ring-line";

/* The collapse control is the opposite case: desktop-only, pointer-first, so it takes the ordinary
   36px height and must NOT inherit TOGGLE's 44px minimum. Its own constant for the same reason the
   comment above gives - one minimum per control, decided here rather than by stylesheet order. */
const COLLAPSE_BTN =
  "hidden md:inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-ink-400 ring-1 ring-line " +
  "transition-colors duration-fast ease-out hover:text-ink-600 hover:ring-line-strong " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 motion-reduce:transition-none";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me } = useMe();
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Read after mount, not during the first render: the server has no storage, and a first paint that
  // disagrees with the second is a hydration mismatch.
  useEffect(() => { setCollapsed(readCollapsed()); }, []);

  return (
    <div className="min-h-screen md:flex">
      {/* The narrow-width strip: the section list has nowhere to live beside the content here, so
          the toggle is what reveals it (stacked above the content, below this strip). */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-surface-glass/80 px-4 py-2 backdrop-blur-md md:hidden">
        <span className="text-sm font-semibold text-ink-900">RFO Backoffice</span>
        <button
          type="button"
          aria-expanded={navOpen}
          aria-controls="admin-nav"
          aria-label={navOpen ? "Hide admin sections" : "Show admin sections"}
          onClick={() => setNavOpen((v) => !v)}
          className={TOGGLE}
        >
          {navOpen ? "Close" : "Menu"}
        </button>
      </header>

      <nav
        id="admin-nav"
        aria-label="Admin sections"
        className={cn(
          "w-full flex-col border-b border-line bg-surface-glass/80 backdrop-blur-md md:sticky md:top-0 md:flex md:h-screen " +
            "md:shrink-0 md:border-b-0 md:border-r",
          collapsed ? "md:w-14" : "md:w-56",
          navOpen ? "flex" : "hidden",
        )}
      >
        {/* The name and the collapse control share one row on desktop. Collapsing leaves the rail
            and this control, which is what makes it reversible - a collapsed sidebar with nothing
            in it is a trap. */}
        <div className="flex items-center justify-between gap-2 px-3 pt-4 pb-2 md:px-2">
          <p className={cn("text-sm font-semibold text-ink-900", collapsed && "md:hidden")}>
            RFO Backoffice
          </p>
          <button
            type="button"
            onClick={() => setCollapsed((v) => { writeCollapsed(!v); return !v; })}
            aria-expanded={!collapsed}
            aria-controls="admin-nav"
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            className={COLLAPSE_BTN}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
              className={cn("transition-transform duration-fast ease-out motion-reduce:transition-none",
                collapsed && "rotate-180")}>
              <path d="M10 4l-4 4 4 4" />
            </svg>
          </button>
        </div>

        {(!collapsed || navOpen) && (
          <>
            <div className="max-h-[70vh] min-h-0 flex-1 overflow-y-auto px-2 pb-4 md:max-h-none">
              {GROUPS.map((g) => (
                <section key={g.heading} className="pt-4 first:pt-0">
                  <p className={cn(kickerClass, "px-2 pb-1")}>{g.heading}</p>
                  <ul className="space-y-0.5">
                    {g.items.map((l) => {
                      /* `=== href || startsWith(href + "/")`, not a bare startsWith: a raw prefix test
                         also matches SIBLING routes, so a later /admin/intake-queue would light two
                         entries at once. This form needs no `exact` flag and cannot false-positive. */
                      const active = pathname === l.href || pathname.startsWith(l.href + "/");
                      return (
                        <li key={l.href}>
                          <a
                            href={l.href}
                            aria-current={active ? "page" : undefined}
                            onClick={() => setNavOpen(false)}
                            className={cn(LINK_BASE, active ? LINK_ACTIVE : LINK_IDLE)}
                          >
                            {l.label}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>

            {/* The identity and Sign out live at the foot of the sidebar: the narrow-width strip that
                used to carry them is gone once the sidebar has a column of its own, and a control that
                scrolls out of the section list is a control a long list can hide. */}
            <div className="border-t border-line px-4 py-3">
              {me && (
                <>
                  <p className="truncate text-xs text-ink-600">{me.email}</p>
                  <Badge colorClass="bg-brand-50 text-brand-300" className="mt-1">{me.role}</Badge>
                </>
              )}
              <Button
                variant="secondary"
                size="sm"
                className="mt-3 w-full"
                onClick={async () => { try { await logout(); } finally { router.replace("/"); } }}
              >
                Sign out
              </Button>
            </div>
          </>
        )}
      </nav>

      {/* The content column takes whatever the sidebar leaves, and is allowed to be narrower than
          its own content, so one long word in a cell cannot hold the column open and push the
          whole page sideways - the sidebar is the only column with a width of its own.

          A slim strip across the top carries the command palette's pill on desktop. It is glass
          over the page rather than an opaque bar, which is what keeps the page's own ground and the
          chrome reading as one surface. */}
      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-20 hidden items-center justify-center border-b border-line bg-surface-glass/70 px-4 py-2 backdrop-blur-md md:flex">
          <CommandPalette />
        </div>
        {children}
      </div>
    </div>
  );
}
