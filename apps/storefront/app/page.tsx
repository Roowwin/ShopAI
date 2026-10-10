import { apiInternal, aud } from "@/lib/api";
import LoadMore from "./components/LoadMore";

export const revalidate = 30;

export default async function Home() {
  const items: any[] = await apiInternal("/store/catalog?limit=4&sort=new");
  const arrivals: any[] = items;
  let best: any[] = [];
  try { best = await apiInternal("/store/best-sellers", 60); } catch { void 0; }
  let cats: any[] = [];
  try { cats = await apiInternal("/store/categories", 60); } catch { void 0; }
  let hero: any = { hero_title: "Renewed tech. Zero waste.",
    hero_sub: "Certified refurbished devices - serialised, graded, warehouse-tracked.", cta_label: "Shop devices" };
  try { hero = await apiInternal("/store/home-content", 60); } catch { void 0; }
  let promo: string | null = null;
  try {
    const p: any[] = await apiInternal("/store/promotions", 60);
    if (p.length) { promo = p[0].name + (p[0].kind === "percent" ? " - " + p[0].value + "% off" : ""); }
  } catch { void 0; }
  return (
    <main>
      <section className="bg-gradient-to-r from-emerald-700 via-emerald-800 to-emerald-950 text-white px-8 py-12">
        <p className="text-[11px] uppercase tracking-widest text-emerald-200">RFO Store</p>
        <h1 className="text-3xl font-semibold mt-2">{promo ?? hero.hero_title}</h1>
        <p className="text-emerald-100 mt-2 max-w-xl">{promo ? "Sale prices below - " + hero.hero_sub : hero.hero_sub}</p>
        <a href="#shop" className="inline-block mt-5 bg-amber-400 text-slate-900 rounded-xl px-5 py-2.5 font-semibold hover:bg-amber-300">{hero.cta_label}</a>
      </section>
      <section className="max-w-6xl mx-auto px-4 pt-10">
        <div className="flex items-end justify-between"><h2 className="text-xl font-semibold">New arrivals</h2><a href="/" className="text-xs text-emerald-700">View all</a></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          {arrivals.map((i) => (
            <a key={i.slug} href={"/products/" + i.slug} className="rounded-xl ring-1 ring-slate-200 bg-white overflow-hidden hover:ring-emerald-300 transition">
              {i.image_url ? (<img src={i.image_url} alt={i.title} className="w-full aspect-[4/3] object-cover" />) : (
              <div className="aspect-[4/3] bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
                <span className="text-lg font-bold text-slate-400">{(i.brand || "?").slice(0, 2).toUpperCase()}</span></div>
              )}
              <div className="p-3"><p className="font-medium truncate text-sm">{i.title}</p>
                <p className="text-sm font-semibold mt-1">{i.price_from_cents !== null ? aud(i.price_from_cents) : "-"}</p></div>
            </a>
          ))}
        </div>
      </section>
      {best.length > 0 && (
      <section className="max-w-6xl mx-auto px-4 pt-8">
        <h2 className="text-xl font-semibold">Best sellers</h2>
        <p className="text-xs text-slate-400">Most purchased by real customers (paid orders).</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          {best.map((i) => (
            <a key={i.slug} href={"/products/" + i.slug} className="rounded-xl ring-1 ring-slate-200 bg-white p-3 hover:ring-emerald-300 transition">
              <p className="text-[11px] uppercase tracking-wider text-slate-400">{i.brand}</p>
              <p className="font-medium truncate text-sm">{i.title}</p>
              <p className="text-xs text-slate-500 mt-1">{i.sold} sold</p>
            </a>
          ))}
        </div>
      </section>)}

      <section id="shop" className="max-w-6xl mx-auto px-4 pt-10 pb-8">
        <h2 className="text-xl font-semibold">Our products</h2>
        <LoadMore initial={items.filter((_: any, k: number) => k >= 4)} categories={cats} />
      </section>
    </main>
  );
}