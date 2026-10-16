"use client";

import { useMemo, useState } from "react";
import { conditionFor } from "@/lib/condition";
import CategoryGlyph from "../../components/CategoryGlyph";
import ProductArt from "../../components/ProductArt";
import PurchasePanel from "./PurchasePanel";

/* THE STAGE: the gallery and the purchase panel, in one client component, because they now answer
   to the same decision.

   WHY THEY HAD TO BE JOINED. The panel has always owned "which grade am I looking at" - it is the
   only control on the page that asks, and the only thing the cart can express. The gallery, until
   now, did not care: a model carried ONE photograph (`products.image_url`) and the rail held that
   one shot. That was consistent while a photograph said nothing about condition.

   It stops being consistent the moment a photo is per GRADE, which is what product groups make
   true. A Grade D unit and a Grade A unit of the same keyboard are not the same object, and showing
   the Grade A shot to a shopper who has selected Grade D is the misrepresentation this shop's whole
   grading scale exists to avoid. So the selected grade is lifted out of the panel into this
   component, and the hero follows it.

   WHAT DID NOT MOVE. The parent/child split, the columns, the sticky panel, and every price: the
   panel still derives everything it shows from `units`, and the panel is still the only thing on
   the page that carries a price. This component owns a grade and a photograph, nothing else.

   THE FALLBACK ORDER, which is the whole of the logic worth reading here:
     1. the selected grade's own photograph, when the group for that grade has one;
     2. otherwise the model's card photograph (`products.image_url`), which is a real photo once any
        grade has been published and a shipped `/icons/` glyph before that;
     3. otherwise the category glyph tile below, unchanged.
   Step 2 is what keeps a model with only a Grade A photo from showing a blank tile to a Grade C
   shopper: a photograph of the model beats no photograph, and neither is ever passed off as the
   unit being bought. */

type Unit = { id: number; grade: string; sale_price_cents: number; serial_tail: string };
type GradeShot = { grade: string; image_url: string | null; price_cents: number | null };

/* The grades in ladder order, so "the best grade with a photograph" and "the first grade with
   stock" are both read the same way here as they are everywhere else in the shop. */
const GRADE_ORDER = ["A", "B", "C", "D"];

/** The grade the page opens on: the best one that actually has stock, else A.
 *
 *  Exported from here rather than from the panel because the panel no longer decides it - the stage
 *  does, before the panel is ever rendered. "Best grade with stock" is the same rule the panel used
 *  to apply to itself; there is exactly one copy of it. */
export function firstStockedGrade(units: { grade: string }[]): string {
  for (const letter of GRADE_ORDER) {
    if (units.some((u) => u.grade === letter)) return letter;
  }
  return GRADE_ORDER[0];
}

export default function ProductStage({ slug, title, brand, model, imageUrl, groups, units, category }: {
  slug: string; title: string; brand: string; model: string;
  imageUrl: string | null; groups: GradeShot[]; units: Unit[];
  /** The catalogue category, which is what says whether this product is a graded device or a new
      accessory / a working part - see lib/condition.ts. */
  category?: string | null;
}) {
  const [grade, setGrade] = useState<string>(() => firstStockedGrade(units));
  const condition = conditionFor(category);
  const inStock = units.length > 0;

  /* Which grades have a photograph of their own. Built once per payload rather than per render:
     the map is what both the rail and the hero read, and rebuilding it on every keystroke in the
     quantity field would be work done for nothing. */
  const shotsByGrade = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) {
      if (g.grade && g.image_url) m.set(g.grade, g.image_url);
    }
    return m;
  }, [groups]);

  /* THE RAIL. One rung per grade that HAS a photograph, in ladder order - or the model's own card
     shot when no grade has one, which is every product on the shop today. A grade with no
     photograph is not drawn as an empty tile: `ProductArt` would fall through to the same placeholder
     for all four grades and the rail would read as four identical photographs, which is worse than
     a rail of one. */
  const rail = useMemo(() => {
    const perGrade = GRADE_ORDER.filter((g) => shotsByGrade.has(g))
      .map((g) => ({ key: g, grade: g as string | null, url: shotsByGrade.get(g)! }));
    if (perGrade.length > 0) return perGrade;
    return [{ key: "model", grade: null as string | null, url: imageUrl ?? null }];
  }, [shotsByGrade, imageUrl]);

  /* THE HERO follows the selected grade. See the fallback order in the header comment. */
  const heroUrl = shotsByGrade.get(grade) ?? imageUrl ?? null;

  /* THE TILE for a product with no photograph, and NOT the initials block it used to be. Two letters
     of the brand, drawn at display size in a 4:3 well, is what the catalogue tiles had - and on this
     page it read even worse, because it is the hero: a shopper met a giant "GE" where the product
     should be, under the words "Product photo coming soon". It is now the same category glyph the
     cards use, at hero size, with the item named underneath - true, even, and the same visual
     language as every other tile in the shop. The wording stays the shop's own. */
  const noPhoto = (
    <div className="w-full aspect-[4/3] bg-surface-sunken flex flex-col items-center justify-center text-ink-500">
      <CategoryGlyph category={category} className="h-20 w-20 text-brand-500" />
      <p className="text-xs mt-3">Product photo coming soon</p>
      <p className="text-xs text-ink-400 mt-0.5">{brand} {model}</p>
    </div>
  );

  return (
    <>
      <div className="order-1 lg:col-span-7">
        <div className="grid gap-3 sm:grid-cols-[88px_minmax(0,1fr)]">
          <div className="order-2 flex gap-3 overflow-x-auto sm:order-1 sm:flex-col sm:overflow-visible">
            {rail.map((shot) => (
              /* The ring says which shot the hero is showing. While the rail is one rung per grade it
                 says which GRADE, so it is written from the selection rather than from the index -
                 and clicking a rung moves the shopper to that grade, which is the same decision the
                 panel's dropdown makes. One decision, two controls, one piece of state. */
              <button
                key={shot.key}
                type="button"
                onClick={() => { if (shot.grade) setGrade(shot.grade); }}
                aria-label={shot.grade ? "Show the Grade " + shot.grade + " photograph" : "Show the product photo"}
                aria-current={shot.grade ? shot.grade === grade : undefined}
                className={"shrink-0 w-20 sm:w-full rounded-control overflow-hidden " +
                  (shot.grade ? (shot.grade === grade ? "ring-2 ring-ink-700" : "ring-1 ring-line")
                              : "ring-2 ring-ink-700")}
              >
                <ProductArt slug={slug} imageUrl={shot.url} alt={shot.grade ? title + " (Grade " + shot.grade + ")" : title}
                  className="w-full aspect-[4/3] object-cover" fallback={noPhoto} />
              </button>
            ))}
          </div>

          {/* The well the hero is mounted in: the recessed fill on the hairline, which is what makes
              a photograph read as set into the page rather than pasted onto it. `relative` exists for
              the inspection badge, which floats over the image's top-left corner.

              THE BADGE IS A CLAIM, so it is only made when there is something to claim: a model whose
              every unit has sold has no unit on the page to call inspected, and the badge is withheld.
              The wording is the shop's own published one ("checked and graded by hand, one at a
              time", below) rather than a new promise invented for a decoration. */}
          <div className="order-1 sm:order-2">
            <div className="relative rounded-card overflow-hidden ring-1 ring-line bg-surface-sunken">
              <ProductArt slug={slug} imageUrl={heroUrl} alt={title} priority
                className="w-full aspect-[4/3] object-cover" fallback={noPhoto} />
              {inStock && (
                <p className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-surface-deep/85 px-3 py-1.5 text-xs font-medium text-ink-700 backdrop-blur-md ring-1 ring-line">
                  <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0 text-grade-a-ink" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="10" cy="10" r="7.5" />
                    <path d="m6.8 10.2 2.2 2.2 4.2-4.6" />
                  </svg>
                  {condition ? condition.label : "Hand-Inspected Unit"}
                </p>
              )}
            </div>
            {/* Which grade the photograph above is OF. Said out loud, because the whole point of a
                per-grade photograph is that the shopper can tell which one they are looking at -
                and a shopper who has not noticed the rail is a shopper who has not noticed the grade. */}
            {shotsByGrade.has(grade) && (
              <p className="mt-2 text-xs text-ink-500">
                {condition
                  ? "Shown: this product."
                  : "Shown: a Grade " + grade + " unit of this model. Other grades are shown on their own."}
              </p>
            )}
            {!inStock && (
              <p className="mt-3 text-sm text-ink-500">
                This model is sold out - the panel beside it lists nothing to buy.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* The child half. Every price, grade and serial in this panel comes from one of the units the
          page was handed - the column to its left never carries a price. */}
      <div className="order-2 lg:col-span-5 lg:sticky lg:top-24">
        <PurchasePanel units={units} title={title} brand={brand} model={model}
          slug={slug} grade={grade} onGradeChange={setGrade} category={category} />
      </div>
    </>
  );
}
