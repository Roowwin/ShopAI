import { apiInternal, aud } from "@/lib/api";

export const revalidate = 0;

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  let items: any[] = [];
  if (q && q.trim().length >= 2) {
    try { items = await apiInternal("/store/search?q=" + encodeURIComponent(q.trim()), 0); } catch {}
  }
  return (
    <main className="max-w-3xl mx-auto pt-10 px-4">
      <h1 className="text-xl font-semibold mb-4">Search</h1>
      <form className="mb-6" action="/search" method="get">
        <input name="q" defaultValue={q ?? ""} className="border rounded px-3 py-2 w-72" placeholder="e.g. galaxy s21" />
        <button className="bg-slate-900 text-white rounded px-4 py-2 ml-2">Search</button>
      </form>
      <div className="space-y-3">
        {items.map((i) => (
          <a key={i.slug} href={"/products/" + i.slug} className="block border rounded-lg p-4 hover:shadow">
            <p className="font-medium">{i.title}</p>
            <p className="text-sm text-slate-500">{i.units_available ? i.units_available + " available from " + aud(i.price_from_cents) : "out of stock"}</p>
          </a>
        ))}
        {q && items.length === 0 && <p className="text-slate-500">No results.</p>}
      </div>
    </main>
  );
}
