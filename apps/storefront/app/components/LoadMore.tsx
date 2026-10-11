"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API } from "@/lib/api";
import { Button, ChipRow, EmptyState, ProductCard } from "./ui";
import {
  activeFilters, catalogPath, EMPTY_FILTERS, filterQuery, Filters, GRADES, hasFilters,
  PRICE_BANDS, SORTS,
} from "./catalogFilters";

/* The catalog: one page of products, the filter rows above it, and "load more" below.

   THE URL IS THE STATE. This component never holds a filter of its own - the filter set arrives as
   `applied` (parsed from the URL by the server component on load, and echoed by the API), and a chip
   click is nothing but `router.push` of the new query string. The server then re-renders the page
   with the new set and the first page of results arrives as a new `initial`, so a link pasted into a
   message renders exactly the view the sender had - and the back button walks the filter history,
   because every filter change is a real navigation.

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
      page renders the same grid with no filter rows), so the rows appear exactly where the query
      string is the state. */
  applied?: Filters | null;
  categories?: Cat[];
  brands?: Brand[];
}) {
  const router = useRouter();
  const [extra, setExtra] = useState<any[]>([]);
  const [exhausted, setExhausted] = useState(false);
  const [busy, setBusy] = useState(false);

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
        <div className="flex flex-col gap-3 mt-6">
          {categories && categories.length > 1 && (
            <ChipRow label="Category" value={catValue} onChange={(v) => apply({ ...filters, category: v })}
              options={[ALL, ...categories.map((c) => ({ value: c.name, label: c.name + " (" + c.n + ")" }))]} />
          )}
          {brands && brands.length > 1 && (
            <ChipRow label="Brand" value={filters.brand} onChange={(v) => apply({ ...filters, brand: v })}
              options={[ALL, ...brands.map((b) => ({ value: b.slug, label: b.name + " (" + b.n + ")" }))]} />
          )}
          <ChipRow label="Grade" value={filters.grade} onChange={(v) => apply({ ...filters, grade: v })}
            options={[ALL, ...GRADES.map((g) => ({ value: g, label: "Grade " + g }))]} />
          <ChipRow label="Price" value={bandValue}
            onChange={(v) => {
              const band = PRICE_BANDS.find((b) => b.value === v);
              apply({ ...filters, min_cents: band ? band.min : null, max_cents: band ? band.max : null });
            }}
            options={[{ value: null, label: "Any" }, ...PRICE_BANDS.map((b) => ({ value: b.value, label: b.label }))]} />
          <ChipRow label="Sort" value={filters.sort} onChange={(v) => apply({ ...filters, sort: v ?? "featured" })}
            options={SORTS.map((s) => ({ value: s.value, label: s.label }))} />
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
