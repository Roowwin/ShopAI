"use client";

import type { ReactNode } from "react";
import { Badge, Button, Heading } from "@/app/components/ui";
import { aud } from "@/lib/format";
import { kickerClass, statusTone } from "@/lib/ui";
import type { AssetDetail, CatalogItem, Worklist, WorklistAsset } from "./types";

/* The left panel of the studio: the unit, and the facts a draft is written from.

   READ-ONLY. It sends nothing and holds no control except the way back out. The three things the
   brief names - the raw technical notes, the model, the brand - are here, together with the grade,
   because those are the facts the model is handed and a reader who cannot see them cannot judge
   the copy beside them.

   THE NOTES ARE THE UNIT'S OWN, not the product's. A product row has a description, but that is the
   copy being replaced; what the operator graded is this unit's note - the merged
   audit/cosmetic/functional text the importer wrote - and that is the "raw technical notes" a
   listing is written from. Product-level spec keys are shown underneath as they are, but only when
   their value has a readable form: a nested shape would print as an opaque stand-in for data.

   LISTING READINESS IS STATED, NOT ENFORCED. Three facts decide whether the publish will be
   accepted - a grade, a sale price, and a lot that is active - and the panel says each one plainly
   so the operator knows before pressing. It deliberately does NOT disable the publish control on
   the strength of them: the database's own trigger and the chk_listed_has_price constraint are the
   authority on what may be listed, and a client-side guess that disabled the button would turn a
   refused write into a dead end the operator cannot even attempt. */

const LINE = "flex items-baseline justify-between gap-4 py-1";

/* A spec line is only shown when its value has a readable form; a nested shape would otherwise
   print as an opaque stand-in for data, which is the one outcome worth avoiding on a panel that
   claims to show what the model is given. */
function readable(v: unknown): v is string | number {
  return typeof v === "string" || typeof v === "number";
}

function Ready({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 py-1">
      <span aria-hidden="true" className={ok ? "text-brand-300" : "text-accent-400"}>
        {ok ? "✓" : "•"}
      </span>
      <span className={ok ? "text-ink-600" : "text-ink-600"}>
        <span className="sr-only">{ok ? "ready: " : "not ready: "}</span>
        {children}
      </span>
    </li>
  );
}

export default function SourcePanel({ unit, detail, product, lot, onBack }: {
  unit: WorklistAsset;
  /** null while the detail read is out, or when it refused */
  detail: AssetDetail | null;
  /** null when the unit has no product, or the product is not in the public catalogue */
  product: CatalogItem | null;
  lot: Worklist;
  onBack: () => void;
}) {
  const notes = detail?.notes ?? unit.notes;
  const specs: Array<[string, string | number]> =
    product && product.specs && typeof product.specs === "object"
      ? Object.entries(product.specs).filter((e): e is [string, string | number] => readable(e[1]))
      : [];
  const priceCents = detail?.sale_price_cents ?? null;
  const grade = detail?.grade ?? unit.grade;
  const lotActive = lot.lot.status === "active";

  return (
    <section aria-label="Source">
      <Heading level="h3" as="h2">Source</Heading>
      <p className="mt-1 pb-3 text-xs text-ink-500">
        The unit and the verified facts the draft is written from.
      </p>

      <dl className="text-sm">
        <div className={LINE}>
          <dt className="text-ink-500">Product</dt>
          <dd className="text-right font-semibold text-ink-900">
            {product?.title ?? unit.product_title ?? "no product linked"}
          </dd>
        </div>
        <div className={LINE}>
          <dt className="text-ink-500">Brand</dt>
          <dd className="text-ink-700">{product?.brand ?? "-"}</dd>
        </div>
        <div className={LINE}>
          <dt className="text-ink-500">Model</dt>
          <dd className="text-ink-700">{product?.model ?? unit.product_model ?? "-"}</dd>
        </div>
        <div className={LINE}>
          <dt className="text-ink-500">Grade</dt>
          <dd className="text-ink-700">{grade ?? "not graded"}</dd>
        </div>
        <div className={LINE}>
          <dt className="text-ink-500">Category</dt>
          <dd className="text-ink-700">{product?.category ?? unit.category ?? "-"}</dd>
        </div>
      </dl>

      <div className="mt-4 border-t border-line pt-3">
        <p className={kickerClass}>Unit</p>
        <dl className="mt-1 text-sm">
          <div className={LINE}>
            <dt className="text-ink-500">Asset id</dt>
            <dd className="font-mono text-ink-700">{unit.id}</dd>
          </div>
          <div className={LINE}>
            <dt className="text-ink-500">Serial</dt>
            <dd className="font-mono text-ink-700">{unit.serial_number ?? "-"}</dd>
          </div>
          <div className={LINE}>
            <dt className="text-ink-500">Status</dt>
            <dd><Badge colorClass={statusTone(detail?.status ?? unit.status)}>{detail?.status ?? unit.status}</Badge></dd>
          </div>
          <div className={LINE}>
            <dt className="text-ink-500">List price</dt>
            <dd className="tabular-nums text-ink-700">{aud(priceCents)}</dd>
          </div>
          <div className={LINE}>
            <dt className="text-ink-500">Lot</dt>
            <dd className="font-mono text-ink-700">{lot.lot.lot_number}</dd>
          </div>
        </dl>
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <p className={kickerClass}>Raw technical notes</p>
        {notes ? (
          <p className="mt-1 whitespace-pre-line text-sm text-ink-700">{notes}</p>
        ) : (
          <p className="mt-1 text-sm text-ink-400">
            No notes recorded on this unit. Grading writes the cosmetic and functional note here;
            until one exists, a draft has the product facts and nothing else to go on.
          </p>
        )}
      </div>

      {specs.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className={kickerClass}>Product specs</p>
          <dl className="mt-1 text-sm">
            {specs.map(([k, v]) => (
              <div key={k} className={LINE}>
                <dt className="text-ink-500">{k}</dt>
                <dd className="text-ink-700">{String(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="mt-4 border-t border-line pt-3">
        <p className={kickerClass}>Listing readiness</p>
        <ul className="mt-1 text-sm">
          <Ready ok={grade != null}>
            {grade != null
              ? "Graded " + grade + " - a unit cannot be listed without a grade."
              : "No grade yet. Set one on the unit before it can be listed."}
          </Ready>
          <Ready ok={priceCents != null}>
            {priceCents != null
              ? "Sale price set (" + aud(priceCents) + ")."
              : "No sale price. The database refuses `listed` without one - set it on the asset page."}
          </Ready>
          <Ready ok={lotActive}>
            {lotActive
              ? "Lot is active - a listed unit in this lot shows on the storefront."
              : "Lot is not active. A listed unit in a non-active lot is stored but stays off the storefront."}
          </Ready>
          <Ready ok={(detail?.status ?? unit.status) === "graded"}>
            {(detail?.status ?? unit.status) === "graded"
              ? "The unit is `graded`, the one step the status ladder allows from `listed`."
              : "The unit is `" + (detail?.status ?? unit.status) + "`; the ladder only allows graded -> listed."}
          </Ready>
        </ul>
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <Button variant="secondary" size="sm" onClick={onBack}>Search another unit</Button>
      </div>
    </section>
  );
}
