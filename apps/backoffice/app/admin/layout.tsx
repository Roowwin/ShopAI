"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { logout } from "@/lib/api";
import { useMe } from "@/lib/session";
import { Badge, Button, cn } from "@/app/components/ui";
import { kickerClass } from "@/lib/ui";

/* The admin chrome. A grouped sidebar beside the content replaces the horizontal strip that had
   grown to twelve entries and wrapped on a narrow window: the twelve become six named sections,
   so the portal reads as Overview / Catalogue / Commerce / Storefront / AI / Account instead of
   one flat run.

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
type NavItem = { href: string; label: string };
type NavGroup = { heading: string; items: NavItem[] };

/* The taxonomy, in the order it renders. Kept as data so a group is one edit rather than a second
   copy of the markup below. */
const GROUPS: NavGroup[] = [
  /* Two entries, one name each: the dashboard job added /admin/dashboard, and the entry that used
     to be called "Dashboard" is now "Overview" - so the word Dashboard points at exactly one
     route and the older /admin summary keeps a name of its own. */
  { heading: "Overview", items: [
    { href: "/admin/dashboard", label: "Dashboard" },
    { href: "/admin", label: "Overview" },
  ] },
  { heading: "Catalogue", items: [
    { href: "/admin/intake", label: "Lots & intake" },
    { href: "/admin/assets", label: "Assets" },
  ] },
  { heading: "Commerce", items: [
    { href: "/admin/orders", label: "Orders" },
    { href: "/admin/customers", label: "Customers" },
    { href: "/admin/audit", label: "Audit" },
  ] },
  { heading: "Storefront", items: [
    { href: "/admin/cms", label: "CMS" },
    { href: "/admin/newsletter", label: "Newsletter" },
  ] },
  { heading: "AI", items: [
    { href: "/admin/assistant", label: "Assistant" },
    { href: "/admin/ai/listings", label: "AI listings" },
    { href: "/admin/agents", label: "Agents" },
  ] },
  { heading: "Account", items: [{ href: "/admin/security", label: "Security" }] },
];

/* One sub-topic link and the two states it can be in, defined once so the current-page treatment
   is identical wherever a link is drawn. */
const LINK_BASE = "flex min-h-[36px] items-center rounded-control px-2 text-sm";
const LINK_ACTIVE = "bg-brand-50 font-semibold text-brand-700";
const LINK_IDLE = "text-ink-600 hover:bg-surface-sunken";

/* The narrow-width toggle. A plain button rather than the Button primitive on purpose: this one
   control carries a 44px touch target, and Button's own 36px minimum height cannot be replaced
   through `className` - there is no tailwind-merge, so the two minimums would both be emitted and
   the winner decided by stylesheet order rather than by intent. */
const TOGGLE =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control px-3 " +
  "text-sm font-semibold text-brand-700 ring-1 ring-line";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me } = useMe();
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="min-h-screen md:flex">
      {/* The narrow-width strip: the section list has nowhere to live beside the content here, so
          the toggle is what reveals it (stacked above the content, below this strip). */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2 md:hidden">
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
          "w-full flex-col border-b border-line bg-surface md:sticky md:top-0 md:flex md:h-screen " +
            "md:w-64 md:shrink-0 md:border-b-0 md:border-r",
          navOpen ? "flex" : "hidden",
        )}
      >
        {/* The narrow-width strip above already carries the name, so this line only earns its
            place once the sidebar is a column of its own. */}
        <p className="hidden px-4 pt-4 pb-2 text-sm font-semibold text-ink-900 md:block">
          RFO Backoffice
        </p>

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
              <Badge colorClass="bg-brand-50 text-brand-700" className="mt-1">{me.role}</Badge>
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
      </nav>

      {/* The content column takes whatever the sidebar leaves, and is allowed to be narrower than
          its own content, so one long word in a cell cannot hold the column open and push the
          whole page sideways - the sidebar is the only column with a width of its own. */}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
