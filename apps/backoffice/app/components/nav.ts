/* The admin chrome's taxonomy - the ONE list of routes the app draws its navigation from.

   It lives here rather than inside layout.tsx because two things now render it: the sidebar and the
   command palette. A palette with its own copy of these thirteen entries is how the chrome grows a
   404 - the sidebar's rule is that every entry must have a page behind it, and a second list cannot
   keep that promise.

   The order is the order it renders. A group is one edit rather than a second copy of the markup. */
export type NavItem = { href: string; label: string };
export type NavGroup = { heading: string; items: NavItem[] };

export const GROUPS: NavGroup[] = [
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

/* Every entry, flattened, with the group it came from - the shape the palette searches. Derived
   rather than written down, so adding a route to GROUPS is the only edit either surface needs. */
export type FlatItem = NavItem & { heading: string };

export function flatNav(): FlatItem[] {
  return GROUPS.flatMap((g) => g.items.map((it) => ({ ...it, heading: g.heading })));
}
