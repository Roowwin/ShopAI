import { apiInternal, aud } from "@/lib/api";
import UnitsPanel from "./units-panel";
import { notFound } from "next/navigation";

export const revalidate = 0;

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let p: any;
  try { p = await apiInternal("/store/catalog/" + slug, 0); }
  catch { notFound(); }
  return (
    <main className="max-w-3xl mx-auto pt-10 px-4">
      <p className="text-xs text-slate-400">{p.brand} · {p.category} · {p.model}</p>
      <h1 className="text-2xl font-semibold">{p.title}</h1>
      <p className="text-slate-600 mt-2">{p.description}</p>
      <p className="text-sm mt-4">From <span className="font-semibold">{aud(Math.min(...p.units.map((u: any) => u.sale_price_cents)))}</span> · {p.units.length} unit(s) available</p>
      <UnitsPanel units={p.units} />
    </main>
  );
}
