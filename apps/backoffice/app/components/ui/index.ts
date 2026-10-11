/* UI primitives. `className` is for layout only - see cn.ts.

   HAND-MIRRORED from the storefront's apps/storefront/app/components/ui (branch
   `storefront-design-system`). There is no shared package, so the two copies must be kept in
   sync by hand: any change here needs the same change there, and vice versa.

   The storefront also ships Eyebrow, EmptyState and ProductCard. They are deliberately not
   copied here - no backoffice page in this job's scope needs a kicker on its own (Table's
   header row owns that), and the backoffice has no product tiles. Add them only if a page
   actually needs them, and then copy them from the storefront rather than inventing variants. */
export { default as Button } from "./Button";
export { default as Card } from "./Card";
export { default as Badge } from "./Badge";
export { default as Heading } from "./Heading";
export { default as Input } from "./Input";
export { default as Table, THead, TBody, TR, TH, TD } from "./Table";
export { default as Stat } from "./Stat";
export { cn } from "./cn";
