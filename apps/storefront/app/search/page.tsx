import { apiInternal } from "@/lib/api";
import { Button, EmptyState, Heading, Input, ProductCard } from "../components/ui";

export const revalidate = 0;

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  let items: any[] = [];
  if (q && q.trim().length >= 2) {
    try { items = await apiInternal("/store/search?q=" + encodeURIComponent(q.trim()) + "&limit=24", 0); } catch { void 0; }
  }
  return (
    <main className="max-w-6xl mx-auto px-4 pt-8 pb-10">
      <Heading level="h1">Search</Heading>
      <form className="mt-4" action="/search" method="get">
        <Input name="q" defaultValue={q ?? ""} aria-label="Search the catalogue" className="md:w-96" placeholder="e.g. galaxy s21" />
        <Button type="submit" className="ml-2">Search</Button>
      </form>
      {/* WHAT WAS SEARCHED FOR, AND HOW MUCH CAME BACK - without the provenance note that used to
          follow it ("source: live catalog, today"), which told the shopper which table the row came
          from. The catalogue is the catalogue; a shopper does not need to be told it is live. */}
      {q && <p className="mt-3 text-xs text-ink-400">{items.length} result{items.length === 1 ? "" : "s"} for &ldquo;{q}&rdquo;</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mt-5">
        {/* The art-bearing tile: a search result with no picture cannot be recognised at a glance,
            which is the whole job of a result row. */}
        {items.map((i) => (
          <ProductCard key={i.slug} variant="compact" href={"/products/" + i.slug} title={i.title}
            brand={i.brand} category={i.category} slug={i.slug} imageUrl={i.image_url}
            priceCents={i.price_from_cents} stock={{ n: i.units_available, label: "left" }} />
        ))}
      </div>
      {q && items.length === 0 && (
        <EmptyState className="mt-6" action={<Button href="/">Browse everything in stock</Button>}>
          Nothing matches &ldquo;{q}&rdquo;. Try one word - a brand, a model, or a kind of device.
        </EmptyState>
      )}
    </main>
  );
}
