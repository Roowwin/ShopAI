"use client";

import { useState } from "react";
import { aud } from "@/lib/api";
import { cartAdd, cartGet } from "@/lib/cart";
import { GRADES } from "@/lib/grades";
import { Badge, Button, Card, EmptyState, Heading } from "../../components/ui";

type Unit = { id: number; grade: string; sale_price_cents: number; serial_tail: string };
type Row = {
  letter: string;
  label: string;
  pill: string;
  count: number;
  spec: string;
  useCase: string;
  cheapest: Unit;
};

/* The offer, one row per grade instead of one row per unit: how many are on the shelf, the lowest
   price in that grade, what the grade means (most common use case + spec, from lib/grades) and a buy
   button. Grades with nothing on the shelf are left out rather than shown empty.

   Buying reserves the lowest-priced unit of the chosen grade. The order still holds one exact
   serialised asset - checkout locks that row, so two shoppers can never get the same device - it is
   just chosen for the shopper instead of listed one by one, and the serial shows up in the cart. */
export default function GradePanel({ units, title }: { units: Unit[]; title: string }) {
  const [inCart, setInCart] = useState<number[]>(() => cartGet().map((c) => c.asset_id));

  if (units.length === 0) {
    return (<EmptyState>No certified units available right now - check back soon.</EmptyState>);
  }

  const rows: Row[] = [];
  for (const g of GRADES) {
    const of = units.filter((u) => u.grade === g.letter);
    if (of.length === 0) continue;
    const cheapest = of.reduce((a, b) => (b.sale_price_cents < a.sale_price_cents ? b : a));
    rows.push({ letter: g.letter, label: g.label, pill: g.pill, count: of.length,
                spec: g.spec, useCase: g.useCase, cheapest });
  }

  function add(u: Unit) {
    cartAdd({ asset_id: u.id, title, grade: u.grade, price_cents: u.sale_price_cents, serial_tail: u.serial_tail });
    setInCart(cartGet().map((c) => c.asset_id));
  }

  return (
    <Card className="p-6">
      <Heading level="h3">Choose your grade</Heading>
      <p className="text-xs text-ink-400 mt-1">
        Every unit is serialised and graded by hand. Pick a grade and we reserve the lowest-priced
        unit in it - the exact serial appears in your cart.
      </p>
      <div className="mt-4 space-y-3">
        {rows.map((r) => (
          <div key={r.letter} className="border border-line rounded-xl px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Badge colorClass={r.pill}>Grade {r.letter}</Badge>
                <span className="text-xs text-ink-500 truncate">{r.label}</span>
                <span className="text-xs text-ink-400 shrink-0">- {r.count} available</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-ink-400">from</span>
                <span className="font-semibold text-sm">{aud(r.cheapest.sale_price_cents)}</span>
                {inCart.includes(r.cheapest.id) ? (
                  <Button href="/cart" variant="secondary" size="sm">In cart - view</Button>
                ) : (
                  <Button variant="primary" size="sm" onClick={() => add(r.cheapest)}>Add to cart</Button>
                )}
              </div>
            </div>
            <p className="mt-3 text-xs text-ink-600">
              <span className="text-ink-400">Most common use case: </span>{r.useCase}
            </p>
            <p className="mt-2 text-xs text-ink-600">
              <span className="text-ink-400">Spec: </span>{r.spec}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}
