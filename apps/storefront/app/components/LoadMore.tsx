"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API } from "@/lib/api";
import { Button, EmptyState, ProductCard } from "./ui";
import FacetDropdown from "./FacetDropdown";
import {
  activeFilters, catalogPath, EMPTY_FILTERS, filterQuery, Filters, GRADES, hasFilters,
  PRICE_BANDS, SORTS,
} from "./catalogFilters";

/* The catalog: one page of products, the facet toolbar above it, and "load more" below.

   THE URL IS THE STATE. This component never holds a filter of its own - the filter set arrives as
   `applied` (parsed from the URL by the server component on load, and echoed by the API), and a
   facet pick is nothing but `router.push` of the new query string. The server then re-renders the
   page with the new set and the first page of results arrives as a new `initial`, so a link pasted
   into a message renders exactly the view the sender had - and the back button walks the filter
   history, because every filter change is a real navigation.

   The toolbar is the render layer: five dropdowns where there used to be five rows of chips, so
   the filters are one line instead of a block taller than the first page of products. Every
   dropdown still carries its own "All"/"Any" option, which is how a single facet is undone; the
   toolbar's Clear all is the whole set at once. Opening one panel is state here (not in the
   dropdowns) so two panels can never be open at the same time.

   Paging is the one thing that does not go through the URL: "load more" appends the next offset of
   the SAME filter set to `extra`, and `extra` is dropped whenever the filter signature changes
   (which is what the `sig` effect is for - not the array identity of `initial`, or any unrelated
   re-render would throw the appended pages away). */

type Cat = { name: string; n: number };
type Brand = { slug: string; name: string; n: number };
const PAGE = 8;

export default function LoadMore({ initial, applied, categories, brands }: {
  initial: any[];
  /** The filter set in force. Absent means this is not the URL-state catalog view (the category
      page renders the same grid with no toolbar), so the toolbar appears exactly where the query
      string is the state. */
  applied?: Filters | null;
  categories?: Cat[];
  brands?: Brand[];
}) {
  const router = useRouter();
  const [extra, setExtra] = useState<any[]>([]);
  const [exhausted, setExhausted] = useState(false);
  const [busy, setBusy] = useState(false);
  // Which facet's panel is open. The toolbar holds this rather than each dropdown holding its own,
  // so opening one closes the other - and a pick (a navigation) closes them all with the reload.
  const [openFacet, setOpenFacet] = useState<string | null>(null);

  const filters = applied ?? EMPTY_FILTERS;
  const sig = applied ? filterQuery(filters) : "";
  useEffect(() => { setExtra([]); setExhausted(false); }, [sig]);

  const items = [...(initial ?? []), ...extra];
  const more = !exhausted && items.length >= PAGE;
  const filtered = Boolean(applied) && hasFilters(filters);

  function apply(next: Filters) {
    const qs = filterQuery(next);
    router.push(qs ? "/?" + qs : "/", { scroll: false });
  }

  async function loadMore() {
    setBusy(true);
    try {
      const r = await fetch(API + catalogPath(filters, { limit: PAGE, offset: items.length }), { cache: "no-store" });
      if (r.ok) {
        const j: any[] = await r.json();
        setExtra((p) => [...p, ...j]);
        if (j.length < PAGE) { setExhausted(true); }
      }
    } catch { void 0; }
    setBusy(false);
  }

  const catValue = (categories ?? []).find(
    (c) => c.name.toLowerCase() === (filters.category ?? "").toLowerCase())?.name ?? null;
  const bandValue = PRICE_BANDS.find(
    (b) => b.min === filters.min_cents && b.max === filters.max_cents)?.value ?? null;
  const ALL = { value: null, label: "All" };

  return (
    <div>
      {applied && (
        // One line of dropdowns. On phones the row scrolls sideways rather than stacking (the
        // panels are viewport-anchored, so the scroll container cannot clip them); from sm up there
        // is room for the whole toolbar and nothing needs to scroll at all.
        <div className="flex items-center gap-2 mt-6 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible">
          {categories && categories.length > 1 && (
            <FacetDropdown label="Category" value={catValue}
              options={[ALL, ...categories.map((c) => ({ value: c.name, label: c.name + " (" + c.n + ")" }))]}
              onSelect={(v) => apply({ ...filters, category: v })}
              open={openFacet === "category"} onOpenChange={(o) => setOpenFacet(o ? "category" : null)} />
          )}
          {brands && brands.length > 1 && (
            <FacetDropdown label="Brand" value={filters.brand}
              options={[ALL, ...brands.map((b) => ({ value: b.slug, label: b.name + " (" + b.n + ")" }))]}
              onSelect={(v) => apply({ ...filters, brand: v })}
              open={openFacet === "brand"} onOpenChange={(o) => setOpenFacet(o ? "brand" : null)} />
          )}
          <FacetDropdown label="Grade" value={filters.grade}
            options={[ALL, ...GRADES.map((g) => ({ value: g, label: "Grade " + g }))]}
            onSelect={(v) => apply({ ...filters, grade: v })}
            open={openFacet === "grade"} onOpenChange={(o) => setOpenFacet(o ? "grade" : null)} />
          <FacetDropdown label="Price" value={bandValue}
            options={[{ value: null, label: "Any" }, ...PRICE_BANDS.map((b) => ({ value: b.value, label: b.label }))]}
            onSelect={(v) => {
              const band = PRICE_BANDS.find((b) => b.value === v);
              apply({ ...filters, min_cents: band ? band.min : null, max_cents: band ? band.max : null });
            }}
            open={openFacet === "price"} onOpenChange={(o) => setOpenFacet(o ? "price" : null)} />
          {/* Sort is the one facet with no reset: featured IS a value (the at-rest one), which is why
              filterQuery omits it and why its options carry no "All". Its labels come from the map in
              catalogFilters.ts, so a new sort is a new entry there and never a second vocabulary. */}
          <FacetDropdown label="Sort" value={filters.sort}
            options={SORTS.map((s) => ({ value: s.value, label: s.label }))}
            onSelect={(v) => apply({ ...filters, sort: v ?? "featured" })}
            open={openFacet === "sort"} onOpenChange={(o) => setOpenFacet(o ? "sort" : null)} />
          {hasFilters(filters) && (
            <Button variant="ghost" size="sm" className="shrink-0" onClick={() => apply(EMPTY_FILTERS)}>
              Clear all
            </Button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6 mt-8">
        {items.map((i) => (
          <ProductCard key={i.slug} variant="full" href={"/products/" + i.slug} title={i.title}
            brand={i.brand} category={i.category} slug={i.slug} imageUrl={i.image_url}
            priceCents={i.price_from_cents} stock={{ n: i.units_available }} />
        ))}
        {items.length === 0 && (
          <div className="col-span-full">
            <EmptyState>
              {filtered
                ? "No devices match " + activeFilters(filters).join(", ") + "."
                : "Nothing is listed yet - check back soon."}
            </EmptyState>
            {filtered && (
              <Button variant="secondary" size="sm" className="mt-4" onClick={() => apply(EMPTY_FILTERS)}>
                Clear filters
              </Button>
            )}
          </div>
        )}
      </div>
      {more && (
        <div className="text-center mt-10">
          <Button variant="secondary" onClick={() => void loadMore()} disabled={busy}>{busy ? "Loading..." : "Load more"}</Button>
        </div>
      )}
    </div>
  );
}
