import { apiInternal } from "@/lib/api";
import PurchasePanel from "./PurchasePanel";
import ProductArt from "../../components/ProductArt";
import { GRADES } from "@/lib/grades";
import { Badge, Button, Heading, linkOnDarkClass, ProductCard } from "../../components/ui";
import { notFound } from "next/navigation";

export const revalidate = 0;

/* The retail view of a product: three columns, and a dark ground.

   THE PARENT/CHILD SPLIT IS UNCHANGED, and it is the thing to keep hold of while reading this
   file. A product here is a MODEL - the title, the photo, the description, the specs - and every
   shopper looking at this page sees the same model. The stock behind it is individual certified
   UNITS, each with its own serial and its own hand-assigned grade. The model half describes; the
   unit half is where the price, the choice and the cart line live.

   THE COLUMNS. Thumbnails down the left, the hero shot in the middle, the purchase panel on the
   right - the retail convention, and the reason the panel can be sticky without the photograph
   scrolling away from the price it belongs to. Below the fold the page reverts to full width:
   the model's own copy, the grading scale, and what else is on the shelf.

   THE GROUND IS CHARCOAL, and it is the one dark route in this shop. It is a SCOPE, not a second
   theme: `.pdp-dark` in globals.css rebinds the surface/ink/line tokens, so everything below
   writes `bg-surface` and `text-ink-900` exactly as the light pages do and resolves dark here.
   That is also why a value like `text-brand-700` cannot be used as ink on this page - see the
   note on the price in PurchasePanel, and the `linkOnDarkClass` used throughout. */

/** Parent facts, straight from products.specs (a flat JSONB object of short strings). Keys are
    display labels as stored ("storage", "screen_size"); the row capitalises them, so the CMS does
    not have to carry presentation. */
function specEntries(specs: unknown): [string, string][] {
  if (!specs || typeof specs !== "object") return [];
  return Object.entries(specs as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && String(v) !== "")
    .map(([k, v]) => [k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), String(v)]);
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let p: any;
  try { p = await apiInternal("/store/catalog/" + slug, 0); }
  catch { notFound(); }
  let others: any[] = [];
  try { others = (await apiInternal("/store/catalog?limit=9", 0) as any[]).filter((x: any) => x.slug !== slug).slice(0, 4); } catch { void 0; }
  let promo: string | null = null;
  try { const pr: any[] = await apiInternal("/store/promotions", 60); if (pr.length) { promo = pr[0].name; } } catch { void 0; }
  const inStock = p.units.length > 0;
  const specs = specEntries(p.specs);

  /* The gallery holds the shots that EXIST. The catalogue carries one parent photograph per model
     (`image_url`) and no per-shot list, so this is one thumbnail today - the rail is built to
     take more rather than padded with placeholders, because a thumbnail that opens nothing is
     worse than no thumbnail. Real photography lands here as `shots` grows. */
  const shots: (string | null)[] = p.image_url ? [p.image_url] : [null];

  /* The initials tile, used when the model has neither a photo nor a shipped glyph. */
  const initials = (
    <div className="w-full aspect-[4/3] bg-gradient-to-br from-surface-sunken to-line flex flex-col items-center justify-center text-ink-500">
      <p className="font-display text-display text-ink-400">{(p.brand || "?").slice(0, 2).toUpperCase()}</p>
      <p className="text-xs mt-2">Product photo coming soon</p>
      <p className="text-xs text-ink-400 mt-0.5">{p.brand} {p.model}</p>
    </div>
  );

  return (
    <main className="pdp-dark bg-surface-page text-ink-900 min-h-screen">
      <div className="mx-auto max-w-6xl px-4 pt-10 pb-20">
        {promo && (
          <p className="mb-6 text-xs font-medium text-ink-500">
            Sale event: <span className="text-brand-300">{promo}</span>
          </p>
        )}

        {/* One row, three columns. `items-start` is what makes the panel sticky: without it the
            grid would stretch it to the height of the tallest column and it would have nowhere
            to travel. On a phone the row collapses and `order-*` puts the photograph first -
            thumbnails above the fold on a 380px screen are a scroll before the product. */}
        <div className="grid gap-8 lg:grid-cols-[88px_minmax(0,1fr)_380px] lg:items-start">
          <div className="order-2 lg:order-1 flex gap-3 overflow-x-auto lg:flex-col lg:overflow-visible">
            {shots.map((shot, i) => (
              /* The hero above shows `image_url`, which is shots[0] - so the first thumbnail is
                 the current view and the ring says so. With one shot (today) that is the whole
                 rail; the ring is written by index rather than unconditionally so a second shot
                 does not arrive looking equally selected. */
              <div key={i} className={"shrink-0 w-20 lg:w-full rounded-control overflow-hidden " + (i === 0 ? "ring-2 ring-brand-300" : "ring-1 ring-line")}>
                <ProductArt slug={slug} imageUrl={shot} alt={shot ? p.title + " (view " + (i + 1) + ")" : p.title}
                  className="w-full aspect-[4/3] object-cover" fallback={initials} />
              </div>
            ))}
          </div>

          <div className="order-1 lg:order-2">
            <div className="rounded-card overflow-hidden ring-1 ring-line bg-surface-sunken">
              <ProductArt slug={slug} imageUrl={p.image_url} alt={p.title} priority
                className="w-full aspect-[4/3] object-cover" fallback={initials} />
            </div>
            {!inStock && (
              <p className="mt-3 text-sm text-ink-500">
                This model is sold out - the panel beside it lists nothing to buy.
              </p>
            )}
          </div>

          {/* The child half. Every price, grade and serial in this panel comes from one of the
              units the page was handed - the two columns to its left never carry a price. */}
          <div className="order-3 lg:sticky lg:top-24">
            <PurchasePanel units={p.units} title={p.title} brand={p.brand} category={p.category}
              slug={slug} specs={specs} />
          </div>
        </div>

        {/* The model's own copy, full width under the fold. It is the same words for every unit,
            so it belongs to the page rather than to the panel - and it is what a shopper reads
            after the price has already told them whether they are interested. */}
        <section className="mt-16 max-w-3xl">
          <Heading level="h2">About this model</Heading>
          <p className="text-body text-ink-600 mt-3 whitespace-pre-wrap">{p.description}</p>
          <p className="text-xs text-ink-400 mt-4">
            Model: <span className="text-ink-600">{p.brand} {p.model}</span> - Category:{" "}
            <a href={"/search?q=" + encodeURIComponent(p.category)} className={linkOnDarkClass}>{p.category}</a> - Brand:{" "}
            <a href={"/search?q=" + encodeURIComponent(p.brand)} className={linkOnDarkClass}>{p.brand}</a>
          </p>
        </section>

        <div className="mt-8 rounded-card bg-surface ring-1 ring-line p-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-ink-900">Not sure which unit fits?</p>
            <p className="text-xs text-ink-500 mt-1">Ask the AI - it answers from live stock only.</p>
          </div>
          <Button variant="primaryOnDark" href={"/assistant?about=" + slug} size="sm" className="shrink-0">Ask the AI</Button>
        </div>

        {/* What the grade dropdown is actually choosing between. Parent-level education: the scale
            is a fact of the shop, not of this model, so it names the same four grades on every
            product page and links to the page that explains them in full. */}
        <section className="mt-16">
          <Heading level="h2" className="border-b border-line pb-2">What the grades mean</Heading>
          <p className="text-body text-ink-600 mt-4">
            Every unit of this model is checked and graded by hand, one at a time - so the grade is a
            fact about your device, not an average. Pick the condition (and the price) you want in the
            panel above.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
            {GRADES.map((g) => (
              <div key={g.letter} className="rounded-card bg-surface ring-1 ring-line p-4">
                <Badge colorClass={g.pill}>Grade {g.letter}</Badge>
                <p className="text-sm font-medium text-ink-900 mt-2">{g.label}</p>
                <p className="text-xs text-ink-500 mt-1">{g.spec}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-ink-400 mt-4">
            <a href="/grades" className={linkOnDarkClass}>Read the full grading scale</a>
          </p>
        </section>

        {others.length > 0 && (
          <section className="mt-16">
            <Heading level="h2">You may also like</Heading>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-6">
              {others.map((o) => (
                <ProductCard key={o.slug} variant="text" href={"/products/" + o.slug} title={o.title}
                  brand={o.brand} priceCents={o.price_from_cents} />
              ))}
            </div>
          </section>
        )}

        <section className="mt-16 grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
          {["Serialised units", "Graded quality", "Fast AU-NZ delivery", "Secure checkout", "GST-compliant invoices"].map((t) => (
            <div key={t} className="rounded-control bg-surface ring-1 ring-line px-3 py-4 text-xs text-ink-600">{t}</div>
          ))}
        </section>
      </div>
    </main>
  );
}
