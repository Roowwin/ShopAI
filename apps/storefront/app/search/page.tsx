import { apiInternal, aud } from "@/lib/api";

export const revalidate = 0;

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  let items: any[] = [];
  if (q && q.trim().length >= 2) {
    try { items = await apiInternal("/store/search?q=" + encodeURIComponent(q.trim()) + "&limit=24", 0); } catch { void 0; }
  }
  return (
    <main className="max-w-6xl mx-auto px-4 pt-8 pb-10">
      <h1 className="text-xl font-semibold">Search</h1>
      <form className="mt-4" action="/search" method="get">
        <input name="q" defaultValue={q ?? ""} className="border rounded-xl px-4 py-2.5 w-full md:w-96" placeholder="e.g. galaxy s21" />
        <button className="bg-emerald-600 text-white rounded-xl px-5 py-2.5 ml-2">Search</button>
      </form>
      {q && <p className="text-xs text-slate-400 mt-3">Results for "{q}" - {items.length} found (source: live catalog, today)</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mt-5">
        {items.map((i) => (
          <a key={i.slug} href={"/products/" + i.slug} className="rounded-xl ring-1 ring-slate-200 bg-white p-4 hover:ring-emerald-300 hover:-translate-y-0.5 transition">
            <p className="text-[11px] uppercase tracking-wider text-slate-400">{i.brand}</p>
            <p className="font-medium mt-1 truncate">{i.title}</p>
            <div className="mt-2 flex items-center justify-between">
              <span className="font-semibold text-sm">{i.price_from_cents !== null ? aud(i.price_from_cents) : "-"}</span>
              <span className={"text-xs rounded-full px-2 py-0.5 " + (i.units_available > 0 ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}>{i.units_available} left</span>
            </div>
          </a>
        ))}
      </div>
      {q && items.length === 0 && <p className="text-slate-500 mt-6">No results - try a broader term.</p>}
    </main>
  );
}