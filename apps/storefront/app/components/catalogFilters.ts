/* The catalog's filter vocabulary, and the ONE place a filter set becomes a query string.

   Both sides of the page use this module: the server component parses the incoming URL and builds
   the API call, the client component writes the URL back when a facet is picked. That is what makes
   the URL the single source of truth - a pasted link is parsed by exactly the code that produced it,
   so the same link always renders the same view, and the API never sees a value this module would
   not have written itself.

   Parsing is deliberately forgiving: an unknown grade, a malformed brand or a contradictory price
   band is DROPPED rather than passed on (the endpoint would answer 422 and the page would die on a
   typo in a shared link). Every dropped value simply leaves its facet on "All", which is the
   honest reading of a link that asks for something that does not exist.

   Price bands are carried as min_cents/max_cents - the endpoint's own parameters - rather than as a
   band key, so a band is expressible without the server having to know the presets. */

export type Filters = {
  category: string | null;
  brand: string | null;
  grade: string | null;
  /** A free-text term, searched inside whatever else is selected - see MAX_Q below. */
  q: string | null;
  min_cents: number | null;
  max_cents: number | null;
  sort: string;
};

export const EMPTY_FILTERS: Filters = {
  category: null, brand: null, grade: null, q: null,
  min_cents: null, max_cents: null, sort: "featured",
};

/* The term's cap, mirroring the endpoint's (store_catalog.py MAX_Q). The endpoint REFUSES a longer
   one with 422 - and this page has to render for a shopper who typed it - so the URL layer drops it
   instead, exactly as it drops a malformed brand: the reading of a link that asks for something
   impossible is "no such filter", never a dead page. */
export const MAX_Q = 100;

export const GRADES = ["A", "B", "C", "D"];

export const SORTS = [
  { value: "featured", label: "Featured" },
  { value: "new", label: "New" },
  { value: "price_asc", label: "Price ↑" },
  { value: "price_desc", label: "Price ↓" },
  { value: "name", label: "Name" },
];

/* The presets the Price facet offers. `value` is the option's key; the band it means is min/max,
   which is what the URL carries.

   The steps follow the shelf rather than round numbers: against the live catalog (57 priced
   products, $13 to $1,104, median $164) they split 31 / 20 / 5 / 1, so no band is a dead end that
   can only ever return the empty state. */
export const PRICE_BANDS = [
  { value: "under-200", label: "Under $200", min: null as number | null, max: 20000 as number | null },
  { value: "200-500", label: "$200 - $500", min: 20000, max: 50000 },
  { value: "500-1000", label: "$500 - $1,000", min: 50000, max: 100000 },
  { value: "1000-plus", label: "$1,000+", min: 100000, max: null },
];

/* A whole-dollar figure for a band label, thousands separated. Deliberately not toLocaleString:
   these strings are rendered on the server and in the browser, and a locale that resolves
   differently in the two is a hydration mismatch. */
function dollars(cents: number): string {
  return "$" + String(Math.round(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/* How a price in force reads. A preset answers with its own label; any other pair - every band of
   the previous set is one, and so is a hand-written URL - is described by its own numbers instead of
   being announced as a bare "price band". The grid behind is filtered by exactly those numbers, so
   the control has to say them. */
export function bandLabel(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  const preset = PRICE_BANDS.find((b) => b.min === min && b.max === max);
  if (preset) return preset.label;
  if (min === null) return "Under " + dollars(max as number);
  if (max === null) return dollars(min) + "+";
  return dollars(min) + " - " + dollars(max);
}

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
  const rawQ = one(sp.q);
  const sort = one(sp.sort);
  let min = cents(one(sp.min_cents));
  let max = cents(one(sp.max_cents));
  if (min !== null && max !== null && min > max) { min = null; max = null; }   // contradictory band
  return {
    category,
    brand: BRAND_SLUG.test(rawBrand) ? rawBrand : null,
    grade: GRADES.includes(rawGrade) ? rawGrade : null,
    q: rawQ !== null && rawQ.length <= MAX_Q ? rawQ : null,
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
  if (f.q) p.set("q", f.q);
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
  if (f.q) out.push("search \"" + f.q + "\"");
  const band = bandLabel(f.min_cents, f.max_cents);
  if (band) out.push(band.toLowerCase());
  if (f.sort !== "featured") out.push("sorted by " + (SORTS.find((s) => s.value === f.sort)?.label ?? f.sort));
  return out;
}

export function hasFilters(f: Filters): boolean {
  return activeFilters(f).length > 0;
}
