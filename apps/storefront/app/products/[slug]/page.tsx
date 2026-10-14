import { apiInternal } from "@/lib/api";
import ProductStage from "./ProductStage";
import { GRADES } from "@/lib/grades";
import { Badge, Button, Heading, linkClass, ProductCard } from "../../components/ui";
import { notFound } from "next/navigation";

export const revalidate = 0;

/* The retail view of a product: three columns, and the shop's own ground.

   THE PARENT/CHILD SPLIT IS UNCHANGED, and it is the thing to keep hold of while reading this
   file. A product here is a MODEL - the title, the photo, the description, the specs - and every
   shopper looking at this page sees the same model. The stock behind it is individual certified
   UNITS, each with its own serial and its own hand-assigned grade. The model half describes; the
   unit half is where the price, the choice and the cart line live.

   THE COLUMNS. Thumbnails down the left, the hero shot in the middle, the purchase panel on the
   right - the retail convention, and the reason the panel can be sticky without the photograph
   scrolling away from the price it belongs to. Below the fold the page reverts to full width:
   the model's own copy, the grading scale, and what else is on the shelf.

   THE GROUND IS THE SHOP'S GROUND NOW. This page was once the one dark route in a light shop and
   carried a `.pdp-dark` scope of its own; the whole storefront is dark, so the scope is gone and
   the tokens resolve here exactly as they do everywhere else. What remains from that pass is the
   habit it forced: nothing here names a hex, and `linkClass` (brand-300) rather than
   `text-brand-700` carries every link, because brand-700 is the button FILL and reads at 2.3:1 as
   ink on this ground. */

/** Parent facts, straight from products.specs (a flat JSONB object of short strings). Keys are
    display labels as stored ("storage", "screen_size"); the row capitalises them, so the CMS does
    not have to carry presentation. */
function specEntries(specs: unknown): [string, string][] {
  if (!specs || typeof specs !== "object") return [];
  return Object.entries(specs as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && String(v) !== "")
    .map(([k, v]) => [k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), String(v)]);
}

/* THE CHIP ROW's two tables. `screen` reads as "Display" on the photograph and as "Screen" in the
   panel's sheet below - the chip is the shop's word for the glance, the sheet is the catalogue's
   own key, and both are the same stored fact.

   THE VALUES ARE PRINTED VERBATIM, and that is the whole design of this helper. The catalogue
   holds "8GB", "14.0in", "256GB"; a chip that upgraded those to "8GB DDR4" or "256GB NVMe" would
   be inventing memory and bus types the supplier never sent, on a page where a shopper is judging
   a device by exactly those numbers. Nothing is inferred from a key name either - `cpu` is a CPU
   because the catalogue says so, not because the helper guessed. A key the table does not know
   still gets a chip, after the known ones, rather than being dropped. */
const CHIP_LABELS: Record<string, string> = { cpu: "CPU", ram: "RAM", screen: "Display", storage: "Storage" };
const CHIP_ORDER = ["cpu", "ram", "screen", "storage"];

/** Up to three hardware chips, in the order a buyer reads them, values verbatim. */
function specChips(specs: unknown): [string, string][] {
  if (!specs || typeof specs !== "object") return [];
  const s = specs as Record<string, unknown>;
  const present = (k: string) => s[k] !== null && s[k] !== undefined && String(s[k]) !== "";
  const keys = [
    ...CHIP_ORDER.filter(present),
    ...Object.keys(s).filter((k) => !CHIP_ORDER.includes(k) && present(k)),
  ];
  return keys.slice(0, 3).map((k) => [
    CHIP_LABELS[k] ?? k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
    String(s[k]),
  ]);
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
  const chips = specChips(p.specs);

  /* THE GALLERY AND THE PANEL ARE ONE COMPONENT NOW - see ProductStage. They had to be: the panel
     owns "which grade", and a group can carry a different photograph for each grade, so the hero
     shot has to follow a value that used to live entirely inside the panel. `p.groups` is that
     per-grade photography, straight from /store/catalog/{slug}. */

  return (
    <main className="text-ink-900 min-h-screen">
      <div className="mx-auto max-w-6xl px-4 pt-14 pb-28">
        {/* THE STRIP ABOVE THE FOLD: where you are on the left, what is running on the right.

            The breadcrumb used to live inside the purchase panel, which put "Home / laptops" in the
            right-hand column on a desktop and below the photograph on a phone - the two places a
            shopper is least likely to look for the way back up the tree. It is a fact about the
            page, not about the price, so it leads the page. The trail ends on the MODEL rather than
            the catalogue title, so the last crumb names the product and not a sentence. */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <nav aria-label="Breadcrumb" className="text-xs text-ink-500">
            <a href="/" className={linkClass}>Home</a>
            <span aria-hidden="true"> / </span>
            <a href={"/search?q=" + encodeURIComponent(p.category)} className={linkClass}>{p.category}</a>
            <span aria-hidden="true"> / </span>
            <span aria-current="page" className="text-ink-600">{p.model}</span>
          </nav>

          {/* The sale badge, with the shop's own pulse. The chip itself stays NEUTRAL (see
              DealOfMonth: a sale chip is not a colour, so the accent is left to the CTA) - the only
              colour is the dot, which is precisely what `brand-500` is for: the token notes call it
              "a ring and a dot, never body text". The outer dot pings and the inner one holds; the
              whole marker is aria-hidden because the sale's NAME is the text beside it, not the
              animation, and the ping is switched off for anyone who has asked for no motion. */}
          {promo && (
            <p className="inline-flex items-center gap-2 rounded-full bg-surface-deep px-3 py-1.5 text-xs text-ink-700 ring-1 ring-line">
              <span aria-hidden="true" className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-500" />
              </span>
              {promo}
            </p>
          )}
        </div>

        {/* One row, twelve columns: the gallery takes seven and the purchase panel five. `items-start`
            is what makes the panel sticky: without it the grid would stretch it to the height of the
            tallest column and it would have nowhere to travel. On a phone the row collapses and the
            photograph comes first - thumbnails above the fold on a 380px screen are a scroll before
            the product.

            ProductStage renders BOTH columns as its own children, so this grid's own geometry is
            exactly what it was - the stage was extracted for the shared grade state, not to change
            the layout. Everything below this line that used to be here now lives in that file. */}
        <div className="grid gap-8 lg:grid-cols-12 lg:items-start">
          <ProductStage slug={slug} title={p.title} brand={p.brand} model={p.model} specs={specs}
            imageUrl={p.image_url} groups={p.groups ?? []} units={p.units} />
        </div>


        {/* The model's own copy, full width under the fold. It is the same words for every unit,
            so it belongs to the page rather than to the panel - and it is what a shopper reads
            after the price has already told them whether they are interested. */}
        <section className="mt-24 max-w-3xl">
          <Heading level="h2">About this model</Heading>
          <p className="text-body text-ink-600 mt-3 whitespace-pre-wrap">{p.description}</p>
          <p className="text-xs text-ink-400 mt-4">
            Model: <span className="text-ink-600">{p.brand} {p.model}</span> - Category:{" "}
            <a href={"/search?q=" + encodeURIComponent(p.category)} className={linkClass}>{p.category}</a> - Brand:{" "}
            <a href={"/search?q=" + encodeURIComponent(p.brand)} className={linkClass}>{p.brand}</a>
          </p>
        </section>

        {/* The assistant invite. It was a gradient band (#122922 into #1A382F, left to right) so it
            would read as a distinct object rather than as more of the copy above it; this pass
            takes the gradient out and gets the same separation from a plain step up the surface
            ladder - `surface-page-alt` against the `surface-page` canvas - plus a wider gap. A
            two-stop gradient across a full-width band is the loudest surface on the page and the
            brief asks for the quiet ones.

            The spark tile is NEUTRAL now as well. It was a brass-tinted square (`brand-700/15` on a
            30% brand hairline) which spent the brand colour on decoration; the brief allows the
            brand hue on the primary action and nowhere else, so the tile is a surface step with
            a hairline and the icon is the body ink. */}
        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-card bg-surface-page-alt p-8 ring-1 ring-line">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-surface text-ink-600 ring-1 ring-line">
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 2 4.5 11H9l-.9 7L15 9h-4.6L11 2Z" />
              </svg>
            </span>
            <div>
              <p className="text-sm font-medium text-ink-900">Not sure which unit fits?</p>
              <p className="text-xs text-ink-500 mt-1">Ask the AI - it answers from live stock only.</p>
            </div>
          </div>
          <Button variant="primary" href={"/assistant?about=" + slug} size="sm" className="shrink-0">Ask AI Assistant</Button>
        </div>

        {/* What the grade dropdown is actually choosing between. Parent-level education: the scale
            is a fact of the shop, not of this model, so it names the same four grades on every
            product page and links to the page that explains them in full. */}
        <section className="mt-24">
          <Heading level="h2" className="border-b border-line pb-2">What the grades mean</Heading>
          <p className="text-body text-ink-600 mt-4">
            Every unit of this model is checked and graded by hand, one at a time - so the grade is a
            fact about your device, not an average. Pick the condition (and the price) you want in the
            panel above.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
            {GRADES.map((g) => (
              <div key={g.letter} className="flex flex-col rounded-card bg-surface/80 backdrop-blur-md ring-1 ring-line p-4">
                <Badge colorClass={g.pill}>Grade {g.letter}</Badge>
                <p className="text-sm font-medium text-ink-900 mt-2">{g.label}</p>
                {/* `mb-3` rather than a margin on the row below: the row carries `mt-auto` to pin
                    it to the foot of an equal-height card, and two margin-top utilities on one
                    element would both be emitted (`cn` does not dedupe), leaving the gap to
                    Tailwind's emission order. The tallest card - Grade D's three-line spec - is the
                    one that needs this gap, and it is the one `mt-auto` gives no slack to. */}
                <p className="text-xs text-ink-500 mt-1 mb-3">{g.spec}</p>

                {/* THE BATTERY INDICATOR, which is what makes four cards read as one scale rather
                    than four paragraphs. The glyph is filled to the grade's PUBLISHED FLOOR
                    (`batteryPct`) and never to a measured value - this page has no per-unit health
                    reading and must not look as though it does - so the sentence beside it, which
                    says "or better", is not decoration but the thing that makes the fill honest.
                    The tint is the grade's own ink step, the same colour family as the pill above
                    it, so the indicator cannot drift away from the badge it belongs to. */}
                <div className="mt-auto flex items-center gap-2 border-t border-line pt-3">
                  <svg viewBox="0 0 26 12" className={"h-3 w-6 shrink-0 " + g.ink} fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
                    <rect x="0.6" y="0.6" width="22" height="10.8" rx="2.5" />
                    <path d="M25 4.2v3.6" strokeLinecap="round" />
                    <rect x="2.6" y="2.6" width={18.6 * (g.batteryPct / 100)} height="6.8" rx="1.2" fill="currentColor" stroke="none" />
                  </svg>
                  <span className="text-[11px] leading-tight text-ink-500">{g.battery}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-ink-400 mt-4">
            <a href="/grades" className={linkClass}>Read the full grading scale</a>
          </p>
        </section>

        {others.length > 0 && (
          <section className="mt-24">
            <Heading level="h2">You may also like</Heading>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mt-6">
              {others.map((o) => (
                <ProductCard key={o.slug} variant="text" href={"/products/" + o.slug} title={o.title}
                  brand={o.brand} priceCents={o.price_from_cents} />
              ))}
            </div>
          </section>
        )}

        <section className="mt-24 grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
          {["Serialised units", "Graded quality", "Fast AU-NZ delivery", "Secure checkout", "GST-compliant invoices"].map((t) => (
            <div key={t} className="rounded-control bg-surface/80 backdrop-blur-md ring-1 ring-line px-3 py-4 text-xs text-ink-600">{t}</div>
          ))}
        </section>
      </div>
    </main>
  );
}
