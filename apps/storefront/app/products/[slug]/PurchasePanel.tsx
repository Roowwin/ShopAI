"use client";

import { useMemo, useState, type ReactNode } from "react";
import { aud } from "@/lib/api";
import { cartAdd, cartGet } from "@/lib/cart";
import { GRADES } from "@/lib/grades";
import { Badge, Button, Card, Eyebrow, Heading, fieldClass, linkClass } from "../../components/ui";

/* THE PURCHASE PANEL - the right-hand column of the product page, and the only part of it that
   changes with stock.

   A product here is a MODEL (parent) and the stock behind it is individual certified units
   (children), each with its own serial and its own hand-assigned grade. This panel is where a
   shopper drops from the model to the units they will actually be shipped.

   WHAT CHANGED AND WHY. This replaces the previous two-step picker (grade chips, then a list of
   individual units to choose between by serial). Two steps was one step too many: the shopper
   had to make a filter decision and then a unit decision, when the only thing they can actually
   express at checkout is "this grade". So the chips became one `Grade` dropdown and the unit
   list became a quantity.

   THE ASSET MAPPING IS UNCHANGED, and that is the part that must not move: the quantity resolves
   to that many DISTINCT asset ids out of the selected grade - each still its own row with its own
   serial, still locked at checkout, still refused twice by cartAdd()'s dedupe. Nothing is
   bundled; "2" means two devices.

   THE CONTROLS COME FROM THE SHARED SHELL. `fieldClass` is the one control shell both the Input
   primitive and a bare <select> draw from, and its focus ring is brand-300 - which is correct for
   every page now that the whole app is dark. These two constants only add the recessed fill and
   the sizing the panel needs; they do not re-invent the shell.

   THE PANEL IS FOUR BLOCKS, in the order a shopper resolves them: identity (what is it), the price
   well (what it costs and whether it is available, boxed together so the second is not a footnote
   to the first), the two controls that decide the line (grade, then quantity - with the serial line
   beside the stepper it belongs to), and the CTA with the trust row under it. Everything below stays
   behind a divider: the trust promises, then the spec sheet in its <details>. */
const FIELD =
  fieldClass + " w-full px-3 py-2.5 " +
  "bg-surface-sunken text-ink-900 ring-1 ring-line hover:ring-line-strong";

const STEP =
  "h-11 w-11 shrink-0 inline-flex items-center justify-center rounded-control text-lg font-semibold " +
  "bg-surface-sunken text-ink-900 ring-1 ring-line hover:ring-line-strong " +
  "transition duration-fast ease-out motion-reduce:transition-none " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 " +
  "disabled:opacity-40 disabled:pointer-events-none";

type Unit = { id: number; grade: string; sale_price_cents: number; serial_tail: string };

/** Cheapest first, so the price the panel advertises is the one the first added unit carries. */
function byPrice(a: Unit, b: Unit): number {
  return a.sale_price_cents - b.sale_price_cents || a.serial_tail.localeCompare(b.serial_tail);
}

/* The three promises the shop already publishes, in the panel where the decision is made. The
   wording is lifted from the FAQ and the returns page rather than invented: "12-month RFO
   warranty" and "30 days from delivery" are the published terms, and "certified refurbished" is
   what the site says about itself. There is deliberately no buy-now-pay-later line - this
   platform has no such provider, and a payment promise is not something a page may invent. */
const TRUST: { label: string; icon: ReactNode }[] = [
  {
    label: "30-day returns",
    icon: (
      <path d="M4 8h9a4 4 0 1 1 0 8H7M4 8l3-3M4 8l3 3" />
    ),
  },
  {
    label: "12-month warranty",
    icon: (
      <>
        <path d="M10 2.5 16.5 5v5c0 3.6-2.6 6.6-6.5 7.5C6.1 16.6 3.5 13.6 3.5 10V5L10 2.5Z" />
        <path d="m7.2 10 2 2 3.6-3.8" />
      </>
    ),
  },
  {
    label: "Certified refurbished",
    icon: (
      <>
        <path d="M10 2.5 16.5 5v5c0 3.6-2.6 6.6-6.5 7.5C6.1 16.6 3.5 13.6 3.5 10V5L10 2.5Z" />
        <path d="M10 6.5v4M10 13.2v.3" />
      </>
    ),
  },
];

export default function PurchasePanel({ units, title, brand, model, slug, specs }: {
  units: Unit[]; title: string; brand: string; model: string; slug: string;
  specs: [string, string][];
}) {
  /* Every grade A-D, with the units behind it. A grade with nothing on the shelf is still
     listed (disabled, "out of stock") rather than dropped: the ladder is a fact about the shop,
     and a dropdown that silently loses a rung reads as though the grade stopped existing. */
  const shelf = useMemo(
    () => GRADES.map((g) => ({ letter: g.letter, label: g.label, units: units.filter((u) => u.grade === g.letter).sort(byPrice) })),
    [units],
  );

  const firstStocked = shelf.find((g) => g.units.length > 0)?.letter ?? GRADES[0].letter;
  const [grade, setGrade] = useState<string>(firstStocked);
  const [qty, setQty] = useState(1);
  const [bag, setBag] = useState<number[]>(() => cartGet().map((c) => c.asset_id));

  const inGrade = shelf.find((g) => g.letter === grade)?.units ?? [];
  const stock = inGrade.length;
  const soldOut = units.length === 0;

  /* The units the next press of Add to Bag would take, cheapest first. Derived, never stored -
     so lowering the quantity, switching grade or a unit being bought by someone else all resolve
     in the same render with no cleanup pass. */
  const picked = inGrade.slice(0, Math.min(qty, stock));
  const unitPrice = inGrade[0]?.sale_price_cents;
  const total = picked.reduce((s, u) => s + u.sale_price_cents, 0);
  const already = picked.filter((u) => bag.includes(u.id)).length;
  const allInBag = picked.length > 0 && already === picked.length;

  function pickGrade(next: string) {
    setGrade(next);
    /* The quantity belongs to the grade that was showing. `Grade A x3` becoming `Grade D` must
       not silently mean three Grade D units, which the shopper never asked for - and on a grade
       with one unit it would not even be expressible. Back to one, so the next press is always
       exactly what the panel is showing. */
    setQty(1);
  }

  function addToBag() {
    for (const u of picked) {
      cartAdd({ asset_id: u.id, title, grade: u.grade, price_cents: u.sale_price_cents, serial_tail: u.serial_tail });
    }
    setBag(cartGet().map((c) => c.asset_id));
  }

  return (
    <Card className="p-6 ring-1 ring-line">
      {/* THE IDENTITY BLOCK, and the order it sets: brand as the kicker, the catalogue's own title
          as the heading, then the one line that names WHICH product this is.

          That line carries the model and the catalogue code, and it deliberately does NOT carry a
          supplier SKU. `products.sku` exists, but it belongs to the importer's supplier rows rather
          than to this retail model, and this page is never handed it - so the code printed here is
          the slug, the identifier the shop's own URLs use, rather than a part number invented to
          fill the slot.

          THE BREADCRUMB IS GONE FROM THIS PANEL and now leads the page (see page.tsx). It used to
          open the right-hand column, which put "Home / laptops" beside the price on a desktop and
          under the photograph on a phone - and a page gets one breadcrumb, not one per column. */}
      <Eyebrow>{brand}</Eyebrow>
      <Heading level="h1" className="mt-1">{title}</Heading>
      <p className="mt-2 text-xs text-ink-500">
        {model ? <>{model} <span aria-hidden="true">&middot;</span> </> : null}
        <span className="text-ink-600">{slug}</span>
      </p>

      {soldOut ? (
        <div className="mt-5">
          <Badge colorClass="bg-surface-sunken text-ink-500">Out of stock</Badge>
          <p className="mt-3 text-sm text-ink-600">
            Every unit of this model has sold. Certified stock arrives weekly - ask the assistant
            and it will tell you what is closest.
          </p>
        </div>
      ) : (
        <>
          {/* THE PRICE WELL. The number sits in its own recessed container rather than floating on
              the panel, so "what it costs" and "whether you can have it" read as one block instead
              of a headline with a footnote somewhere below it.

              THE PRICE IS THE STRONGEST NEUTRAL INK, not the brand. It was `text-brand-700` while
              brand-700 was brass, which read 4.4:1 on this ground and cleared the 3:1 large-text
              bar at 32px semibold. brand-700 is forest green now (#245B45), and forest as INK on a
              dark card measures about 2.1:1 - the price would have been the least legible thing on
              the page. So the number is `ink-900`, the same white as every heading, and the brand
              colour is left to the one control that is actually an action. */}
          <div className="mt-5 rounded-control bg-surface-sunken p-4 ring-1 ring-line">
            <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
              <p className="font-display text-display text-ink-900">{unitPrice !== undefined ? aud(unitPrice) : "-"}</p>
              <p className="text-xs text-ink-500 pb-1.5">incl. GST</p>
            </div>

            {/* The availability line counts the GRADE the dropdown is on, not the model, because
                that is the number the shopper is buying against: a model can hold ten units while
                the grade they have chosen holds none, and the button below is about to refuse.
                The dot is the design's green - grade A's solid, the only positive step in this
                palette - rather than a new "available" colour invented beside it. */}
            <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-500">
              <span aria-hidden="true" className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-grade-a-solid" />
              {stock} {stock === 1 ? "unit" : "units"} in stock at grade {grade}
            </p>

            {qty > 1 && (
              <p className="mt-1 text-sm text-ink-500">
                {qty} units &middot; <span className="font-semibold text-ink-900">{aud(total)}</span>
              </p>
            )}
          </div>

          <div className="mt-6 space-y-4">
            <div>
              <label htmlFor="pdp-grade" className="block text-xs font-semibold text-ink-600 mb-1.5">Grade</label>
              <select id="pdp-grade" className={FIELD + " px-3 py-2.5"}
                value={grade} onChange={(e) => pickGrade(e.target.value)}>
                {shelf.map((g) => (
                  <option key={g.letter} value={g.letter} disabled={g.units.length === 0}>
                    Grade {g.letter} - {g.label} ({g.units.length === 0 ? "out of stock" : g.units.length + " in stock"})
                  </option>
                ))}
              </select>
            </div>

            {/* A real group with a real label, so "Quantity, 2" is what a screen reader announces
                rather than three loose controls. The value is a live region for the same reason:
                the +/- buttons change a number that is nowhere else on the page. */}
            <div role="group" aria-labelledby="pdp-qty-label">
              <span id="pdp-qty-label" className="block text-xs font-semibold text-ink-600 mb-1.5">Quantity</span>
              <div className="flex items-center gap-3">
                <button type="button" className={STEP} aria-label="Decrease quantity"
                  disabled={qty <= 1} onClick={() => setQty((n) => Math.max(1, n - 1))}>
                  <span aria-hidden="true">&minus;</span>
                </button>
                <span aria-live="polite" className="min-w-[2.5rem] text-center text-sm font-semibold text-ink-900">
                  {Math.min(qty, Math.max(stock, 1))}
                </span>
                <button type="button" className={STEP} aria-label="Increase quantity"
                  disabled={qty >= stock} onClick={() => setQty((n) => Math.min(stock, n + 1))}>
                  <span aria-hidden="true">+</span>
                </button>
              </div>

              {/* The serial line belongs to the stepper that decides it rather than to the button
                  below, because it is the answer to "how many" - and it names WHICH serials rather
                  than only how many, since the cart line the shopper gets is per-device. It stays a
                  role="status" so the change is announced when the grade or the quantity moves.
                  The "N in grade X" note that used to sit on this row is gone: the availability
                  line in the price well says the same thing once, in the block where the price is,
                  and the two rows could otherwise disagree for a render after a grade change. */}
              <p className="mt-3 text-xs text-ink-500" role="status">
                {already > 0 && !allInBag
                  ? already + " of these " + (already === 1 ? "is" : "are") + " already in your bag."
                  : picked.length > 0
                    ? "Serial" + (picked.length === 1 ? "" : "s") + " reserved at checkout: " + picked.map((u) => "***" + u.serial_tail).join(", ")
                    : "Nothing in this grade yet."}
              </p>
            </div>
          </div>

          <Button variant="primary" className="mt-6 w-full"
            disabled={soldOut || stock === 0 || allInBag} onClick={addToBag}>
            {allInBag ? "In your bag" : "Add to Bag"}
          </Button>
        </>
      )}

      {/* The trust row. Three columns at the foot of the panel, where the decision is made -
          rather than a fourth row of chips under the fold. */}
      <ul className="mt-6 grid grid-cols-3 gap-2 border-t border-line pt-5">
        {TRUST.map((t) => (
          <li key={t.label} className="flex flex-col items-center gap-1.5 text-center">
            <svg viewBox="0 0 20 20" className="h-5 w-5 text-brand-300" fill="none" stroke="currentColor"
              strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {t.icon}
            </svg>
            <span className="text-[11px] leading-tight text-ink-500">{t.label}</span>
          </li>
        ))}
      </ul>

      {/* Expandable, and native: <details> is keyboard-operable, screen-reader-announced and
          works with scripting off, which three lines of state would only re-implement worse. */}
      {specs.length > 0 && (
        <details className="mt-5 border-t border-line pt-5 group">
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden text-sm font-semibold text-ink-900 flex items-center justify-between gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2">
            Product details
            <span aria-hidden="true" className="text-ink-500 transition-transform duration-fast ease-out group-open:rotate-180 motion-reduce:transition-none">
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m5 8 5 5 5-5" /></svg>
            </span>
          </summary>
          <dl className="mt-3 space-y-1.5">
            {specs.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 border-b border-line py-1.5 text-sm">
                <dt className="text-ink-500">{label}</dt>
                <dd className="text-ink-900 font-medium text-right">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-ink-500">
            Model <span className="text-ink-600">{slug}</span> - grading explained on the{" "}
            <a href="/grades" className={linkClass}>grades page</a>.
          </p>
        </details>
      )}
    </Card>
  );
}
