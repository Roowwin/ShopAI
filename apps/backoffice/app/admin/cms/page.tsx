"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

type Hero = { hero_title: string; hero_sub: string; cta_label: string };
type Promo = { id: number; name: string; kind: string; value: number; active: boolean };
type CProd = { id: number; title: string; slug: string; category: string; image_url: string | null; featured: boolean; listed_units: number };

export default function CmsPage() {
  const [hero, setHero] = useState<Hero>({ hero_title: "", hero_sub: "", cta_label: "" });
  const [promos, setPromos] = useState<Promo[]>([]);
  const [prods, setProds] = useState<CProd[]>([]);
  const [np, setNp] = useState({ name: "", kind: "percent", value: 10 });
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try { const r = await apiFetch("/staff/cms/home"); if (r.ok) { setHero(await r.json()); } } catch { void 0; }
    try { const r = await apiFetch("/staff/cms/promotions"); if (r.ok) { setPromos(await r.json()); } } catch { void 0; }
    try { const r = await apiFetch("/staff/cms/products"); if (r.ok) { setProds(await r.json()); } } catch { void 0; }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(""), 2500); }

  async function saveHero() {
    const r = await apiFetch("/staff/cms/home", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(hero) });
    flash(r.ok ? "Homepage saved - live on the storefront" : "Save failed");
    if (r.ok) { const j: any = await r.json().catch(() => ({})); setHero(j); }
  }

  async function addPromo() {
    const r = await apiFetch("/staff/cms/promotions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(np) });
    if (r.ok) { flash("Offer added"); await load(); } else { flash("Add failed - check value"); }
  }

  async function togglePromo(p: Promo) {
    const r = await apiFetch("/staff/cms/promotions/" + p.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !p.active }) });
    if (r.ok) { await load(); }
  }

  async function saveProduct(p: CProd) {
    const r = await apiFetch("/staff/cms/products/" + p.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image_url: p.image_url ?? "", featured: p.featured }) });
    flash(r.ok ? "Product updated" : "Update failed");
  }

  return (
    <main className="max-w-6xl mx-auto p-4 min-h-screen">
      <div className="bg-slate-950 text-white rounded-2xl px-5 py-3 mb-4 flex items-center gap-3">
        <b>Website CMS</b>
        <span className="text-xs text-slate-400">hero content - offers - featured products (live on the storefront)</span>
      </div>
      {msg && (<div className="rounded-xl bg-emerald-100 text-emerald-800 px-3 py-2 mb-3 text-sm">{msg}</div>)}

      <section className="rounded-2xl ring-1 ring-slate-200 bg-white p-4 mb-4">
        <h2 className="text-sm font-semibold mb-2">Homepage hero</h2>
        <input className="border rounded-xl px-3 py-2 w-full mb-2" placeholder="hero title" value={hero.hero_title}
          onChange={(e) => setHero({ ...hero, hero_title: e.target.value })} />
        <input className="border rounded-xl px-3 py-2 w-full mb-2" placeholder="hero subtitle" value={hero.hero_sub}
          onChange={(e) => setHero({ ...hero, hero_sub: e.target.value })} />
        <div className="flex gap-2">
          <input className="border rounded-xl px-3 py-2 flex-1" placeholder="button label (e.g. Shop devices)" value={hero.cta_label}
            onChange={(e) => setHero({ ...hero, cta_label: e.target.value })} />
          <button className="bg-emerald-600 text-white rounded-xl px-5 hover:bg-emerald-500" onClick={() => void saveHero()}>Save</button>
        </div>
      </section>

      <section className="rounded-2xl ring-1 ring-slate-200 bg-white p-4 mb-4">
        <h2 className="text-sm font-semibold mb-2">Offers</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
              <th className="py-1">Name</th><th>Tier</th><th>Value</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {promos.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="py-2">{p.name}</td>
                <td>{p.kind}</td>
                <td>{p.value}{p.kind === "percent" ? "%" : ""}</td>
                <td>
                  <button className={p.active ? "text-emerald-700 font-semibold" : "text-slate-400"} onClick={() => void togglePromo(p)}>{p.active ? "Active" : "Off"}</button>
                </td>
                <td className="text-xs text-slate-400">id {p.id}</td>
              </tr>
            ))}
            {promos.length === 0 && (<tr><td colSpan={5} className="text-slate-400 py-2">No offers yet - add one below.</td></tr>)}
          </tbody>
        </table>
        <div className="flex flex-wrap gap-2 mt-3 items-center">
          <input className="border rounded-xl px-3 py-2" placeholder="offer name" value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} />
          <select className="border rounded-xl px-3 py-2 bg-white" value={np.kind} onChange={(e) => setNp({ ...np, kind: e.target.value })}>
            <option value="percent">percent</option>
            <option value="fixed">fixed</option>
          </select>
          <input className="border rounded-xl px-3 py-2 w-24" type="number" value={np.value} onChange={(e) => setNp({ ...np, value: Number(e.target.value) })} />
          <button className="bg-slate-900 text-white rounded-xl px-4 hover:bg-slate-800" onClick={() => void addPromo()}>Add offer</button>
        </div>
      </section>

      <section className="rounded-2xl ring-1 ring-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold mb-2">Products - image URL and featured</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
              <th className="py-1">Product</th><th>Units</th><th>Image URL</th><th>Featured</th><th></th>
            </tr>
          </thead>
          <tbody>
            {prods.map((p, i) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="py-2 pr-2">
                  <a className="text-emerald-700" href={"/products/" + p.slug}>{p.title}</a>
                  <p className="text-xs text-slate-400">{p.category}</p>
                </td>
                <td>{p.listed_units}</td>
                <td><input className="border rounded-lg px-2 py-1 w-64" placeholder="https://... image URL"
                  value={p.image_url ?? ""}
                  onChange={(e) => setProds((arr) => arr.map((x, k) => (k === i ? { ...x, image_url: e.target.value } : x)))} /></td>
                <td><input type="checkbox" checked={p.featured}
                  onChange={(e) => setProds((arr) => arr.map((x, k) => (k === i ? { ...x, featured: e.target.checked } : x)))} /></td>
                <td><button className="text-xs border rounded-lg px-3 py-1.5 hover:bg-slate-50" onClick={() => void saveProduct(prods[i])}>Save</button></td>
              </tr>
            ))}
            {prods.length === 0 && (<tr><td colSpan={5} className="text-slate-400 py-2">No products.</td></tr>)}
          </tbody>
        </table>
      </section>
    </main>
  );
}