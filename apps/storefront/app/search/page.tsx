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
        <Input name="q" defaultValue={q ?? ""} className="md:w-96" placeholder="e.g. galaxy s21" />
        <Button type="submit" className="ml-2">Search</Button>
      </form>
      {q && <p className="text-xs text-ink-400 mt-3">Results for "{q}" - {items.length} found (source: live catalog, today)</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mt-5">
        {items.map((i) => (
          <ProductCard key={i.slug} variant="text" href={"/products/" + i.slug} title={i.title}
            brand={i.brand} priceCents={i.price_from_cents} stock={{ n: i.units_available, label: "left" }} />
        ))}
      </div>
      {q && items.length === 0 && <EmptyState className="mt-6">No results - try a broader term.</EmptyState>}
    </main>
  );
}
