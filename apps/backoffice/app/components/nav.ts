/* The admin chrome's taxonomy - the ONE list of routes the app draws its navigation from.

   It lives here rather than inside layout.tsx because two things render it: the sidebar and the
   command palette. A palette with its own copy of these entries is how the chrome grows a 404 - the
   sidebar's rule is that every entry must have a page behind it, and a second list cannot keep that
   promise.

   THE ORDER IS THE ENTERPRISE ROADMAP'S ORDER, category for category and child for child. The six
   categories below are the roadmap's six; the labels are the roadmap's labels. Nothing was renamed,
   reordered, merged or dropped to suit the code that happens to exist - where the roadmap names a
   surface this build has not finished, the entry stays IN PLACE and is marked `soon` instead (see
   below), because a navigation tree that quietly omits the unbuilt half of a roadmap stops being the
   roadmap the day someone reads it.

   A CATEGORY THAT NAMES AN ICON THE SIDEBAR DOES NOT DRAW is a compile error rather than an empty
   space in the rail: `NavIcon` is the union of the names, and the sidebar's map is typed by it. */

export type NavItem = {
  href: string;
  label: string;
  /* THE INTENDED ROUTE, DRAWN AS A PLACEHOLDER. `soon` marks a roadmap surface this build has not
     built: the sidebar renders it muted, unpressable and titled "Coming soon", and the palette does
     not offer it at all (`flatNav` filters it out, which is also what stops `activeHref` from ever
     matching it). `href` is still the route the entry is FOR, so the next person to build it has the
     address the roadmap intended rather than having to invent one. */
  soon?: boolean;
};

/* The icons a category can name. Six, because there are six categories - `spark` and `plug` went
   with the old taxonomy, whose AI and Omnichannel entries are now children rather than categories,
   and an unused member here would be a glyph nobody draws. */
export type NavIcon = "gauge" | "crate" | "receipt" | "chart" | "shop" | "shield";

export type NavGroup = { id: string; heading: string; icon: NavIcon; items: NavItem[] };

export const GROUPS: NavGroup[] = [
  {
    id: "core-operations", heading: "Dashboard & Core Operations", icon: "gauge", items: [
      { href: "/admin/dashboard", label: "Dashboard" },
      { href: "/admin/orders", label: "Commerce / Orders" },
      /* Fulfilment points at Pick & Pack, the screen an order is actually packed and dispatched on. */
      { href: "/admin/shipping", label: "Fulfillment & Shipping" },
    ],
  },
  {
    id: "catalog-inventory", heading: "Product Catalog & Inventory", icon: "crate", items: [
      /* The asset workbench: the unit-level inventory browser, which is what "Inventory Management"
         names. Lot Process is the receiving station and lives at its own address. */
      { href: "/admin/assets", label: "Inventory Management" },
      { href: "/admin/product-import", label: "Product Import" },
      /* The marketplace hubs. There are three of them (eBay, Amazon, Facebook) and the roadmap gives
         the group one entry, so this is the hub for the marketplace the platform is actually wired
         toward; the other two keep their routes and are reached from this one's own links. */
      { href: "/admin/channels/ebay", label: "Omnichannel Listings" },
    ],
  },
  {
    id: "post-purchase", heading: "Post-Purchase & Customer Service", icon: "receipt", items: [
      { href: "/admin/returns", label: "Returns & RMA", soon: true },
      /* The closest built surface: the storefront's signups and the list the shop mails from. */
      { href: "/admin/newsletter", label: "Notifications" },
    ],
  },
  {
    id: "finance-analytics", heading: "Finance & Analytics", icon: "chart", items: [
      /* Both unbuilt. The finance API exists on the rail (`/staff/finance`, `/staff/logistics/payouts`)
         but neither has a screen yet, so both are placeholders rather than links to an empty shell. */
      { href: "/admin/finance", label: "Financials", soon: true },
      { href: "/admin/reports", label: "Reports & Business Intelligence", soon: true },
    ],
  },
  {
    id: "storefront-ai", heading: "Storefront & AI Tools", icon: "shop", items: [
      { href: "/admin/cms", label: "Storefront / CMS" },
      { href: "/admin/assistant", label: "AI Intelligence" },
    ],
  },
  {
    id: "administration", heading: "Administration & Security", icon: "shield", items: [
      { href: "/admin/team", label: "Team & Access Control" },
      { href: "/admin/audit", label: "Audit Logs" },
      /* Named "Settings & System" by the roadmap and built as the Security screen today - the one
         page that carries the platform's own system configuration (MFA enrolment, the CSP posture
         and the session rules). It keeps the roadmap's label because that is the roadmap's name for
         this seat in the tree, and the page it opens is the platform's system page. */
      { href: "/admin/security", label: "Settings & System" },
    ],
  },
];

/* Every OPENABLE entry, flattened, with the category it came from - the shape the palette searches.
   Derived rather than written down, and FILTERED to what can actually be opened: the palette is a
   launcher, and a `soon` row it offered would be a launcher that cannot launch. `activeHref` reads
   this same list, so a placeholder can never light up as the current page. */
export type FlatItem = { href: string; label: string; heading: string };

export function flatNav(): FlatItem[] {
  return GROUPS.flatMap((g) =>
    g.items.filter((it) => !it.soon).map((it) => ({ href: it.href, label: it.label, heading: g.heading })),
  );
}

/* Everything, placeholders included - what the SIDEBAR draws, since the roadmap's unbuilt half is
   exactly what it must show as muted rather than hide. */
export function allNav(): (NavItem & { heading: string })[] {
  return GROUPS.flatMap((g) => g.items.map((it) => ({ ...it, heading: g.heading })));
}

/* Route matching, defined ONCE here so the sidebar's current-page treatment cannot drift from any
   other reader of this list.

   `=== href || startsWith(href + "/")` was the whole rule, and it is right about SIBLINGS - a raw
   prefix test would light /admin/intake-queue together with /admin/intake. It is wrong about
   ANCESTORS, and the built page proved it rather than an argument: on /admin/dashboard the sidebar
   carried aria-current="page" TWICE, on Dashboard and on Overview, because /admin is a prefix of
   /admin/dashboard. The same shape lights two entries on every nested route, and with categories
   around them it would open two of those at once.

   So the current entry is the LONGEST href that matches, and only that one. A tie cannot happen:
   two distinct hrefs of equal length cannot both be prefixes of one path. */
export function activeHref(pathname: string): string | null {
  let best: string | null = null;
  for (const it of flatNav()) {
    if (!matches(pathname, it.href)) { continue; }
    if (best === null || it.href.length > best.length) { best = it.href; }
  }
  return best;
}

function matches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

/* The category the current route belongs to, or null. Null is a real answer rather than a failure:
   a page can exist outside every category, and the sidebar then opens nothing instead of guessing. */
export function activeGroupId(pathname: string): string | null {
  const href = activeHref(pathname);
  if (href === null) { return null; }
  for (const g of GROUPS) {
    if (g.items.some((it) => it.href === href)) { return g.id; }
  }
  return null;
}
