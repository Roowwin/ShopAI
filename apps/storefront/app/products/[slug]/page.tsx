import { apiInternal, aud } from "@/lib/api";
import UnitPicker from "./UnitPicker";
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
      <nav className="text-xs text-slate-400 mb-4">
        <a href="/" className="hover:text-emerald-700">Home</a> <span>/</span>
        <a href={"/search?q=" + encodeURIComponent(p.category)} className="hover:text-emerald-700">{p.category}</a> <span>/</span>
        <span className="text-slate-600">{p.title}</span>
      </nav>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          {/* IMAGE SLOT: replace this block with <img src="/media/..." className="..." /> when photos are ready */}
          <div className="aspect-[4/3] rounded-2xl bg-gradient-to-br from-slate-200 to-slate-300 flex flex-col items-center justify-center text-slate-500">
            <div className="text-center">
              <p className="text-4xl font-bold text-slate-400">{(p.brand || "?").slice(0, 2).toUpperCase()}</p>
              <p className="text-xs mt-2">Product photo coming soon</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{p.brand} {p.model}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3 text-[11px] text-slate-500">
            <div className="rounded-lg bg-white ring-1 ring-slate-200 px-2 py-1.5 text-center">Serialised</div>
            <div className="rounded-lg bg-white ring-1 ring-slate-200 px-2 py-1.5 text-center">Graded A-D</div>
            <div className="rounded-lg bg-white ring-1 ring-slate-200 px-2 py-1.5 text-center">Warehouse-tracked</div>
          </div>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-400">
            {p.brand} - {p.category}
          </p>
          <h1 className="text-2xl font-semibold mt-1">{p.title}</h1>
          <div className="mt-2">
            {inStock ? (
              <span className="text-xs rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1">In stock - {p.units.length} certified {p.units.length === 1 ? "unit" : "units"}</span>
            ) : (
              <span className="text-xs rounded-full bg-slate-100 text-slate-500 px-2.5 py-1">Out of stock</span>
            )}
          </div>
          <div className="mt-4 flex items-end gap-3">
            <span className="text-3xl font-semibold">{from !== null ? aud(from) : "-"}</span>
            <span className="text-xs text-emerald-700 mb-1">{inStock ? "refurbished - e-waste saved" : ""}</span>
          </div>
          {promo && (
            <p className="text-xs text-indigo-700 mt-1">Sale event: {promo}</p>
          )}
          <p className="text-sm text-slate-600 mt-3">{p.description}</p>
          <div className="mt-5">
            <UnitPicker units={p.units} title={p.title} slug={slug} />
          </div>
          <div className="mt-4 rounded-2xl bg-slate-900 text-white p-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Not sure which unit fits?</p>
              <p className="text-xs text-slate-300">Ask the AI - it answers from live stock only.</p>
            </div>
            <a href={"/assistant?about=" + slug} className="shrink-0 text-xs rounded-lg bg-emerald-600 px-3 py-2 hover:bg-emerald-500">Ask the AI</a>
          </div>
        </div>
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-semibold border-b border-slate-200 pb-2">Description</h2>
        <p className="text-sm text-slate-600 mt-3 whitespace-pre-wrap">{p.description}</p>
        <p className="text-xs text-slate-400 mt-3">Category: <a href={"/search?q=" + encodeURIComponent(p.category)} className="text-emerald-700">{p.category}</a> - Brand: <a href={"/search?q=" + encodeURIComponent(p.brand)} className="text-emerald-700">{p.brand}</a></p>
      </section>

      {others.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">You may also like</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            {others.map((o) => (
              <a key={o.slug} href={"/products/" + o.slug} className="rounded-xl ring-1 ring-slate-200 bg-white p-4 hover:ring-indigo-300 hover:-translate-y-0.5 transition">
                <p className="text-[11px] uppercase tracking-wider text-slate-400">{o.brand}</p>
                <p className="font-medium mt-1 truncate text-sm">{o.title}</p>
                <p className="text-sm font-semibold mt-2">{aud(o.price_from_cents)}</p>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="mt-10 grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
        {["Serialised units", "Graded quality", "Fast AU-NZ delivery", "Secure checkout", "GST-compliant invoices"].map((t) => (
          <div key={t} className="rounded-xl ring-1 ring-slate-200 bg-white px-2 py-3 text-xs text-slate-600">{t}</div>
        ))}
      </section>
    </main>
  );
}