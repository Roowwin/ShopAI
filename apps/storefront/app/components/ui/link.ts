/* The one treatment for a link inside running text.

   Six content pages had grown three different spellings of the same link
   (`text-brand-700 underline`, `text-brand-700 hover:underline`, and a bare `text-brand-700`),
   and none of them was keyboard-visible. This constant is the single source: underlined at rest
   so a link is still recognisable without colour (WCAG 1.4.1 - the underline is the affordance,
   the emerald is only reinforcement), a heavier underline and a darker emerald on hover, and the
   same emerald focus ring every other control uses.

   Callers pass layout spacing only - see cn.ts, a caller's className appends and cannot replace
   any of this. */
export const linkClass =
  "text-brand-700 font-medium underline underline-offset-2 decoration-brand-300 rounded-sm " +
  "transition-colors duration-fast ease-out hover:text-brand-800 hover:decoration-brand-700 active:text-brand-900 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 " +
  "motion-reduce:transition-none";

/* A menu link on a light surface (the header nav, the mobile drawer). Same hover shade and same
   motion token as linkClass, but no underline: in a menu the position and grouping already say
   "link", so an underline at rest would only add noise. The dark footer menu, which sits on
   ink-900, shifts to brand-300 instead and is styled where it lives. */
export const navLinkClass =
  "transition-colors duration-fast ease-out hover:text-brand-700 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 " +
  "motion-reduce:transition-none";

/* The dark footer menu, which sits on ink-900.

   The accent and the focus ring are both brand-300 here rather than brand-700: on the charcoal
   footer brand-700 measures 2.3:1, so it is neither readable as an ink nor visible as a ring,
   while brand-300 is the one brand step light enough for both (6.6:1). That is the same reason
   the storefront's dark surfaces already hover to brand-300.

   The seven footer links had no focus treatment at all before this - they carried
   `transition-colors` and nothing else, so a keyboard user crossing the footer saw no indicator
   at all. The ring's offset band is the footer's own ground, so the ring reads as a gap around
   the word rather than a white box on a dark page. */
export const footerLinkClass =
  "transition-colors duration-fast ease-out hover:text-brand-300 " +
  "rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900 motion-reduce:transition-none";

/* The inline link on a DARK ground - the dark product page's breadcrumbs, its spec meta line and
   its grade-scale link. It is `linkClass`'s underlined treatment with the footer's colours: on
   charcoal, `text-brand-700` measures 2.3:1, so both the ink and the focus ring move to
   brand-300 (6.9:1). The offset band is left to the page's own scope - see `.pdp-dark` in
   globals.css, which sets --tw-ring-offset-color to the ground it sits on. */
export const linkOnDarkClass =
  "text-brand-300 font-medium underline underline-offset-2 decoration-brand-700 rounded-sm " +
  "transition-colors duration-fast ease-out hover:text-brand-100 hover:decoration-brand-300 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 " +
  "motion-reduce:transition-none";
