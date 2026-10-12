/* The Shop menu's second level: the sub-categories that actually select something.

   CURATED, and deliberately short. The categories themselves come from /store/categories - the header
   renders what the API lists - and this file only adds a level underneath. It must never become a
   second source of category names.

   A shortcut is a category plus a search TERM, and it is only worth having if it selects stock. Every
   pair below was measured against the live catalogue before it was written down, and two of them read
   differently from the word searched, which is why label and term are separate fields:

     - "Mice" searches `mouse`: the text search does not map the irregular plural, and `mice` finds
       nothing at all while the shop holds two mice.
     - "Keyboards" searches `keyboard`, the word in the product's own name.

   Laptops has no entry on purpose: "Gaming", "Business" and "Ultrabooks" each match nothing in this
   catalogue, so that menu stays a single link. Writing a pair down without checking it is how the
   first draft of this feature proposed seven links that led to an empty catalog.

   If a pair ever stops matching - the last dock sells - it must be removed rather than left to open
   an empty grid. The acceptance for this job is that every link resolves to stock. */

export type NavShortcut = { label: string; term: string };

export const NAV_SHORTCUTS: Record<string, NavShortcut[]> = {
  Accessories: [
    { label: "Docks", term: "dock" },
    { label: "Mice", term: "mouse" },
    { label: "Keyboards", term: "keyboard" },
    { label: "Hubs", term: "hub" },
    { label: "Webcams", term: "webcam" },
    { label: "Headsets", term: "headset" },
  ],
  Networking: [
    { label: "Switches", term: "switch" },
    { label: "Routers", term: "router" },
  ],
};

/* The shortcuts for one category, or undefined when it has none - which is what keeps a category
   without an entry a single link.

   An own-property check rather than a plain index: NAV_SHORTCUTS is an object literal, so a category
   named "constructor", "toString" or "__proto__" - names a staff member can create through the
   catalog API - would otherwise come back as an inherited function. That is truthy and not an array,
   and the menu would crash rendering it. */
export function shortcutsFor(categoryName: string): NavShortcut[] | undefined {
  return Object.hasOwn(NAV_SHORTCUTS, categoryName) ? NAV_SHORTCUTS[categoryName] : undefined;
}

/* The catalog URL for one shortcut. The category goes in as its slug - every category's name is its
   slug capitalised, which the endpoint's own note says - and the term goes in as ?q=, which is the
   filter rather than free text: the server scopes it to the category, so "Routers" under Networking
   cannot return a router-shaped thing from somewhere else. */
export function shortcutHref(categoryName: string, term: string): string {
  const p = new URLSearchParams({ category: categoryName.toLowerCase(), q: term });
  return "/?" + p.toString();
}
