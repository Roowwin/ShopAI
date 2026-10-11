/* The catalog's filter vocabulary, and the ONE place a filter set becomes a query string.

   Both sides of the page use this module: the server component parses the incoming URL and builds
   the API call, the client component writes the URL back when a chip is clicked. That is what makes
   the URL the single source of truth - a pasted link is parsed by exactly the code that produced it,
   so the same link always renders the same view, and the API never sees a value this module would
   not have written itself.

   Parsing is deliberately forgiving: an unknown grade, a malformed brand or a contradictory price
   band is DROPPED rather than passed on (the endpoint would answer 422 and the page would die on a
   typo in a shared link). Every dropped value simply leaves its chip row on "All", which is the
   honest reading of a link that asks for something that does not exist.

   Price bands are carried as min_cents/max_cents - the endpoint's own parameters - rather than as a
   band key, so a band is expressible without the server having to know the presets. */

export type Filters = {
  category: string | null;
  brand: string | null;
  grade: string | null;
  min_cents: number | null;
  max_cents: number | null;
  sort: string;
};

export const EMPTY_FILTERS: Filters = {
  category: null, brand: null, grade: null, min_cents: null, max_cents: null, sort: "featured",
};

export const GRADES = ["A", "B", "C", "D"];

export const SORTS = [
  { value: "featured", label: "Featured" },
  { value: "new", label: "New" },
  { value: "price_asc", label: "Price ↑" },
  { value: "price_desc", label: "Price ↓" },
  { value: "name", label: "Name" },
];

/* The presets the chip row offers. `value` is the chip's key; the band it means is min/max, which
   is what the URL carries. */
export const PRICE_BANDS = [
  { value: "under-100", label: "Under $100", min: null as number | null, max: 10000 as number | null },
  { value: "100-300", label: "$100 - $300", min: 10000, max: 30000 },
  { value: "300-600", label: "$300 - $600", min: 30000, max: 60000 },
  { value: "600-plus", label: "$600+", min: 60000, max: null },
];

const BRAND_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

function one(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  const t = (s ?? "").trim();
  return t === "" ? null : t;
}

function cents(v: string | null): number | null {
  if (v === null || !/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n <= 100_000_000 ? n : null;
}

export function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const category = one(sp.category);
  const rawBrand = (one(sp.brand) ?? "").toLowerCase();
  const rawGrade = (one(sp.grade) ?? "").toUpperCase();
  const sort = one(sp.sort);
  let min = cents(one(sp.min_cents));
  let max = cents(one(sp.max_cents));
  if (min !== null && max !== null && min > max) { min = null; max = null; }   // contradictory band
  return {
    category,
    brand: BRAND_SLUG.test(rawBrand) ? rawBrand : null,
    grade: GRADES.includes(rawGrade) ? rawGrade : null,
    min_cents: min,
    max_cents: max,
    sort: SORTS.some((s) => s.value === sort) ? (sort as string) : "featured",
  };
}

/* The canonical query string for a filter set - the URL a chip click writes, and the filter half of
   the API call. Defaults are omitted, so the unfiltered catalog is "/" with no query at all. */
export function filterQuery(f: Filters): string {
  const p = new URLSearchParams();
  if (f.category) p.set("category", f.category);
  if (f.brand) p.set("brand", f.brand);
  if (f.grade) p.set("grade", f.grade);
  if (f.min_cents !== null) p.set("min_cents", String(f.min_cents));
  if (f.max_cents !== null) p.set("max_cents", String(f.max_cents));
  if (f.sort && f.sort !== "featured") p.set("sort", f.sort);
  return p.toString();
}

/* The API call for one page. `withFilters` asks the endpoint for the envelope that carries the
   applied filter set and the live brand options; without it the response is the bare array the
   backoffice reads. */
export function catalogPath(f: Filters, opts: { limit: number; offset?: number; withFilters?: boolean }): string {
  const p = new URLSearchParams(filterQuery(f));
  p.set("limit", String(opts.limit));
  p.set("offset", String(opts.offset ?? 0));
  if (opts.withFilters) p.set("with_filters", "1");
  return "/store/catalog?" + p.toString();
}

export function activeFilters(f: Filters): string[] {
  const out: string[] = [];
  if (f.category) out.push("category " + f.category);
  if (f.brand) out.push("brand " + f.brand);
  if (f.grade) out.push("grade " + f.grade);
  const band = PRICE_BANDS.find((b) => b.min === f.min_cents && b.max === f.max_cents);
  if (band) out.push(band.label.toLowerCase());
  else if (f.min_cents !== null || f.max_cents !== null) out.push("price band");
  if (f.sort !== "featured") out.push("sorted by " + (SORTS.find((s) => s.value === f.sort)?.label ?? f.sort));
  return out;
}

export function hasFilters(f: Filters): boolean {
  return activeFilters(f).length > 0;
}
