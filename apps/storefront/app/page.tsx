import { apiInternal, aud } from "@/lib/api";

export const revalidate = 30;

export default async function Home() {
  const items: any[] = await apiInternal("/store/catalog");
  return (
    <main className="max-w-5xl mx-auto pt-10 px-4">
      <h1 className="text-2xl font-semibold mb-2">Certified Refurbished</h1>
      <p className="text-slate-500 mb-8">Every unit serialised, graded and warehouse-tracked.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {items.map((i) => (
          <a key={i.slug} href={"/products/" + i.slug} className="border rounded-xl p-5 hover:shadow">
            <p className="text-xs text-slate-400">{i.brand} · {i.category}</p>
            <p className="font-medium mt-1">{i.title}</p>
            <p className="text-sm text-slate-500 mt-1">{i.units_available} unit(s) from {aud(i.price_from_cents)}</p>
          </a>
        ))}
      </div>
      {items.length === 0 && <p className="text-slate-500">Nothing listed yet.</p>}
    </main>
  );
}
