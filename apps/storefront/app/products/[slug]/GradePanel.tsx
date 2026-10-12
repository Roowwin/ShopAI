"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { aud } from "@/lib/api";
import { cartAdd, cartGet } from "@/lib/cart";
import { GRADES } from "@/lib/grades";
import { Badge, Button, Card, cn, EmptyState, Heading } from "../../components/ui";

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

/* The buy box: the one panel that answers "which one, and how much" for the grade you have chosen.

   Amazon's shape, in this shop's words - the price of the selected grade, the shelf state behind
   it, the grades as a radio group of tiles, and one wide buy button. This replaced a row per grade
   with its own Add button; now the tiles only select and the single CTA under them buys, so there
   is exactly one buy control on the page.

   Nothing about the order changed. A tile still buys the lowest-priced unit of its grade (the price
   the tile advertises as its own "from"), checkout still locks that exact row so two shoppers can
   never get the same device, and the serial still shows masked in the cart. This file is state and
   layout only. Grades with nothing on the shelf are left out of the tiles, as the rows did before. */
export default function GradePanel({ units, title }: { units: Unit[]; title: string }) {
  const rows: Row[] = [];
  for (const g of GRADES) {
    const of = units.filter((u) => u.grade === g.letter);
    if (of.length === 0) continue;
    const cheapest = of.reduce((a, b) => (b.sale_price_cents < a.sale_price_cents ? b : a));
    rows.push({ letter: g.letter, label: g.label, pill: g.pill, count: of.length,
                spec: g.spec, useCase: g.useCase, cheapest });
  }

  /* Default selection: the cheapest grade on the shelf - the grade holding the lowest-priced unit,
     which is the same number the page used to advertise as its "from" price. Both hooks are called
     above the empty-shelf early return so the hook order never changes between renders. */
  const [selected, setSelected] = useState(() =>
    rows.length === 0 ? ""
      : rows.reduce((a, b) => (b.cheapest.sale_price_cents < a.cheapest.sale_price_cents ? b : a)).letter);
  const [inCart, setInCart] = useState<number[]>(() => cartGet().map((c) => c.asset_id));
  const tiles = useRef<Record<string, HTMLButtonElement | null>>({});

  if (rows.length === 0) {
    return (<EmptyState>No certified units available right now - check back soon.</EmptyState>);
  }

  const sel = rows.find((r) => r.letter === selected) ?? rows[0];

  function add(u: Unit) {
    cartAdd({ asset_id: u.id, title, grade: u.grade, price_cents: u.sale_price_cents, serial_tail: u.serial_tail });
    setInCart(cartGet().map((c) => c.asset_id));
  }

  /* A radiogroup the browser does not have to guess about: the arrows move selection and focus
     together (roving tabindex), so the tiles behave like radios rather than like a stack of
     buttons. Clicking is the same single state change. */
  function step(from: number, delta: number) {
    const next = rows[(from + delta + rows.length) % rows.length];
    setSelected(next.letter);
    tiles.current[next.letter]?.focus();
  }
  function onKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); step(i, 1); }
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); step(i, -1); }
  }

  return (
    <Card className="p-5 md:p-6">
      <div className="flex items-end gap-2">
        <Heading level="display" as="span">{aud(sel.cheapest.sale_price_cents)}</Heading>
        <span className="text-xs text-ink-500 mb-1">refurbished - e-waste saved</span>
      </div>
      <p className="mt-2 text-xs text-ink-500">
        In stock: {sel.count} {sel.count === 1 ? "unit" : "units"} - Grade {sel.letter} - serial{" "}
        <span className="font-mono">***{sel.cheapest.serial_tail}</span>
      </p>

      <p id="grade-picker-label" className="mt-5 text-xs font-medium text-ink-600">Choose your grade</p>
      <div role="radiogroup" aria-labelledby="grade-picker-label" className="mt-2 space-y-2">
        {rows.map((r, i) => {
          const isSel = r.letter === sel.letter;
          return (
            <button key={r.letter} type="button" role="radio" aria-checked={isSel}
              ref={(el) => { tiles.current[r.letter] = el; }}
              tabIndex={isSel ? 0 : -1}
              onClick={() => setSelected(r.letter)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                "w-full min-h-[44px] rounded-control px-3 py-2.5 flex items-center gap-3 text-left",
                "transition-colors duration-fast ease-out motion-reduce:transition-none",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2",
                isSel
                  ? "ring-2 ring-brand-700 bg-brand-50"
                  : "ring-1 ring-line hover:ring-line-strong hover:bg-surface-sunken active:bg-surface-pressed",
              )}>
              <Badge colorClass={r.pill}>Grade {r.letter}</Badge>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink-900 truncate">{r.label}</span>
                <span className="block text-xs text-ink-500">{r.count} available</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[10px] text-ink-400">from</span>
                <span className="block text-sm font-semibold text-ink-900">{aud(r.cheapest.sale_price_cents)}</span>
              </span>
              {/* The check keeps its box when a tile is not selected (transparent, not removed) so
                  picking a grade cannot shift the row's text sideways. */}
              <span className={cn("shrink-0", isSel ? "text-brand-700" : "text-transparent")} aria-hidden="true">
                <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor"
                     strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 8.5l3.5 3.5L13 4.5" />
                </svg>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        {inCart.includes(sel.cheapest.id) ? (
          <Button href="/cart" variant="secondary" className="w-full">In cart - view</Button>
        ) : (
          <Button variant="primary" className="w-full" onClick={() => add(sel.cheapest)}>
            Add to cart - {aud(sel.cheapest.sale_price_cents)}
          </Button>
        )}
      </div>

      {/* Small print. The old rows explained, under each grade, what that grade means; a tile is too
          small to carry it, so the selected grade's words follow the selection instead - all four
          grades are still described on the page, one selection at a time. */}
      <div className="mt-4 rounded-control bg-surface-sunken px-3 py-2.5">
        <p className="text-xs text-ink-600">{sel.spec}.</p>
        <p className="mt-1 text-xs text-ink-500">{sel.useCase}</p>
      </div>
      <p className="mt-3 text-xs text-ink-400">
        Every unit is serialised and graded by hand. We reserve the lowest-priced unit in the grade you
        pick - the exact serial appears in your cart.
      </p>
    </Card>
  );
}
