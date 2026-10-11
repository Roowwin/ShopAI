/* UI primitives. `className` is for layout only - see cn.ts.

   HAND-MIRRORED from the storefront's apps/storefront/app/components/ui (branch
   `storefront-design-system`). There is no shared package, so the two copies must be kept in
   sync by hand: any change here needs the same change there, and vice versa. The backoffice
   additions are deliberate and documented at their definitions: Button carries two extra
   variants (`onDark`, `muted`) and one extra size (`inline`), and Input's padding is `py-2`
   rather than the storefront's roomier value so Button and Input share one 36px control height.
   Everything else is API-identical to the storefront.

   Table, Stat and Select are admin-only primitives the storefront has no call for.

   NOT copied from the storefront: Eyebrow, EmptyState, ProductCard. The backoffice needs the
   kicker as a CLASS rather than a component - a table header row is a `<tr>` and cannot contain
   the `<p>` that the storefront's Eyebrow renders - so it is defined once as `kickerClass` in
   lib/ui.ts and used by both Table's head row and Stat's label; there are no product tiles; and
   no empty-state component is in scope. */
export { default as Button } from "./Button";
export { default as Card } from "./Card";
export { default as Badge } from "./Badge";
export { default as Heading } from "./Heading";
export { default as Input } from "./Input";
export { default as Select } from "./Select";
export { default as Table, THead, TBody, TR, TH, TD } from "./Table";
export { default as Stat } from "./Stat";
export { cn } from "./cn";
