"use client";

import { Button, Heading, Select } from "@/app/components/ui";
import { kickerClass } from "@/lib/ui";
import { aud } from "@/lib/format";

/* The left column of the listing studio: which product, and the facts a draft is written from.

   EVERY VALUE HERE COMES OFF THE PAYLOAD THE PICKER IS ALREADY FILLED FROM. The catalogue call
   answers with an id, a public id, a slug, a title, a model, a brand, a category, a specs object,
   an availability count and a price. The old page read three of those keys and showed none of
   them; this column reads the rest of the SAME response, so there is no second request, no extra
   endpoint and no field the API does not already send. The type in this file is what keeps that
   honest: every key it names is one the handler genuinely returns. It is not the whole payload -
   two of the handler's keys, the image address and the featured marker, are left untyped because
   nothing here reads them.

   Two things it deliberately does not draw, each named where a reader would look for it:

   - the product image. The address the catalogue carries is relative to the storefront (the
     seeder writes /icons/ followed by the product's slug) and this host does not serve that path,
     so a picture here would arrive broken, and a broken picture is a false claim about a product.
     The absence is stated instead.
   - the briefed tone switcher. The draft call takes a product id and nothing else - there is no
     tone parameter anywhere on it - so no control here could change the draft. It is named and
     left out rather than drawn inert; a switcher that moved nothing would read as functional.

   The column is read-only prose apart from the picker and the one press that calls the page's own
   draft handler. It sends nothing itself, and no value in it is inferred. */

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

/* One line of the record: a dim term and its value. */
const LINE = "flex items-baseline justify-between gap-4 py-1";

/* A spec line is only shown when its value has a readable form; a nested shape would otherwise
   print as an opaque stand-in for data, which is the one outcome worth avoiding on a column that
   claims to show what the model is given. */
function readable(v: unknown): v is string | number {
  return typeof v === "string" || typeof v === "number";
}

export default function ProductContext({ items, pid, onPick, onGenerate, busy }: {
  items: CatalogItem[];
  /** the chosen product's id, or null while nothing is chosen */
  pid: number | null;
  onPick: (id: number | null) => void;
  /** the page's own draft press - this column only hands the press on */
  onGenerate: () => void;
  /** the page's existing in-flight flag, unchanged */
  busy: boolean;
}) {
  const item = items.find((c) => c.id === pid) ?? null;
  const specs: Array<[string, string | number]> = item && item.specs && typeof item.specs === "object"
    ? Object.entries(item.specs).filter((e): e is [string, string | number] => readable(e[1]))
    : [];

  return (
    <section>
      <Heading level="h3" as="h2">Product context</Heading>
      <p className="mt-1 pb-3 text-xs text-ink-500">
        What the model is given for the product you pick here.
      </p>

      <Select
        className="w-full"
        value={pid ?? ""}
        onChange={(e) => onPick(e.target.value ? parseInt(e.target.value) : null)}
        aria-label="Product to draft"
      >
        <option value="">choose product...</option>
        {items.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
      </Select>

      {item ? (
        <>
          <p className="mt-4 text-sm font-semibold text-ink-900">{item.title}</p>
          <dl className="mt-2 text-sm">
            <div className={LINE}><dt className="text-ink-500">Product id</dt><dd className="font-mono text-ink-700">{item.id}</dd></div>
            <div className={LINE}><dt className="text-ink-500">Public id</dt><dd className="min-w-0 truncate font-mono text-xs text-ink-700">{item.public_id}</dd></div>
            <div className={LINE}><dt className="text-ink-500">Slug</dt><dd className="min-w-0 truncate font-mono text-ink-700">{item.slug}</dd></div>
            <div className={LINE}><dt className="text-ink-500">Brand</dt><dd className="text-ink-700">{item.brand ?? "-"}</dd></div>
            <div className={LINE}><dt className="text-ink-500">Model</dt><dd className="text-ink-700">{item.model ?? "-"}</dd></div>
            <div className={LINE}><dt className="text-ink-500">Category</dt><dd className="text-ink-700">{item.category ?? "-"}</dd></div>
            <div className={LINE}><dt className="text-ink-500">Units available</dt><dd className="tabular-nums text-ink-700">{item.units_available}</dd></div>
            <div className={LINE}><dt className="text-ink-500">Price from</dt><dd className="text-ink-700">{aud(item.price_from_cents)}</dd></div>
            {specs.map(([k, v]) => (
              <div key={k} className={LINE}>
                <dt className="text-ink-500">{k}</dt>
                <dd className="text-ink-700">{String(v)}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p className="mt-4 rounded-control bg-surface-sunken px-3 py-2 text-sm text-ink-400 ring-1 ring-line">
          No product chosen yet - pick one above, and the facts the draft is written from appear
          here.
        </p>
      )}

      <div className="mt-4 space-y-3 border-t border-line pt-3">
        <div>
          <p className={kickerClass}>Product image</p>
          <p className="mt-1 text-sm text-ink-400">
            Not drawn. The address the catalogue carries is relative to the storefront (its seeder
            writes /icons/ followed by the product slug), and this host does not serve that path -
            so an image here would not load, and none is invented to fill the space.
          </p>
        </div>
        <div>
          <p className={kickerClass}>Tone control</p>
          <p className="mt-1 text-sm text-ink-400">
            Not drawn, and not wired. The draft call takes a product id and nothing else, so there
            is no tone to set and no control here could change the draft. A switcher would look
            functional and do nothing.
          </p>
        </div>
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <Button onClick={onGenerate} disabled={busy || pid == null}>Generate draft</Button>
        <p className="mt-2 text-xs text-ink-500">
          The draft is a proposal written from the facts above - it writes nothing, and nothing
          publishes until you approve it.
        </p>
      </div>
    </section>
  );
}
