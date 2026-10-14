/* What the Product groups list and a group's own page BOTH need.

   Two files now render a product group - the table at /admin/product-groups and the page at
   /admin/product-groups/{id} - and both draw the same state badge and read the same shape. A second
   copy of either would be a second thing to keep in step, and the one that drifted would be the one
   nobody was looking at. */

export type Group = {
  id: number; brand: string; model: string; grade: string;
  state: "needs_setup" | "ready" | "live";
  storefront_id: string | null; product_id: number | null;
  media_id: number | null; image_url: string | null;
  price_override: number | null; price_source: string | null;
  published_at: string | null;
  units_total: number; units_listed: number;
  basis_max: number | null; fmv_variants: number;
  below_cost_if_priced_here: boolean;
  /* Usually one. A group is keyed on brand+model+grade and not on the category, so a model whose
     Category was spelled two ways on two sheets sits in two categories under one group. */
  categories: string[];
};

export type Detail = Group & {
  aggregates: {
    units_total: number; units_listed: number; units_publishable: number;
    fmv: { min: number | null; max: number | null; avg: number | null; median: number | null; variants: number };
    resale: { min: number | null; max: number | null; avg: number | null; median: number | null; variants: number };
    basis: { min: number | null; max: number | null };
    target_markup_pct: number;
  };
};

/* Which of the three summaries a quick-fill button reads. `median` is first because it is the
   default and the reason the picker exists. */
export const BASIS = [
  { key: "median", label: "Median" },
  { key: "max", label: "Highest" },
  { key: "avg", label: "Average" },
] as const;

export type BasisKey = (typeof BASIS)[number]["key"];

export function stateBadge(state: Group["state"]) {
  if (state === "live") return { text: "Live", cls: "bg-status-listed-soft text-status-listed-ink" };
  if (state === "ready") return { text: "Ready", cls: "bg-status-graded-soft text-status-graded-ink" };
  return { text: "Needs setup", cls: "bg-status-received-soft text-status-received-ink" };
}
