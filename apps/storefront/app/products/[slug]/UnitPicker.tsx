"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { aud } from "@/lib/api";
import { cartAdd, cartGet } from "@/lib/cart";
import { GRADES } from "@/lib/grades";
import { Badge, Button, Card, cn, EmptyState, Heading } from "../../components/ui";

/* The CHILD half of the product page: one exact unit off the shelf.

   A product in this shop is a MODEL (the parent - the title, the photos, the description, the
   specs); the stock behind it is a set of individual certified units (the children - each with its
   own serial and its own hand-assigned grade). The buy box is where a shopper drops from the model
   to the unit they will actually be shipped, so it has to do two things at once:

     1. narrow the shelf by GRADE, and
     2. once narrowed, pick the exact UNIT in it - by serial.

   The grade chips are therefore a filter over the unit list, not a separate decision: choosing a
   grade re-prices the box to the cheapest unit in that grade (the number the chip advertises), and
   choosing a row re-prices it to that unit. There is one price on screen at a time and it always
   belongs to the row the shopper has selected - that is the whole contract of this panel.

   Nothing about the order changed. A row still buys its own asset_id, checkout still locks that
   exact row so two shoppers can never get the same device, and the serial still shows masked in the
   cart. Grades with nothing on the shelf are left out of the chips entirely, as the grade rows were
   before them. */

type Unit = { id: number; grade: string; sale_price_cents: number; serial_tail: string };

const ALL = "";   // the "every grade" chip's value - the empty string is not a grade, so it can never collide

/** Cheapest first: the list opens on the same number the buy box does, so the top row and the price
    above it agree before the shopper touches anything. */
function byPrice(a: Unit, b: Unit): number {
  return a.sale_price_cents - b.sale_price_cents || a.serial_tail.localeCompare(b.serial_tail);
}

export default function UnitPicker({ units, title }: { units: Unit[]; title: string }) {
  /* The shelf, grouped by grade in A-D order. This is the single description of "what is on the
     shelf" - the chips, the counts and the list all read it, so a chip can never advertise a grade
     the list cannot show. */
  const groups = useMemo(
    () => GRADES.map((g) => ({
      letter: g.letter, label: g.label, pill: g.pill, spec: g.spec, useCase: g.useCase,
      units: units.filter((u) => u.grade === g.letter).sort(byPrice),
    })).filter((g) => g.units.length > 0),
    [units],
  );

  const [grade, setGrade] = useState<string>(ALL);
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [inCart, setInCart] = useState<number[]>(() => cartGet().map((c) => c.asset_id));
  const gradeRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const unitRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  /* The rows the current grade filter shows, cheapest first. Picking "All" re-sorts across grades,
     so the cheapest unit on the shelf is the top row whatever it is graded. */
  const visible = useMemo(
    () => (grade === ALL ? groups.flatMap((g) => g.units).sort(byPrice)
                         : (groups.find((g) => g.letter === grade)?.units ?? [])),
    [grade, groups],
  );

  /* Selection is DERIVED, never stored as "the selection": it is the row the shopper clicked, or -
     when the filter has moved out from under it - the cheapest row now visible. Changing the grade
     chip therefore needs no effect and no cleanup pass: dropping a stale pick is just the fallback
     doing its job, and the price above the list follows in the same render. */
  const sel = visible.find((u) => u.id === pickedId) ?? visible[0];

  const chips = useMemo(
    () => [{ value: ALL, label: "All grades", n: units.length },
           ...groups.map((g) => ({ value: g.letter, label: "Grade " + g.letter, n: g.units.length }))],
    [groups, units.length],
  );

  if (visible.length === 0 || sel === undefined) {
    return (<EmptyState>No certified units available right now - check back soon.</EmptyState>);
  }

  const selGroup = groups.find((g) => g.letter === sel.grade)!;

  function add(u: Unit) {
    cartAdd({ asset_id: u.id, title, grade: u.grade, price_cents: u.sale_price_cents, serial_tail: u.serial_tail });
    setInCart(cartGet().map((c) => c.asset_id));
  }

  /* Both pickers are radiogroups the browser does not have to guess about: the arrows move
     selection and focus together (roving tabindex), so a row behaves like a radio rather than like a
     button that happens to have aria-checked on it. Clicking is the same single state change. */
  function step<T>(items: T[], from: number, delta: number, pick: (item: T) => void,
                   focus: (item: T) => void) {
    const next = items[(from + delta + items.length) % items.length];
    pick(next);
    focus(next);
  }

  function onChipKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1
                : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    step(chips, i, delta,
      (c) => { setGrade(c.value); setPickedId(null); },
      (c) => gradeRefs.current[c.value]?.focus());
  }

  function onUnitKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const delta = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1
                : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    step(visible, i, delta, (u) => setPickedId(u.id), (u) => unitRefs.current[u.id]?.focus());
  }

  return (
    <Card className="p-5 md:p-6">
      {/* The price of the selected UNIT. It replaced the "from" figure that used to hedge with:
          there is always an exact unit selected here, so there is no from left to quote. */}
      <div className="flex items-end gap-2">
        <Heading level="display" as="span">{aud(sel.sale_price_cents)}</Heading>
        <span className="text-xs text-ink-500 mb-1">refurbished - e-waste saved</span>
      </div>
      <p className="mt-2 text-xs text-ink-500">
        <Badge colorClass={selGroup.pill}>Grade {sel.grade}</Badge>{" "}
        <span className="ml-1">serial <span className="font-mono">***{sel.serial_tail}</span></span>
        {" - "}{selGroup.units.length} {selGroup.units.length === 1 ? "unit" : "units"} in this grade
      </p>

      <p id="unit-grade-label" className="mt-5 text-xs font-medium text-ink-600">Pick your unit by grade</p>
      <div role="radiogroup" aria-labelledby="unit-grade-label"
           className="mt-2 flex flex-wrap gap-2">
        {chips.map((c, i) => {
          const isSel = c.value === grade;
          return (
            <button key={c.value || "all"} type="button" role="radio" aria-checked={isSel}
              ref={(el) => { gradeRefs.current[c.value] = el; }}
              tabIndex={isSel ? 0 : -1}
              onClick={() => { setGrade(c.value); setPickedId(null); }}
              onKeyDown={(e) => onChipKey(e, i)}
              className={cn(
                "min-h-[44px] rounded-control px-3 text-xs font-semibold",
                "transition-colors duration-fast ease-out motion-reduce:transition-none",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2",
                isSel
                  ? "ring-2 ring-brand-700 bg-brand-50 text-ink-900"
                  : "ring-1 ring-line text-ink-600 hover:ring-line-strong hover:bg-surface-sunken active:bg-surface-pressed",
              )}>
              {c.label} <span className="font-normal text-ink-500">({c.n})</span>
            </button>
          );
        })}
      </div>

      <p id="unit-picker-label" className="mt-5 text-xs font-medium text-ink-600">Pick your unit</p>
      <div role="radiogroup" aria-labelledby="unit-picker-label"
           className="mt-2 max-h-[21rem] overflow-y-auto rounded-control ring-1 ring-line">
        {visible.map((u, i) => {
          const isSel = u.id === sel.id;
          const g = GRADES.find((x) => x.letter === u.grade);
          return (
            <button key={u.id} type="button" role="radio" aria-checked={isSel}
              ref={(el) => { unitRefs.current[u.id] = el; }}
              tabIndex={isSel ? 0 : -1}
              onClick={() => setPickedId(u.id)}
              onKeyDown={(e) => onUnitKey(e, i)}
              className={cn(
                "w-full min-h-[44px] px-3 py-2.5 flex items-center gap-3 text-left",
                "border-b border-line last:border-0",
                "transition-colors duration-fast ease-out motion-reduce:transition-none",
                isSel ? "bg-brand-50" : "bg-surface hover:bg-surface-sunken active:bg-surface-pressed",
              )}>
              <Badge colorClass={g?.pill ?? "bg-surface-sunken text-ink-500"}>Grade {u.grade}</Badge>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink-900 truncate font-mono">***{u.serial_tail}</span>
                <span className="block text-xs text-ink-500">{g?.label ?? "Certified unit"}</span>
              </span>
              <span className="shrink-0 text-sm font-semibold text-ink-900">{aud(u.sale_price_cents)}</span>
              {/* The check keeps its box when a row is not selected (transparent, not removed) so
                  picking a unit cannot shift the row's text sideways. */}
              <span className={cn("shrink-0 w-4", isSel ? "text-brand-700" : "text-transparent")} aria-hidden="true">
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
        {inCart.includes(sel.id) ? (
          <Button href="/cart" variant="secondary" className="w-full">In cart - view</Button>
        ) : (
          <Button variant="primary" className="w-full" onClick={() => add(sel)}>
            Add this unit - {aud(sel.sale_price_cents)}
          </Button>
        )}
      </div>

      {/* Small print. A row is too small to carry what its grade means, so the selected unit's grade
          explains itself under the button - all four grades are still described on the page, one
          selected unit at a time. */}
      <div className="mt-4 rounded-control bg-surface-sunken px-3 py-2.5">
        <p className="text-xs text-ink-600">{selGroup.spec}.</p>
        <p className="mt-1 text-xs text-ink-500">{selGroup.useCase}</p>
      </div>
      <p className="mt-3 text-xs text-ink-400">
        Every unit is serialised and graded by hand. You are reserving this exact unit - the serial
        in your cart is the one we ship.
      </p>
    </Card>
  );
}
