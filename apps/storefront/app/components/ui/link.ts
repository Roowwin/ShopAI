/* The two link treatments, and only two.

   Both are written for the ground this app is actually on. The old split - one pair for the warm
   light pages, another for the charcoal footer, and a third added for the dark product page - was
   three spellings of one idea, kept apart only because the app used to have two grounds. It has
   one now, so `linkOnDarkClass` and `footerLinkClass` are gone and the ink is `brand-300`
   everywhere. (`brand-700` is the button FILL; as ink on this ground it measures 2.3:1.)

   linkClass - a link inside running text. Underlined at rest so it is still recognisable without
   colour (WCAG 1.4.1: the underline is the affordance, the green is only reinforcement), a
   heavier underline and a lighter green on hover, and the same focus ring every control uses.

   navLinkClass - a link in a menu (the header nav, the mobile drawer, the footer). Same hover
   shade and same motion token, but no underline: in a menu the position and grouping already say
   "link", so an underline at rest would only add noise.

   Callers pass layout spacing only - see cn.ts; a caller's className appends and cannot replace
   any of this. */
export const linkClass =
  "text-brand-300 font-medium underline underline-offset-2 decoration-brand-700 rounded-sm " +
  "transition-colors duration-fast ease-out hover:text-brand-100 hover:decoration-brand-300 active:text-brand-300 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 " +
  "motion-reduce:transition-none";

export const navLinkClass =
  "transition-colors duration-fast ease-out hover:text-brand-300 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 " +
  "motion-reduce:transition-none";
