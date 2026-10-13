/* The admin chrome's taxonomy - the ONE list of routes the app draws its navigation from.

   It lives here rather than inside layout.tsx because two things render it: the sidebar and the
   command palette. A palette with its own copy of these entries is how the chrome grows a 404 - the
   sidebar's rule is that every entry must have a page behind it, and a second list cannot keep that
   promise.

   The order is the order it renders. A category is one edit rather than a second copy of the
   markup, and BOTH surfaces follow from this file alone: the sidebar draws the categories as
   disclosures and the palette derives its flat, searchable run from them with flatNav().

   Seven categories, sixteen entries, grouped by what an operator is doing rather than by which
   store a route reads. The brief for this regroup also named an "Account (User profile)" category;
   it is deliberately absent, because /admin/account has no page behind it and the chrome's own rule
   outranks the brief. Every existing entry keeps the label it already had - a regroup moves entries
   between headings, and renaming them would be a second change wearing the first one's clothes.

   No icon markup lives here. A category names the icon it draws and the sidebar owns the one map
   from that name to path data, so this file stays the taxonomy rather than becoming half a
   component. `id` is the stable key - the disclosure's element ids and the one thing remembered
   between visits - and it is not the heading, because a heading is copy: remembered state keyed by
   copy would quietly forget itself the day someone reworded a category. */

export type NavItem = { href: string; label: string };

/* The icons a category can name. The sidebar's map is typed by this union, so naming an icon here
   and not drawing it there is a compile error rather than an empty space in the rail. */
export type NavIcon = "gauge" | "crate" | "receipt" | "shop" | "spark" | "plug" | "shield";

export type NavGroup = { id: string; heading: string; icon: NavIcon; items: NavItem[] };

export const GROUPS: NavGroup[] = [
  /* Two entries, one name each: the dashboard job added /admin/dashboard, and the entry that used
     to be called "Dashboard" is now "Overview" - so the word Dashboard points at exactly one
     route and the older /admin summary keeps a name of its own. */
  { id: "command-center", heading: "Command Center", icon: "gauge", items: [
    { href: "/admin/dashboard", label: "Dashboard" },
    { href: "/admin", label: "Overview" },
  ] },
  /* The listing studio sits beside the lot it lists rather than under the AI heading it used to
     share: an operator pricing stock is doing inventory work, and a page's heading is a statement
     about who goes there. */
  { id: "inventory", heading: "Inventory & Logistics", icon: "crate", items: [
    { href: "/admin/intake", label: "Lot Process" },
    { href: "/admin/product-import", label: "Product Import" },
    { href: "/admin/assets", label: "Assets" },
    { href: "/admin/ai/listings", label: "AI listings" },
  ] },
  { id: "commerce", heading: "Commerce", icon: "receipt", items: [
    { href: "/admin/orders", label: "Orders" },
    { href: "/admin/customers", label: "Customers" },
    { href: "/admin/audit", label: "Audit" },
  ] },
  { id: "storefront", heading: "Storefront", icon: "shop", items: [
    { href: "/admin/cms", label: "CMS" },
    { href: "/admin/newsletter", label: "Newsletter" },
  ] },
  { id: "ai", heading: "AI Intelligence", icon: "spark", items: [
    { href: "/admin/assistant", label: "Assistant" },
    { href: "/admin/agents", label: "Agents" },
  ] },
  /* The three marketplace hubs, whose pages landed with this category. This build has no
     marketplace integration behind them, so each page says so in its own words rather than drawing
     a connected dashboard it cannot back. */
  { id: "omnichannel", heading: "Omnichannel", icon: "plug", items: [
    { href: "/admin/channels/ebay", label: "eBay Hub" },
    { href: "/admin/channels/amazon", label: "Amazon Hub" },
    { href: "/admin/channels/facebook", label: "FB Marketplace" },
  ] },
  /* Security is not an "Account" screen: it is the one page that guards the whole portal, and it
     reads as a system surface beside the channels that reach outside this building. */
  { id: "system", heading: "System", icon: "shield", items: [
    { href: "/admin/security", label: "Security" },
    /* Team sits here rather than under a commerce heading: the roster decides what every other
       entry in this file opens, which makes it a system surface, not a staffing one. */
    { href: "/admin/team", label: "Team" },
  ] },
];

/* Every entry, flattened, with the category it came from - the shape the palette searches. Derived
   rather than written down, so adding a route to GROUPS is the only edit either surface needs. */
export type FlatItem = NavItem & { heading: string };

export function flatNav(): FlatItem[] {
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
