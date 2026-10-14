import { apiInternal } from "@/lib/api";
import PurchasePanel from "./PurchasePanel";
import ProductArt from "../../components/ProductArt";
import { GRADES } from "@/lib/grades";
import { Badge, Button, Heading, linkClass, ProductCard } from "../../components/ui";
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
    <main className="text-ink-900 min-h-screen">
      <div className="mx-auto max-w-6xl px-4 pt-10 pb-20">
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
            the product. The shots and the panel are two nested grids rather than one three-column
            row, because the thumb rail belongs to the gallery, not to the page: it has to sit beside
            the photograph at sm and above, and above it below that. */}
        <div className="grid gap-8 lg:grid-cols-12 lg:items-start">
          <div className="order-1 lg:col-span-7">
            <div className="grid gap-3 sm:grid-cols-[88px_minmax(0,1fr)]">
              <div className="order-2 flex gap-3 overflow-x-auto sm:order-1 sm:flex-col sm:overflow-visible">
                {shots.map((shot, i) => (
                  /* The hero above shows `image_url`, which is shots[0] - so the first thumbnail is
                     the current view and the ring says so. With one shot (today) that is the whole
                     rail; the ring is written by index rather than unconditionally so a second shot
                     does not arrive looking equally selected. */
                  <div key={i} className={"shrink-0 w-20 sm:w-full rounded-control overflow-hidden " + (i === 0 ? "ring-2 ring-brand-700" : "ring-1 ring-line")}>
                    <ProductArt slug={slug} imageUrl={shot} alt={shot ? p.title + " (view " + (i + 1) + ")" : p.title}
                      className="w-full aspect-[4/3] object-cover" fallback={initials} />
                  </div>
                ))}
              </div>

              {/* The well the hero is mounted in: the recessed #122922 fill on the #264D40 hairline,
                  which is what makes a photograph read as set into the page rather than pasted onto
                  it. `relative` exists for the inspection badge, which floats over the image's
                  top-left corner.

                  THE BADGE IS A CLAIM, so it is only made when there is something to claim: a model
                  whose every unit has sold has no unit on the page to call inspected, and the badge
                  is withheld. The wording is the shop's own published one ("checked and graded by
                  hand, one at a time", below) rather than a new promise invented for a decoration. */}
              <div className="order-1 sm:order-2">
                <div className="relative rounded-card overflow-hidden ring-1 ring-line bg-surface-sunken">
                  <ProductArt slug={slug} imageUrl={p.image_url} alt={p.title} priority
                    className="w-full aspect-[4/3] object-cover" fallback={initials} />
                  {inStock && (
                    <p className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-surface-deep/85 px-3 py-1.5 text-xs font-medium text-ink-700 backdrop-blur-md ring-1 ring-line">
                      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0 text-grade-a-ink" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="10" cy="10" r="7.5" />
                        <path d="m6.8 10.2 2.2 2.2 4.2-4.6" />
                      </svg>
                      Hand-Inspected Unit
                    </p>
                  )}
                </div>
                {!inStock && (
                  <p className="mt-3 text-sm text-ink-500">
                    This model is sold out - the panel beside it lists nothing to buy.
                  </p>
                )}
              </div>
            </div>

            {/* The three specs a buyer checks before anything else, as chips under the photograph.
                They are the model's own `specs`, printed verbatim - see specChips: no chip upgrades
                "8GB" to "DDR4" or "256GB" to "NVMe". The full sheet is still in the panel's
                disclosure; this row is the glance, not the datasheet.

                The value WRAPS rather than truncating. It is tempting to keep the row tidy with
                `truncate`, but that would put an ellipsis in the middle of a CPU name ("AMD Ryzen 5
                4500...") with nothing on the page to reveal the rest - the one spec a desktop buyer
                cares most about, hidden by a layout decision. Two lines beat a lost fact. */}
            {chips.length > 0 && (
              <ul className="mt-3 grid grid-cols-3 gap-2">
                {chips.map(([label, value]) => (
                  <li key={label} className="rounded-control bg-surface-sunken px-3 py-2 ring-1 ring-line">
                    <p className="text-[11px] text-ink-500">{label}</p>
                    <p className="mt-0.5 text-xs font-medium text-ink-900">{value}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* The child half. Every price, grade and serial in this panel comes from one of the
              units the page was handed - the two columns to its left never carry a price. */}
          <div className="order-2 lg:col-span-5 lg:sticky lg:top-24">
            <PurchasePanel units={p.units} title={p.title} brand={p.brand} model={p.model}
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
            <a href={"/search?q=" + encodeURIComponent(p.category)} className={linkClass}>{p.category}</a> - Brand:{" "}
            <a href={"/search?q=" + encodeURIComponent(p.brand)} className={linkClass}>{p.brand}</a>
          </p>
        </section>

        {/* The assistant invite. It is a GRADIENT band rather than another glass card - #122922 in
            at the left, #1A382F out at the right, which is the one place on this page where the two
            surface steps are shown side by side rather than layered - so it reads as a distinct
            object under the fold instead of a continuation of the copy above it. The spark sits in
            a brass-tinted tile (`brand-700/15` fill on a 30% hairline) and the icon itself is
            `brand-300`, the ladder's ink step: brand-700 is the button FILL and measures 2.3:1 as a
            glyph on this ground. */}
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-card bg-gradient-to-r from-surface-page-alt to-surface p-6 ring-1 ring-line">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-brand-700/15 text-brand-300 ring-1 ring-brand-700/30">
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
        <section className="mt-16">
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
            <div key={t} className="rounded-control bg-surface/80 backdrop-blur-md ring-1 ring-line px-3 py-4 text-xs text-ink-600">{t}</div>
          ))}
        </section>
      </div>
    </main>
  );
}
