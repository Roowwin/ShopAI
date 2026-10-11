import { apiInternal, aud } from "@/lib/api";
import { Badge, Button, Card, EmptyState, Eyebrow, Heading, Input } from "../components/ui";

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
          <Card key={i.slug} radius="control" interactive href={"/products/" + i.slug} className="p-4">
            <Eyebrow>{i.brand}</Eyebrow>
            <p className="font-medium mt-1 truncate">{i.title}</p>
            <div className="mt-2 flex items-center justify-between">
              <span className="font-semibold text-sm">{i.price_from_cents !== null ? aud(i.price_from_cents) : "-"}</span>
              <Badge colorClass={i.units_available > 0 ? "bg-brand-50 text-brand-700" : "bg-surface-sunken text-ink-500"}>{i.units_available} left</Badge>
            </div>
          </Card>
        ))}
      </div>
      {q && items.length === 0 && <EmptyState className="mt-6">No results - try a broader term.</EmptyState>}
    </main>
  );
}
