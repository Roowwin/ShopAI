import { apiInternal, aud } from "@/lib/api";
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
  const from = inStock ? Math.min(...p.units.map((u: any) => u.sale_price_cents)) : null;

  return (
    <main className="max-w-6xl mx-auto px-4 pt-5 pb-12">
      <nav className="text-xs text-ink-400 mb-4">
        <a href="/" className={navLinkClass}>Home</a> <span>/</span>
        <a href={"/search?q=" + encodeURIComponent(p.category)} className={navLinkClass}>{p.category}</a> <span>/</span>
        <span className="text-ink-600">{p.title}</span>
      </nav>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          {/* IMAGE SLOT: the product photo when the CMS has one, else the category-glyph icon shipped for
              this slug, else the "photo coming soon" tile. Real photos replace this with /media/... later. */}
          <ProductArt slug={slug} imageUrl={p.image_url} alt={p.title}
            className="w-full aspect-[4/3] rounded-card object-cover ring-1 ring-line bg-surface-sunken"
            fallback={
            <div className="aspect-[4/3] rounded-card bg-gradient-to-br from-line to-line-strong flex flex-col items-center justify-center text-ink-500">
              <div className="text-center">
                <p className="text-4xl font-bold text-ink-400">{(p.brand || "?").slice(0, 2).toUpperCase()}</p>
                <p className="text-xs mt-2">Product photo coming soon</p>
                <p className="text-[10px] text-ink-400 mt-0.5">{p.brand} {p.model}</p>
              </div>
            </div>} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3 text-[11px] text-ink-500">
            <div className="rounded-control bg-surface ring-1 ring-line px-2 py-1.5 text-center">Serialised</div>
            <div className="rounded-control bg-surface ring-1 ring-line px-2 py-1.5 text-center">Graded A-D</div>
            <div className="rounded-control bg-surface ring-1 ring-line px-2 py-1.5 text-center">Warehouse-tracked</div>
          </div>
        </div>
        <div>
          <Eyebrow>
            {p.brand} - {p.category}
          </Eyebrow>
          <Heading level="h1" className="mt-1">{p.title}</Heading>
          <div className="mt-2">
            {inStock ? (
              <Badge colorClass="bg-brand-50 text-brand-700">In stock - {p.units.length} certified {p.units.length === 1 ? "unit" : "units"}</Badge>
            ) : (
              <Badge colorClass="bg-surface-sunken text-ink-500">Out of stock</Badge>
            )}
          </div>
          <div className="mt-4 flex items-end gap-3">
            <Heading level="display" as="span">{from !== null ? aud(from) : "-"}</Heading>
            <span className="text-xs text-brand-700 mb-1">{inStock ? "refurbished - e-waste saved" : ""}</span>
          </div>
          {promo && (
            <p className="text-xs text-accent-700 mt-1">Sale event: {promo}</p>
          )}
          <p className="text-body text-ink-600 mt-3">{p.description}</p>
          <div className="mt-5">
            <GradePanel units={p.units} title={p.title} />
          </div>
          <div className="mt-4 rounded-card bg-ink-900 text-white p-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Not sure which unit fits?</p>
              <p className="text-xs text-ink-300">Ask the AI - it answers from live stock only.</p>
            </div>
            <Button href={"/assistant?about=" + slug} size="sm" className="shrink-0">Ask the AI</Button>
          </div>
        </div>
      </div>

      <section className="mt-10">
        <Heading level="h2" className="border-b border-line pb-2">Description</Heading>
        <p className="text-body text-ink-600 mt-3 whitespace-pre-wrap">{p.description}</p>
        <p className="text-xs text-ink-400 mt-3">Category: <a href={"/search?q=" + encodeURIComponent(p.category)} className={linkClass}>{p.category}</a> - Brand: <a href={"/search?q=" + encodeURIComponent(p.brand)} className={linkClass}>{p.brand}</a></p>
      </section>

      {others.length > 0 && (
        <section className="mt-10">
          <Heading level="h2">You may also like</Heading>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            {others.map((o) => (
              <ProductCard key={o.slug} variant="text" href={"/products/" + o.slug} title={o.title}
                brand={o.brand} priceCents={o.price_from_cents} />
            ))}
          </div>
        </section>
      )}

      <section className="mt-10 grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
        {["Serialised units", "Graded quality", "Fast AU-NZ delivery", "Secure checkout", "GST-compliant invoices"].map((t) => (
          <div key={t} className="rounded-control ring-1 ring-line bg-surface px-2 py-3 text-xs text-ink-600">{t}</div>
        ))}
      </section>
    </main>
  );
}
