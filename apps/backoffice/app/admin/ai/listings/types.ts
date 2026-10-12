/* The shapes the listing studio works in.

   TWO SOURCES, AND THEY ARE DIFFERENT RECORDS - which is why they are named apart rather than
   merged into one "product" object. The studio is entered from a UNIT (a serial, an asset id, or a
   lot the operator searched) and what it drafts is a PRODUCT's copy, because the draft endpoint
   takes a product id and nothing else. So every panel holds a unit beside its product, and nothing
   here is inferred from the other shape:

   - CatalogItem  - one row of GET /store/catalog, as the public handler answers it. This is the
                    product-side record: brand, model, specs, price-from.
   - WorklistAsset / Worklist - one page of GET /staff/lots/worklist, the staff door that resolves
                    a serial, an asset id or a lot number. `match.resolved_by` says WHICH rule
                    matched and is surfaced rather than swallowed: a search that silently picks one
                    reading of an ambiguous term is a search whose answer nobody can check.

   Every field below is one the handler genuinely returns. The catalogue's keys nothing here draws
   (image_url, featured) are deliberately left untyped so this file cannot grow a field the API
   does not send. */

/** One catalogue item, as the public catalogue handler answers it. */
export type CatalogItem = {
  id: number;
  public_id: string;
  slug: string;
  title: string;
  model: string | null;
  brand: string | null;
  category: string | null;
  /** a flat object of short keys whose values carry their own unit */
  specs: Record<string, unknown> | null;
  units_available: number;
  price_from_cents: number | null;
};

/** One unit, as the lot worklist answers it. */
export type WorklistAsset = {
  id: number;
  public_id: string;
  serial_number: string | null;
  status: string;
  grade: string | null;
  product_id: number | null;
  product_title: string | null;
  product_model: string | null;
  category: string | null;
  /** the merged audit/cosmetic/functional note the importer wrote - the raw technical notes */
  notes: string | null;
  gradable: boolean;
  ready_for_pricing: boolean;
};

/** One unit's full record, as GET /staff/assets/{id} answers it.

    Read on top of the worklist row for two things the worklist does not carry: the sale price, and
    the unit's own authoritative notes. Both matter here rather than being belt-and-braces - a unit
    cannot go to `listed` without a sale price (the DB's chk_listed_has_price), so the studio has to
    be able to say that BEFORE the operator presses publish. */
export type AssetDetail = {
  id: number;
  public_id: string;
  product_id: number | null;
  serial_number: string | null;
  imei: string | null;
  status: string;
  grade: string | null;
  cost_cents: number | null;
  sale_price_cents: number | null;
  intake_at: string | null;
  location: string | null;
  notes: string | null;
  lot_id: number | null;
  updated_at: string | null;
};

/** The worklist page for one resolved term. */
export type Worklist = {
  /** which rule matched the term: lot_number, asset_id or serial */
  match: { kind: string; resolved_by: string; term: string | null };
  /** the unit the term NAMED, when it named one - it does not filter `assets` */
  highlight_asset_id: number | null;
  lot: { id: number; lot_number: string; status: string; warehouse: string | null; received_at: string };
  progress: { total_units: number; received_units: number; graded_units: number;
              awaiting_grade_units: number; ready_for_pricing_units: number };
  scope: string;
  assets: WorklistAsset[];
  truncated: boolean;
  limit: number;
};

/** The copy the model returned. `keywords` are a suggestion - a product row has no column for them. */
export type Draft = { title: string; description: string; keywords: string[] };

/* The vibes the switcher offers. These three strings are the SAME keys the backend validates
   against (`staff_ai.DESC_TONES`), so a fourth chip here with no key there would be a control that
   always 422s - and the reverse, a vibe the backend knows that the UI never offers, is dead code.
   The labels are the keys capitalised; one list, so the switch and the request cannot drift. */
export const VIBES = ["professional", "enthusiast", "budget"] as const;
export type Vibe = (typeof VIBES)[number];
