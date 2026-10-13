import { apiInternal } from "@/lib/api";
import UnitPicker from "./UnitPicker";
import ProductArt from "../../components/ProductArt";
import { GRADES } from "@/lib/grades";
import { Badge, Button, Eyebrow, Heading, linkClass, navLinkClass, ProductCard } from "../../components/ui";
import { notFound } from "next/navigation";

export const revalidate = 0;

/* The retail view of a product, in the shop's parent/child shape.

   The LEFT column is the PARENT - the model itself: what it is, what it looks like, what the
   manufacturer put in it. Every shopper looking at this page sees the same column, because it does
   not depend on what happens to be on the shelf today.

   The RIGHT rail is the CHILD - the individual certified units behind the model, each with its own
   serial and grade (UnitPicker). That is the half that changes with stock: it is where the price
   comes from, where the choice of grade lives, and where the cart line is created.

   The split is also why the description now appears once. It used to be printed twice - in the left
   column and again under a "Description" heading below - which read as two different bodies of copy
   about the same device. */

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

  return (
    <main className="max-w-6xl mx-auto px-4 pt-10 pb-20">
      <nav className="text-xs text-ink-400 mb-6">
        <a href="/" className={navLinkClass}>Home</a> <span>/</span>
        <a href={"/search?q=" + encodeURIComponent(p.category)} className={navLinkClass}>{p.category}</a> <span>/</span>
        <span className="text-ink-600">{p.title}</span>
      </nav>
      {/* Two columns, Amazon's shape: the parent (name, gallery, long copy) on the left, the buy box
          as a right-hand rail that follows you down the page. `items-start` is what makes the rail
          work - without it the grid would stretch it to the height of the left column and it would
          have nowhere to travel. The rail carries the child half of the page, so the price it shows
          is always the price of the exact unit the shopper has selected.

          On phones the grid collapses: the buy box becomes a full-width panel under the parent
          column and `md:sticky` no longer applies, so nothing floats over the page there. */}
      <div className="grid gap-x-10 gap-y-8 md:grid-cols-2 md:items-start">
        <div>
          <Eyebrow>
            {p.brand} - {p.category}
          </Eyebrow>
          <Heading level="h1" className="mt-2">{p.title}</Heading>
          {/* Out of stock only. The count that used to sit in this badge is now the buy box's status
              line, where it can name the grade and the serial it belongs to. */}
          {!inStock && (
            <div className="mt-3">
              <Badge colorClass="bg-surface-sunken text-ink-500">Out of stock</Badge>
            </div>
          )}
          {promo && (
            <p className="text-xs font-medium text-ink-600 mt-3">Sale event: {promo}</p>
          )}
          {/* IMAGE SLOT: the model's photo when the CMS has one, else the category-glyph icon shipped
              for this slug, else the "photo coming soon" tile. This is the PARENT shot - one image of
              the model, shared by every unit of it. Real photos replace this with /media/... later. */}
          <ProductArt slug={slug} imageUrl={p.image_url} alt={p.title}
            className="mt-6 w-full aspect-[4/3] rounded-2xl object-cover ring-1 ring-line bg-surface-sunken"
            fallback={
            <div className="mt-6 aspect-[4/3] rounded-2xl bg-gradient-to-br from-surface-sunken to-line flex flex-col items-center justify-center text-ink-500">
              <div className="text-center">
                <p className="text-4xl font-bold text-ink-400">{(p.brand || "?").slice(0, 2).toUpperCase()}</p>
                <p className="text-xs mt-2">Product photo coming soon</p>
                <p className="text-[10px] text-ink-400 mt-0.5">{p.brand} {p.model}</p>
              </div>
            </div>} />

          {/* THE PARENT BLOCK. Name, one photo and this copy describe the MODEL - the same words for
              every unit of it - so they sit together, before the page hands the shopper to the rail
              to choose the actual device. */}
          <section className="mt-8">
            <Heading level="h2">About this model</Heading>
            <p className="text-body text-ink-600 mt-3 whitespace-pre-wrap">{p.description}</p>
            {specs.length > 0 && (
              <dl className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                {specs.map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 border-b border-line py-2 text-sm">
                    <dt className="text-ink-500">{label}</dt>
                    <dd className="text-ink-900 font-medium text-right">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="text-xs text-ink-400 mt-4">
              Model: <span className="text-ink-600">{p.brand} {p.model}</span> - Category:{" "}
              <a href={"/search?q=" + encodeURIComponent(p.category)} className={linkClass}>{p.category}</a> - Brand:{" "}
              <a href={"/search?q=" + encodeURIComponent(p.brand)} className={linkClass}>{p.brand}</a>
            </p>
          </section>

          <div className="mt-8 rounded-2xl bg-ink-900 text-white p-6 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Not sure which unit fits?</p>
              <p className="text-xs text-ink-300 mt-1">Ask the AI - it answers from live stock only.</p>
            </div>
            <Button href={"/assistant?about=" + slug} size="sm" className="shrink-0">Ask the AI</Button>
          </div>
        </div>

        <aside className="md:sticky md:top-24">
          {/* The child half. Every price, grade and serial on the screen below comes from one of the
              units this panel was handed - the parent column above never carries a price. */}
          <UnitPicker units={p.units} title={p.title} />
        </aside>
      </div>

      {/* What "pick your unit" is actually picking between. Parent-level education: the scale is a
          fact of the shop, not of this model, so it names the same four grades on every product
          page and links to the page that explains them in full. */}
      <section className="mt-16">
        <Heading level="h2" className="border-b border-line pb-2">What the grades mean</Heading>
        <p className="text-body text-ink-600 mt-4">
          Every unit of this model is checked and graded by hand, one at a time - so the grade is a
          fact about your device, not an average. Pick the condition (and the price) you want in the
          box above.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          {GRADES.map((g) => (
            <div key={g.letter} className="rounded-2xl bg-surface shadow-sm p-4">
              <Badge colorClass={g.pill}>Grade {g.letter}</Badge>
              <p className="text-sm font-medium text-ink-900 mt-2">{g.label}</p>
              <p className="text-xs text-ink-500 mt-1">{g.spec}</p>
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
          <div key={t} className="rounded-xl bg-surface shadow-sm px-3 py-4 text-xs text-ink-600">{t}</div>
        ))}
      </section>
    </main>
  );
}
