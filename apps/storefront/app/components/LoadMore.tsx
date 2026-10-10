"use client";

import { useState } from "react";
import { API, aud } from "@/lib/api";

type Cat = { name: string; n: number };

export default function LoadMore({ initial, categories }: { initial: any[]; categories?: Cat[] }) {
  const [items, setItems] = useState<any[]>(initial ?? []);
  const [off, setOff] = useState((initial ?? []).length);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState((initial ?? []).length >= 8);
  const [cat, setCat] = useState<string | null>(null);

  async function fetchPage(reset: boolean, category: string | null) {
    setBusy(true);
    try {
      const url = API + "/store/catalog?limit=8&offset=" + (reset ? 0 : off) + (category ? "&category=" + encodeURIComponent(category) : "");
      const r = await fetch(url, { cache: "no-store" });
      if (r.ok) {
        const j: any[] = await r.json();
        if (reset) { setItems(j); setOff(j.length); } else { setItems((p) => [...p, ...j]); setOff(off + j.length); }
        setMore(j.length >= 8);
      }
    } catch { void 0; }
    setBusy(false);
  }

  function pick(name: string | null) {
    setCat(name);
    void fetchPage(true, name);
  }

  return (
    <div>
      {categories && categories.length > 1 && (
        <div className="flex flex-wrap gap-2 mt-4">
          <button onClick={() => pick(null)} className={"text-xs rounded-full px-3 py-1.5 border " + (cat === null ? "bg-emerald-600 text-white border-emerald-600" : "bg-white border-slate-200 hover:border-emerald-300")}>All</button>
          {categories.map((c) => (
            <button key={c.name} onClick={() => pick(c.name)} className={"text-xs rounded-full px-3 py-1.5 border " + (cat === c.name ? "bg-emerald-600 text-white border-emerald-600" : "bg-white border-slate-200 hover:border-emerald-300")}>{c.name} ({c.n})</button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mt-5">
        {items.map((i) => (
          <a key={i.slug} href={"/products/" + i.slug} className="group rounded-xl ring-1 ring-slate-200 bg-white overflow-hidden hover:ring-emerald-300 hover:-translate-y-0.5 transition">
            {/* IMAGE SLOT: replace block with <img src={"/media/" + i.slug + ".jpg"} className="w-full aspect-[4/3] object-cover" /> when photos exist */}
            <div className="aspect-[4/3] bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center relative">
              <span className="text-xl font-bold text-slate-400">{(i.brand || "?").slice(0, 2).toUpperCase()}</span>
              <span className="absolute top-2 right-2 text-[10px] rounded-full bg-emerald-600 text-white px-2 py-0.5">Eco choice</span>
            </div>
            <div className="p-3">
              <p className="text-[11px] uppercase tracking-wider text-slate-400">{i.brand} - {i.category}</p>
              <p className="font-medium mt-1 truncate">{i.title}</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="font-semibold text-sm">{i.price_from_cents !== null ? aud(i.price_from_cents) : "-"}</span>
                <span className={"text-xs rounded-full px-2 py-0.5 " + (i.units_available > 0 ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}>{i.units_available} in stock</span>
              </div>
              <p className="text-xs text-emerald-700 mt-2.5 opacity-0 group-hover:opacity-100 transition">View product</p>
            </div>
          </a>
        ))}
        {items.length === 0 && <p className="text-slate-500 col-span-full">Nothing listed in this category yet.</p>}
      </div>
      {more && (
        <div className="text-center mt-6">
          <button className="border border-emerald-200 text-emerald-700 rounded-xl px-6 py-2 hover:bg-emerald-50 disabled:opacity-50" onClick={() => void fetchPage(false, cat)} disabled={busy}>{busy ? "Loading..." : "Load more"}</button>
        </div>
      )}
    </div>
  );
}