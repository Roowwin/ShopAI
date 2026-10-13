"use client";

import { useEffect, useState } from "react";
import { aud } from "@/lib/api";
import { cartGet, cartRemove, cartTotal, type CartLine } from "@/lib/cart";
import { Button, Card, EmptyState, Heading, linkClass } from "../components/ui";

/* THE CART.
 *
 * It used to be the checkout as well: this file held the delivery form and fired the whole
 * `checkout -> pay -> simulate-payment` chain from one button, then printed a total and a UUID. That
 * is now `/checkout`, which is the screen that can show what the order will cost before taking the
 * money - and a cart that only counts is a cart a shopper can leave and come back to.
 *
 * The subtotal here is the cart's own arithmetic over what each unit cost when it was added. It is
 * labelled "excl. GST" for the reason it always was: GST depends on the delivery country, which is
 * a checkout question, so the figure that includes it belongs on the screen that also asks for the
 * address.
 */

export default function CartPage() {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => { setLines(cartGet()); setReady(true); }, []);

  const total = cartTotal();

  return (
    <main className="max-w-2xl mx-auto px-4 pt-10 pb-20">
      <Heading level="h1">Your cart</Heading>

      <Card className="p-5 mt-6">
        {ready && lines.length === 0 && (
          <EmptyState>
            Your cart is empty - <a className={linkClass} href="/">browse the shop</a>.
          </EmptyState>
        )}
        {lines.map((l) => (
          <div key={l.asset_id} className="flex items-center justify-between gap-3 border-b border-line py-3 last:border-0">
            <div className="min-w-0">
              <p className="font-medium truncate">{l.title}</p>
              <p className="text-xs text-ink-400 mt-0.5">
                Grade {l.grade} - serial <span className="font-mono">***{l.serial_tail}</span>
              </p>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <span className="font-semibold">{aud(l.price_cents)}</span>
              <Button variant="danger" size="sm" onClick={() => setLines(cartRemove(l.asset_id))}>
                remove
              </Button>
            </div>
          </div>
        ))}
        {lines.length > 0 && (
          <p className="text-right pt-3 font-semibold">Subtotal (excl. GST): {aud(total)}</p>
        )}
      </Card>

      {lines.length > 0 && (
        <>
          {/* A unit is one physical device and checkout reserves it, so the shopper is told that
              before they walk away rather than after they come back to a sold-out cart. */}
          <p className="mt-4 text-xs text-ink-400">
            Each line is a single serialised device. It is reserved for you when you place the order.
          </p>
          <Button variant="primary" href="/checkout" className="w-full mt-5">
            Proceed to checkout
          </Button>
        </>
      )}
    </main>
  );
}
