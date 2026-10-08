"use client";

import { useEffect, useState } from "react";
import { API, aud } from "@/lib/api";
import { cartGet, cartRemove, cartTotal, cartClear, CartLine } from "@/lib/cart";

export default function CartPage() {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [country, setCountry] = useState("AU");
  const [name, setName] = useState("");
  const [line1, setLine1] = useState("");
  const [city, setCity] = useState("");
  const [postcode, setPostcode] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ total: number; id: string } | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => { setLines(cartGet()); }, []);

  async function checkout() {
    setErr(""); setBusy(true);
    if (lines.length === 0) { setErr("cart is empty"); setBusy(false); return; }
    const r = await fetch(API + "/store/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ asset_ids: lines.map((l) => l.asset_id), shipping_country: country,
                             ship_to_name: name, ship_line1: line1, ship_city: city, ship_postcode: postcode }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.detail ?? "checkout failed"); setBusy(false); return; }
    const p = await fetch(API + "/store/orders/" + j.order_public_id + "/pay", { method: "POST", credentials: "include" });
    const pj: any = await p.json().catch(() => ({}));
    if (!p.ok) { setErr(pj.detail ?? "payment setup failed"); setBusy(false); return; }
    const s = await fetch(API + "/store/orders/" + j.order_public_id + "/simulate-payment", { method: "POST", credentials: "include" });
    if (!s.ok) { setErr("test payment failed"); setBusy(false); return; }
    setDone({ total: j.total_cents, id: j.order_public_id });
    cartClear(); setLines([]);
    setBusy(false);
  }

  if (done) {
    return (
      <main className="max-w-lg mx-auto pt-16 px-4 text-center">
        <h1 className="text-2xl font-semibold text-green-700">Order placed</h1>
        <p className="mt-2">Total charged: <span className="font-semibold">{aud(done.total)}</span></p>
        <p className="text-sm text-slate-500 mt-1">Order {done.id}</p>
        <a href="/" className="inline-block mt-6 border rounded px-4 py-2">Keep shopping</a>
      </main>
    );
  }

  const total = cartTotal();
  return (
    <main className="max-w-2xl mx-auto pt-10 px-4 space-y-6">
      <h1 className="text-xl font-semibold">Your cart</h1>
      <div className="bg-white rounded-xl shadow p-6">
        {lines.length === 0 && <p className="text-slate-500">Cart is empty.</p>}
        {lines.map((l) => (
          <div key={l.asset_id} className="flex items-center justify-between border-b py-3 last:border-0">
            <div>
              <p className="font-medium">Grade {l.grade} unit</p>
              <p className="text-xs text-slate-400 font-mono">serial ••{l.serial_tail}</p>
            </div>
            <div className="flex items-center gap-4">
              <span className="font-semibold">{aud(l.price_cents)}</span>
              <button className="text-red-500 text-sm" onClick={() => setLines(cartRemove(l.asset_id))}>remove</button>
            </div>
          </div>
        ))}
        {lines.length > 0 && <p className="text-right pt-3 font-semibold">Subtotal (excl. GST): {aud(total)}</p>}
      </div>
      {lines.length > 0 && (
        <div className="bg-white rounded-xl shadow p-6 space-y-3">
          <h2 className="font-medium">Delivery (AU / NZ)</h2>
          <select className="border rounded px-3 py-2" value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="AU">Australia (GST 10%)</option>
            <option value="NZ">New Zealand (GST 15%)</option>
          </select>
          <input className="border rounded px-3 py-2 w-full" placeholder="full name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="border rounded px-3 py-2 w-full" placeholder="street address" value={line1} onChange={(e) => setLine1(e.target.value)} />
          <div className="flex gap-3">
            <input className="border rounded px-3 py-2 flex-1" placeholder="city" value={city} onChange={(e) => setCity(e.target.value)} />
            <input className="border rounded px-3 py-2 w-32" placeholder="postcode" value={postcode} onChange={(e) => setPostcode(e.target.value)} />
          </div>
          <button className="bg-green-700 text-white rounded px-6 py-2 disabled:opacity-50" onClick={checkout} disabled={busy}>
            Buy now — unit reserved instantly
          </button>
        </div>
      )}
      {err && <p className="text-red-600 text-sm">{err}</p>}
    </main>
  );
}
