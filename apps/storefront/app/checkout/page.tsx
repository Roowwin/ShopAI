"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API, aud } from "@/lib/api";
import { cartClear, cartGet, type CartLine } from "@/lib/cart";
import { Button, Card, cn, EmptyState, fieldClass, Heading, Input, linkClass } from "../components/ui";

/* THE CHECKOUT SCREEN.
 *
 * Before this page the shop had no checkout at all: `cart/page.tsx` carried the delivery form and
 * fired `POST /store/checkout` -> `/orders/{id}/pay` -> `/orders/{id}/simulate-payment` from one
 * button, then printed a total. The cart is a cart now, and this is the screen that asks for an
 * address, shows what the order will actually cost, and takes the payment.
 *
 * WHAT IT PROMISES. Every number below comes from `POST /store/checkout/quote`, which is the
 * checkout's own pricing path read without the row locks and without writing anything. That is what
 * makes the total shown here the total charged: GST is not the shopper's problem to compute, and a
 * total that only appeared AFTER the charge would not be a checkout.
 *
 * WHY THE ADDRESS IS REQUIRED even though the API accepts blanks. A parcel needs somewhere to go,
 * and the API's `ship_to_*` fields are all optional because a guest order has to be able to exist
 * while the address is still being typed. The gate belongs here, where a person can be told which
 * field is missing.
 *
 * PAYMENT. `s.payment_provider` is the development stub in this build, so the "pay" step is the
 * shop's own two calls and there is no card form to fill in - and this screen says so rather than
 * drawing a card form that goes nowhere. When a real provider is configured those two calls become
 * the redirect, and the confirmation screen below is unchanged.
 */

type Quote = {
  subtotal_cents: number; tax_cents: number; shipping_cents: number; total_cents: number;
  currency: string; jurisdiction: string; rate_bp: number;
  lines: { asset_id: number; title: string; grade: string | null; sale_price_cents: number }[];
};

const gstLabel = (bp: number) => "GST (" + (bp / 100).toFixed(bp % 100 === 0 ? 0 : 1) + "%)";

export default function CheckoutPage() {
  const router = useRouter();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);
  const [country, setCountry] = useState("AU");
  const [name, setName] = useState("");
  const [line1, setLine1] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postcode, setPostcode] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { setLines(cartGet()); setReady(true); }, []);

  /* The quote, re-read whenever the cart or the destination changes. GST depends on the COUNTRY, so
   * switching AU/NZ has to re-price - which is also why this is an effect on `country` and not a
   * number computed once on mount. */
  useEffect(() => {
    const ids = lines.map((l) => l.asset_id);
    if (ids.length === 0) { setQuote(null); return; }
    let alive = true;
    (async () => {
      try {
        const r = await fetch(API + "/store/checkout/quote", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ asset_ids: ids, shipping_country: country }),
        });
        const j = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) { setQuote(null); setErr(j.detail ?? "could not price this cart"); return; }
        setQuote(j); setErr("");
      } catch {
        if (alive) { setQuote(null); setErr("could not reach the shop"); }
      }
    })();
    return () => { alive = false; };
  }, [lines, country]);

  const missing = [
    !name.trim() && "full name", !line1.trim() && "street address",
    !city.trim() && "city", !postcode.trim() && "postcode",
  ].filter(Boolean) as string[];

  const pay = useCallback(async () => {
    if (lines.length === 0) { setErr("your cart is empty"); return; }
    if (missing.length) { setErr("please add: " + missing.join(", ")); return; }
    setErr(""); setBusy(true);
    const body = {
      asset_ids: lines.map((l) => l.asset_id), shipping_country: country,
      ship_to_name: name, ship_line1: line1, ship_city: city, ship_state: state,
      ship_postcode: postcode,
    };
    let orderId: string | null = null;
    try {
      const r = await fetch(API + "/store/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify(body),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.detail ?? "checkout failed"); setBusy(false); return; }
      orderId = j.order_public_id;

      // The two payment steps. A failure here is NOT a failed order - the order exists and is
      // `pending` - so the shopper is sent to the confirmation screen to see the real state rather
      // than left on a form that would place a SECOND order if they pressed again.
      const p = await fetch(API + "/store/orders/" + orderId + "/pay", { method: "POST", credentials: "include" });
      if (!p.ok) { router.push("/orders/" + orderId); return; }
      await fetch(API + "/store/orders/" + orderId + "/simulate-payment", { method: "POST", credentials: "include" });

      cartClear();
      setLines([]);
      router.push("/orders/" + orderId);
    } catch (e: any) {
      if (orderId) { router.push("/orders/" + orderId); return; }
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }, [lines, country, name, line1, city, state, postcode, missing, router]);

  if (ready && lines.length === 0) {
    return (
      <main className="max-w-lg mx-auto px-4 pt-16 pb-20">
        <EmptyState>
          Your cart is empty - <a className={linkClass} href="/">browse the shop</a>.
        </EmptyState>
      </main>
    );
  }

  return (
    <main className="max-w-5xl mx-auto px-4 pt-10 pb-20">
      <Heading level="h1">Checkout</Heading>
      <p className="text-sm text-ink-500 mt-2">
        Every unit is serialised and checked by hand, so the serial you are buying is the one we ship.
      </p>

      <div className="grid gap-x-10 gap-y-8 md:grid-cols-2 md:items-start mt-8">
        <Card className="p-5 md:p-6 space-y-3">
          <Heading level="h2">Delivery</Heading>
          <label className="block text-xs font-medium text-ink-600" htmlFor="country">Country</label>
          <select id="country" value={country} onChange={(e) => setCountry(e.target.value)}
            className={cn(fieldClass, "px-3 py-2.5 ring-1 ring-line bg-surface hover:ring-line-strong")}>
            <option value="AU">Australia</option>
            <option value="NZ">New Zealand</option>
          </select>
          <label className="block text-xs font-medium text-ink-600" htmlFor="name">Full name</label>
          <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="block text-xs font-medium text-ink-600" htmlFor="line1">Street address</label>
          <Input id="line1" autoComplete="address-line1" value={line1} onChange={(e) => setLine1(e.target.value)} />
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-ink-600" htmlFor="city">City</label>
              <Input id="city" autoComplete="address-level2" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="w-28">
              <label className="block text-xs font-medium text-ink-600" htmlFor="state">State</label>
              <Input id="state" autoComplete="address-level1" value={state} onChange={(e) => setState(e.target.value)} />
            </div>
            <div className="w-28">
              <label className="block text-xs font-medium text-ink-600" htmlFor="postcode">Postcode</label>
              <Input id="postcode" autoComplete="postal-code" value={postcode} onChange={(e) => setPostcode(e.target.value)} />
            </div>
          </div>
        </Card>

        <Card className="p-5 md:p-6">
          <Heading level="h2">Order summary</Heading>
          <div className="mt-3">
            {lines.map((l) => (
              <div key={l.asset_id} className="flex items-start justify-between gap-3 border-b border-line py-3 last:border-0">
                <div className="min-w-0">
                  <p className="font-medium truncate">{l.title}</p>
                  <p className="text-xs text-ink-400 mt-0.5">
                    Grade {l.grade} - serial <span className="font-mono">***{l.serial_tail}</span>
                  </p>
                </div>
                <span className="font-semibold shrink-0">{aud(l.price_cents)}</span>
              </div>
            ))}
          </div>

          {/* The figures come from the quote, not from the cart's own arithmetic: the cart stores
              what each unit cost when it was added, and only the server knows the GST rate in force. */}
          <dl className="mt-4 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-500">Subtotal (excl. GST)</dt>
              <dd>{quote ? aud(quote.subtotal_cents) : "-"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-500">{quote ? gstLabel(quote.rate_bp) : "GST"}</dt>
              <dd>{quote ? aud(quote.tax_cents) : "-"}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-2 font-semibold text-ink-900">
              <dt>Total</dt>
              <dd>{quote ? aud(quote.total_cents) : "-"}</dd>
            </div>
          </dl>

          <Button variant="primary" className="w-full mt-5" onClick={pay}
            disabled={busy || !quote} pressed={busy}>
            {busy ? "Taking payment..." : quote ? "Pay " + aud(quote.total_cents) : "Pricing your cart..."}
          </Button>
          <p className="mt-3 text-xs text-ink-400">
            This build settles through the shop&apos;s development payment provider, so no card details
            are collected here. Your order number and confirmation appear on the next screen either way.
          </p>
        </Card>
      </div>

      {err && <p className="mt-5 text-sm text-danger-600" role="alert">{err}</p>}
      <p className="mt-6 text-xs text-ink-400">
        <a href="/cart" className={linkClass}>Back to your cart</a>
      </p>
    </main>
  );
}
