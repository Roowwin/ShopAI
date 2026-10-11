"use client";

import { useEffect, useState } from "react";
import { API, aud } from "@/lib/api";
import { cartGet, cartRemove, cartTotal, cartClear, CartLine } from "@/lib/cart";
import { Button, Card, Heading, Input } from "../components/ui";

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
    try {
      const r = await fetch(API + "/store/checkout", { method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ asset_ids: lines.map((l) => l.asset_id), shipping_country: country,
        ship_to_name: name, ship_line1: line1, ship_city: city, ship_postcode: postcode }) });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.detail ?? "checkout failed"); setBusy(false); return; }
      const p = await fetch(API + "/store/orders/" + j.order_public_id + "/pay", { method: "POST", credentials: "include" });
      const pj: any = await p.json().catch(() => ({}));
      if (!p.ok) { setErr(pj.detail ?? "payment setup failed"); setBusy(false); return; }
      const s = await fetch(API + "/store/orders/" + j.order_public_id + "/simulate-payment", { method: "POST", credentials: "include" });
      if (!s.ok) { setErr("test payment failed"); setBusy(false); return; }
      setDone({ total: j.total_cents, id: j.order_public_id });
      cartClear(); setLines([]);
    } catch (e: any) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  if (done) {
    return (
      <main className="max-w-lg mx-auto pt-16 px-4 text-center">
        <div className="mx-auto h-14 w-14 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-2xl">&#10003;</div>
        <Heading level="h1" className="mt-3">Order placed</Heading>
        <p className="mt-2">Total charged: <span className="font-semibold">{aud(done.total)}</span></p>
        <p className="text-sm text-ink-500 mt-1 font-mono">Order {done.id}</p>
        <Button href="/" className="mt-6">Keep shopping</Button>
      </main>
    );
  }

  const total = cartTotal();
  return (
    <main className="max-w-2xl mx-auto pt-8 px-4 pb-12 space-y-5">
      <Heading level="h1">Your cart</Heading>
      <Card className="p-5">
        {lines.length === 0 && <p className="text-ink-500">Cart is empty - <a className="text-brand-700" href="/">browse the shop</a>.</p>}
        {lines.map((l) => (
          <div key={l.asset_id} className="flex items-center justify-between gap-3 border-b border-line py-3 last:border-0">
            <div className="min-w-0">
              <p className="font-medium truncate">{l.title}</p>
              <p className="text-xs text-ink-400 mt-0.5">Grade {l.grade} - serial <span className="font-mono">***{l.serial_tail}</span></p>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <span className="font-semibold">{aud(l.price_cents)}</span>
              <Button variant="danger" size="sm" onClick={() => setLines(cartRemove(l.asset_id))}>remove</Button>
            </div>
          </div>
        ))}
        {lines.length > 0 && <p className="text-right pt-3 font-semibold">Subtotal (excl. GST): {aud(total)}</p>}
      </Card>
      {lines.length > 0 && (
        <Card className="p-5 space-y-3">
          <Heading level="h2">Delivery (AU / NZ)</Heading>
          <select className="rounded-control ring-1 ring-line bg-surface px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-500" value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="AU">Australia (GST 10%)</option>
            <option value="NZ">New Zealand (GST 15%)</option>
          </select>
          <Input placeholder="full name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="street address" value={line1} onChange={(e) => setLine1(e.target.value)} />
          <div className="flex gap-3">
            <Input className="flex-1" placeholder="city" value={city} onChange={(e) => setCity(e.target.value)} />
            <div className="w-32"><Input placeholder="postcode" value={postcode} onChange={(e) => setPostcode(e.target.value)} /></div>
          </div>
          <Button variant="accent" className="w-full" onClick={checkout} disabled={busy}>
            {busy ? "Processing..." : "Buy now - unit reserved instantly"}
          </Button>
        </Card>
      )}
      {err && <p className="text-danger-600 text-sm">{err}</p>}
    </main>
  );
}
