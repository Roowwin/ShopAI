"use client";

import { useState } from "react";
import { aud } from "@/lib/api";
import { cartAdd, cartGet } from "@/lib/cart";

type Unit = { id: number; grade: string; sale_price_cents: number; serial_tail: string };

export default function UnitPicker({ units, title, slug }: { units: Unit[]; title: string; slug: string }) {
  const [added, setAdded] = useState<number[]>(() => cartGet().map((c) => c.asset_id));
  if (units.length === 0) {
    return (<p className="text-sm text-slate-500">No certified units available right now - check back soon.</p>);
  }
  function add(u: Unit) {
    cartAdd({ asset_id: u.id, title, grade: u.grade, price_cents: u.sale_price_cents, serial_tail: u.serial_tail });
    setAdded(cartGet().map((c) => c.asset_id));
  }
  return (
    <div className="rounded-2xl ring-1 ring-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold">Choose your certified unit</h3>
      <p className="text-xs text-slate-400 mt-0.5">Each unit is individually serialised - you pick the exact device.</p>
      <div className="mt-3 space-y-2">
        {units.map((u) => (
          <div key={u.id} className="flex items-center justify-between gap-3 border border-slate-200 rounded-xl px-3 py-2.5">
            <div className="min-w-0">
              <span className={"text-xs font-semibold rounded-full px-2 py-0.5 " + (u.grade === "A" ? "bg-emerald-50 text-emerald-700" : u.grade === "B" ? "bg-sky-50 text-sky-700" : u.grade === "C" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600")}>Grade {u.grade}</span>
              <span className="ml-2 text-xs text-slate-400 font-mono">***{u.serial_tail}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="font-semibold text-sm">{aud(u.sale_price_cents)}</span>
              {added.includes(u.id) ? (
                <a href="/cart" className="text-xs rounded-lg bg-indigo-50 text-indigo-700 px-3 py-1.5">In cart - view</a>
              ) : (
                <button className="text-xs rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-500" onClick={() => add(u)}>Add to cart</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}