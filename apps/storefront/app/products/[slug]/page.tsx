import { apiInternal } from "@/lib/api";
import GradePanel from "./GradePanel";
import ProductArt from "../../components/ProductArt";
import { Badge, Button, Eyebrow, Heading, linkClass, navLinkClass, ProductCard } from "../../components/ui";
import { notFound } from "next/navigation";

export const revalidate = 0;

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

  return (
    <main className="max-w-6xl mx-auto px-4 pt-10 pb-20">
      <nav className="text-xs text-ink-400 mb-6">
        <a href="/" className={navLinkClass}>Home</a> <span>/</span>
        <a href={"/search?q=" + encodeURIComponent(p.category)} className={navLinkClass}>{p.category}</a> <span>/</span>
        <span className="text-ink-600">{p.title}</span>
      </nav>
      {/* Two columns, Amazon's shape: the name, the gallery and the long copy on the left, the buy box
          as a right-hand rail that follows you down the page. `items-start` is what makes the rail
          work - without it the grid would stretch it to the height of the left column and it would
          have nowhere to travel. The rail's live price replaced the static "from" figure that used to
          sit in the header block: with a grade always selected there is no "from" left to hedge with,
          so the number is now the price of the grade you are actually looking at.

          On phones the grid collapses: the buy box becomes a full-width panel under the gallery and
          `md:sticky` no longer applies, so nothing floats over the page there. */}
      <div className="grid gap-x-10 gap-y-8 md:grid-cols-2 md:items-start">
        <div>
          <Eyebrow>
            {p.brand} - {p.category}
          </Eyebrow>
          <Heading level="h1" className="mt-2">{p.title}</Heading>
          {/* Out of stock only. The count that used to sit in this badge is now the buy box's status
              line, where it can name the grade it belongs to. */}
          {!inStock && (
            <div className="mt-3">
              <Badge colorClass="bg-surface-sunken text-ink-500">Out of stock</Badge>
            </div>
          )}
          {promo && (
            <p className="text-xs font-medium text-ink-600 mt-3">Sale event: {promo}</p>
          )}
          {/* IMAGE SLOT: the product photo when the CMS has one, else the category-glyph icon shipped for
              this slug, else the "photo coming soon" tile. Real photos replace this with /media/... later. */}
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 text-xs text-ink-500">
            <div className="rounded-xl bg-surface shadow-sm px-3 py-2.5 text-center">Serialised</div>
            <div className="rounded-xl bg-surface shadow-sm px-3 py-2.5 text-center">Graded A-D</div>
            <div className="rounded-xl bg-surface shadow-sm px-3 py-2.5 text-center">Warehouse-tracked</div>
          </div>
          <p className="text-body text-ink-600 mt-6">{p.description}</p>
          <div className="mt-8 rounded-2xl bg-ink-900 text-white p-6 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Not sure which unit fits?</p>
              <p className="text-xs text-ink-300 mt-1">Ask the AI - it answers from live stock only.</p>
            </div>
            <Button href={"/assistant?about=" + slug} size="sm" className="shrink-0">Ask the AI</Button>
          </div>
        </div>

        <aside className="md:sticky md:top-24">
          <GradePanel units={p.units} title={p.title} />
        </aside>
      </div>

      <section className="mt-16">
        <Heading level="h2" className="border-b border-line pb-2">Description</Heading>
        <p className="text-body text-ink-600 mt-4 whitespace-pre-wrap">{p.description}</p>
        <p className="text-xs text-ink-400 mt-4">Category: <a href={"/search?q=" + encodeURIComponent(p.category)} className={linkClass}>{p.category}</a> - Brand: <a href={"/search?q=" + encodeURIComponent(p.brand)} className={linkClass}>{p.brand}</a></p>
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
