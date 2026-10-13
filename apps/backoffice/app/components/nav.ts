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
  /* A THIRD LEVEL, for an entry that is itself a small group of screens rather than one screen.
     "Inventory Management" is the asset workbench AND the lot process; naming both under it keeps
     the roadmap's grouping instead of flattening two different jobs into one list of peers.

     A PARENT IS STILL A LINK. It has its own page and keeps it - the row's anchor goes to the route
     and a separate chevron beside it opens the children, because a single control that both
     navigated and expanded would have to guess which the operator meant. That is also why the
     chevron is a SIBLING of the anchor rather than inside it: a button nested in an anchor is
     invalid markup and unreachable by keyboard in more than one browser. */
  children?: NavItem[];
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
      {
        href: "/admin/orders", label: "Commerce / Orders",
        children: [
          { href: "/admin/customers", label: "Customers" },
        ],
      },
      /* Fulfilment points at Pick & Pack, the screen an order is actually packed and dispatched on. */
      { href: "/admin/shipping", label: "Fulfillment & Shipping" },
    ],
  },
  {
    id: "catalog-inventory", heading: "Product Catalog & Inventory", icon: "crate", items: [
      {
        /* The asset workbench: the unit-level inventory browser, which is what "Inventory
           Management" names. Lot Process - the receiving and grading station - hangs under it, so
           the inventory half of the platform is one entry with its two jobs inside it rather than
           two peers that look like unrelated screens. */
        href: "/admin/assets", label: "Inventory Management",
        children: [
          { href: "/admin/intake", label: "Lot Process" },
        ],
      },
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
      /* Financials is live: the landing page carries the month's headline, and the three registers
         hang under it. The parent is a real page rather than a menu because "how are we doing" is
         the question an operator opens this section to ask. */
      {
        href: "/admin/finance", label: "Financials",
        children: [
          { href: "/admin/finance/invoices", label: "Invoices" },
          { href: "/admin/finance/expenses", label: "Expenses" },
          { href: "/admin/finance/pnl", label: "P&L Report" },
        ],
      },
      /* Still unbuilt, and still shown rather than hidden: there is no reporting surface beyond the
         statement, so this is the roadmap's one remaining placeholder under this category. */
      { href: "/admin/reports", label: "Reports & Business Intelligence", soon: true },
    ],
  },
  {
    id: "storefront-ai", heading: "Storefront & AI Tools", icon: "shop", items: [
      { href: "/admin/cms", label: "Storefront / CMS" },
      {
        /* The assistant is the entry point and the listing studio is what it produces listings in,
           so the studio hangs under the AI entry rather than beside it. */
        href: "/admin/assistant", label: "AI Intelligence",
        children: [
          { href: "/admin/ai/listings", label: "AI Listing Studio" },
        ],
      },
    ],
  },
  {
    id: "administration", heading: "Administration & Security", icon: "shield", items: [
      { href: "/admin/team", label: "Team & Access Control" },
      { href: "/admin/audit", label: "Audit Logs" },
      /* "Settings & System" is a real Settings page now: the business's own legal identity - the
         name, ABN and address every tax invoice prints - plus the system configuration behind the
         documents the shop issues. The Security screen it used to open (MFA enrolment, the CSP
         posture and the session rules) hangs UNDER it rather than losing its seat in the tree: it
         is still the platform's system page, just no longer the only one. */
      {
        href: "/admin/settings", label: "Settings & System",
        children: [
          { href: "/admin/security", label: "Security & MFA" },
        ],
      },
    ],
  },
];

/* Every OPENABLE entry, flattened, with the category it came from - the shape the palette searches.
   Derived rather than written down, and FILTERED to what can actually be opened: the palette is a
   launcher, and a `soon` row it offered would be a launcher that cannot launch. `activeHref` reads
   this same list, so a placeholder can never light up as the current page. */
export type FlatItem = { href: string; label: string; heading: string };

/* Every openable entry under `items`, at ANY depth. `soon` items are dropped here and their children
   with them - a placeholder is not a destination, and neither is anything filed under one, since
   there would be no way to reach the parent that reveals it. */
function routable(items: NavItem[]): NavItem[] {
  return items
    .filter((it) => !it.soon)
    .flatMap((it) => [it, ...routable(it.children ?? [])]);
}

export function flatNav(): FlatItem[] {
  return GROUPS.flatMap((g) =>
    routable(g.items).map((it) => ({ href: it.href, label: it.label, heading: g.heading })),
  );
}

/* Everything, placeholders included - what the SIDEBAR draws, since the roadmap's unbuilt half is
   exactly what it must show as muted rather than hide. */
export function allNav(): (NavItem & { heading: string })[] {
  return GROUPS.flatMap((g) => g.items.map((it) => ({ ...it, heading: g.heading })));
}

/* The nested groups the sidebar draws a disclosure for: the entries that have children. `subGroupId`
   is the stable key for one, and it is derived from the parent's href rather than from its label for
   the same reason a category's id is not its heading - remembered state keyed by copy would quietly
   forget itself the day someone reworded an entry. */
export function subGroupId(href: string): string {
  return "sub-" + href;
}

export function subGroupIds(): string[] {
  return GROUPS.flatMap((g) => g.items.filter((it) => (it.children ?? []).length > 0).map((it) => it.href));
}

/* The nested group a route lives in, or null - what the sidebar opens so the operator can see where
   they are. Only direct children count: an entry two levels down is still revealed by its own
   parent, and a rule that walked the whole subtree would open groups that do not contain the page. */
export function subGroupOf(pathname: string): string | null {
  for (const g of GROUPS) {
    for (const it of g.items) {
      for (const child of it.children ?? []) {
        if (pathname === child.href || pathname.startsWith(child.href + "/")) { return it.href; }
      }
    }
  }
  return null;
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
    /* Searched at every depth: the current page can be a nested entry ("Lot Process" under
       "Inventory Management"), and a rule that only looked at the top level would leave the
       operator's own category closed around them. */
    if (routable(g.items).some((it) => it.href === href)) { return g.id; }
  }
  return null;
}
