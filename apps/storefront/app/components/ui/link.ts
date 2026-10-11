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
