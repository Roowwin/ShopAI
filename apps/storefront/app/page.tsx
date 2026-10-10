import { apiInternal } from "@/lib/api";
import LoadMore from "./components/LoadMore";

export const revalidate = 30;

export default async function Home() {
  const items: any[] = await apiInternal("/store/catalog?limit=8");
  let cats: any[] = [];
  try { cats = await apiInternal("/store/categories", 60); } catch { void 0; }
  let promo: string | null = null;
  try {
    const p: any[] = await apiInternal("/store/promotions", 60);
    if (p.length) { promo = p[0].name + (p[0].kind === "percent" ? " - " + p[0].value + "% off" : ""); }
  } catch { void 0; }
  return (
    <main>
      <section className="bg-gradient-to-r from-emerald-700 via-emerald-800 to-emerald-950 text-white px-8 py-12">
        <p className="text-[11px] uppercase tracking-widest text-emerald-200">RFO Store</p>
        <h1 className="text-3xl font-semibold mt-2">{promo ?? "Renewed tech. Zero waste."}</h1>
        <p className="text-emerald-100 mt-2 max-w-xl">Certified refurbished devices - serialised, graded, warehouse-tracked. Every purchase keeps e-waste out of landfill.</p>
        <a href="#shop" className="inline-block mt-5 bg-amber-400 text-slate-900 rounded-xl px-5 py-2.5 font-semibold hover:bg-amber-300">Shop devices</a>
      </section>
      <section id="shop" className="max-w-6xl mx-auto px-4 pt-10 pb-8">
        <h2 className="text-xl font-semibold">Our products</h2>
        <LoadMore initial={items} categories={cats} />
      </section>
    </main>
  );
}