import { apiInternal } from "@/lib/api";
import ProductStage from "./ProductStage";
import { GRADES } from "@/lib/grades";
import { auditIsDescriptive, INCLUDED_WITH_COMPUTERS, isComputer, isPhoneOrTablet, parseAudit } from "@/lib/specSheet";
import { Badge, Button, cn, Heading, linkClass, ProductCard } from "../../components/ui";
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
  /* THE SHELF BESIDE THIS ONE, not the first four products in the catalogue. This section used to be
     `/store/catalog?limit=9` minus the product you are looking at - so every product page in the shop
     recommended the same four tiles, in catalogue order, whatever you were reading, and a shopper who
     opened two pages saw the same shelf twice. It now asks for the product's OWN category first and
     only tops up from the catalogue when that category cannot fill four tiles (a category with three
     products in it is normal here - Batteries has three). */
  let others: any[] = [];
  let relatedTo: string | null = null;
  try {
    const inCategory = p.category
      ? (await apiInternal("/store/catalog?limit=8&category=" + encodeURIComponent(p.category), 0) as any[])
        .filter((x: any) => x.slug !== slug)
      : [];
    relatedTo = inCategory.length > 0 ? (p.category as string) : null;
    others = inCategory.slice(0, 4);
    if (others.length < 4) {
      const more = (await apiInternal("/store/catalog?limit=12", 0) as any[])
        .filter((x: any) => x.slug !== slug && !others.some((o) => o.slug === x.slug));
      others = others.concat(more).slice(0, 4);
    }
  } catch { void 0; }
  let promo: string | null = null;
  try { const pr: any[] = await apiInternal("/store/promotions", 60); if (pr.length) { promo = pr[0].name; } } catch { void 0; }
  const inStock = p.units.length > 0;
  const specs = specEntries(p.specs);
  /* The supplier sheet's line, sorted into named rows (lib/specSheet.ts). */
  const sheet = parseAudit(p.audit, { keepOs: isPhoneOrTablet(p.category) });
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
          <ProductStage slug={slug} title={p.title} brand={p.brand} model={p.model}
            imageUrl={p.image_url} groups={p.groups ?? []} units={p.units} category={p.category} />
        </div>


        {/* WHAT ELSE IS ON THIS SHELF, directly under the product area: it was at the very foot of
            the page, under the spec sheet and the whole grade legend, which is a long way down for the
            one block on a product page that a shopper might actually click. Smaller, too - the tiles
            are the compact card, and the section's own padding is tighter than the sections below it. */}
        {others.length > 0 && (
          <section className="mt-14">
            <div className="flex items-end justify-between gap-4">
              <Heading level="h2">{relatedTo ? "More in " + relatedTo : "You may also like"}</Heading>
              <a href={"/category/" + encodeURIComponent(relatedTo ?? p.category)} className={cn("text-xs", linkClass)}>
                See all
              </a>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-5 md:grid-cols-4">
              {others.map((o) => (
                <ProductCard key={o.slug} variant="compact" href={"/products/" + o.slug} title={o.title}
                  brand={o.brand} category={o.category} slug={o.slug} imageUrl={o.image_url}
                  priceCents={o.price_from_cents} />
              ))}
            </div>
          </section>
        )}

        {/* FEATURES AND GRADING, SIDE BY SIDE, directly under the product area.

            Both of these were elsewhere and both were wasting the full width. The spec sheet was a
            collapsed <details> INSIDE the buy panel - so the one thing a technical buyer scans was
            behind a click, in the column that already carries the price and the grade selector. The
            grade legend was a four-card row two screens further down, under a paragraph, beside
            nothing. Neither needs a full-width column: they are a table and four small cards.

            So they sit together, left and right: what the machine IS on the one side, what the GRADE
            means on the other, both readable without scrolling past the other. The area above keeps
            the gallery, the price and the grade selector to itself.

            THE DESCRIPTION LIVES IN THE LEFT COLUMN rather than in a section of its own. It is the
            same words for every unit of the model - a paragraph at most, and often absent entirely on
            an imported row - so it reads as the opening of "what this machine is" rather than as a
            section that needs a heading. */}
        <section className="mt-20 grid gap-10 lg:grid-cols-2 lg:gap-12">
          <div>
            <Heading level="h2" className="border-b border-line pb-2">Features &amp; specs</Heading>
            {p.description ? (
              <p className="mt-4 text-body text-ink-600 whitespace-pre-wrap">{p.description}</p>
            ) : null}
            {/* THE SHEET'S OWN SPEC LINE. `products.specs` is empty on every row of this catalogue, but
                the supplier sheet's audit column is identical on every unit of a model - one line naming
                the CPU, the memory and the drive, or the battery's type code - so it is the machine's spec
                as the sheet recorded it. Quoted, not reformatted: it is somebody else's sentence and the
                page has no business paraphrasing a spec. */}
            {sheet.rows.length > 0 ? (
              /* The sheet's own pieces, sorted into named rows - see lib/specSheet.ts. No heading above
                 them: the labels ARE the heading, and "recorded on the audit sheet" was a line of
                 chrome between the reader and the one thing they came for. */
              <dl className="mt-5 border-t border-line">
                {sheet.rows.map((r: { label: string; value: string }) => (
                  <div key={r.label} className="flex items-baseline justify-between gap-6 border-b border-line py-2.5">
                    <dt className="shrink-0 text-xs uppercase tracking-wide text-ink-500">{r.label}</dt>
                    <dd className="text-right text-sm font-medium text-ink-900">{r.value}</dd>
                  </div>
                ))}
                {/* The shop's own statement, not the sheet's - see lib/specSheet.ts. Shown for a machine
                    that runs an operating system; a monitor, a switch or a phone has no Windows to
                    include and gets no such row. */}
                {isComputer(p.category) && (
                  <div className="flex items-baseline justify-between gap-6 border-b border-line py-2.5">
                    <dt className="shrink-0 text-xs uppercase tracking-wide text-ink-500">Included</dt>
                    <dd className="text-right text-sm font-medium text-ink-900">{INCLUDED_WITH_COMPUTERS}</dd>
                  </div>
                )}
                {sheet.rest.length > 0 && (
                  <div className="flex items-baseline justify-between gap-6 border-b border-line py-2.5">
                    <dt className="shrink-0 text-xs uppercase tracking-wide text-ink-500">Also recorded</dt>
                    <dd className="text-right text-sm text-ink-700">{sheet.rest.join(" · ")}</dd>
                  </div>
                )}
              </dl>
            ) : p.audit && !auditIsDescriptive(p.audit) ? (
              <p className="mt-5 text-sm text-ink-900">{p.audit}</p>
            ) : p.audit ? (
              /* A part, not a machine: the sheet's line is a description ("High Speed 4K DisplayPort to
                 HDMI 2 Meter Cable"), so it is printed as one. */
              <p className="mt-5 text-body text-ink-700">{p.audit.replace(/^N\/A\s*Non-Data Bearing Asset,\s*/i, "")}</p>
            ) : null}
            {specs.length > 0 ? (
              <dl className="mt-5 border-t border-line">
                {specs.map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-6 border-b border-line py-2.5">
                    <dt className="text-xs uppercase tracking-wide text-ink-500">{label}</dt>
                    <dd className="text-right text-sm font-medium text-ink-900">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : p.audit ? null : (
              <p className="mt-5 text-sm text-ink-500">
                No spec sheet was supplied with this model. Ask us and we will check the unit.
              </p>
            )}
            <p className="mt-5 text-xs text-ink-400">
              {/* "Code:" USED TO SIT HERE AND SAID THE MODEL A SECOND TIME - "Model: HP EliteBook 840 G9
                  - Code: EliteBook 840 G9" - because on this catalogue the slug is built from the
                  model, so the two are the same words. One fact, said once. */}
              Model: <span className="text-ink-600">{p.brand} {p.model}</span> - Category:{" "}
              <a href={"/search?q=" + encodeURIComponent(p.category)} className={linkClass}>{p.category}</a> - Brand:{" "}
              <a href={"/search?q=" + encodeURIComponent(p.brand)} className={linkClass}>{p.brand}</a>
            </p>
          </div>

          <div>
            <Heading level="h2" className="border-b border-line pb-2">What the grades mean</Heading>
            <p className="mt-4 text-body text-ink-600">
              Every unit of this model is checked and graded by hand, one at a time - so the grade is a
              fact about your device, not an average. Pick the condition (and the price) you want in the
              panel above.
            </p>
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          </div>
        </section>

        <section className="mt-24 grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
          {["Serialised units", "Graded quality", "Fast AU-NZ delivery", "Secure checkout", "GST-compliant invoices"].map((t) => (
            <div key={t} className="rounded-control bg-surface/80 backdrop-blur-md ring-1 ring-line px-3 py-4 text-xs text-ink-600">{t}</div>
          ))}
        </section>
      </div>
    </main>
  );
}
