"use client";

import { Button, Heading } from "@/app/components/ui";
import { aud } from "@/lib/format";
import type { AssetDetail, CatalogItem, Worklist, WorklistAsset } from "./types";

/* The right panel: the storefront product page, drawn as it will read.

   IT UPDATES ON EVERY KEYSTROKE because it renders the same state the fields above edit - there is
   no separate preview model to fall out of step with the copy being published. What it draws is the
   storefront's own page shape, read off apps/storefront/app/products/[slug]/page.tsx: the
   breadcrumb, the brand-and-category eyebrow, the title, the out-of-stock badge, the image slot,
   the three trust tiles, the description, and the grade-and-price buy box.

   THE PALETTE IS DELIBERATELY NOT THIS APP'S TOKENS. The backoffice is a dark app: its `ink-900` is
   near-white. The storefront is a light one: its `ink-900` is slate-900 (15 23 42), and its page
   ground is stone-50. Painting the preview with `text-ink-900` here would put near-white text on a
   white mockup - the token's value means the opposite of what this panel means by it - so the
   mockup uses Tailwind's own slate/stone steps, which are the exact values behind the storefront's
   tokens (checked against apps/storefront/app/globals.css, not guessed). This is a deliberate,
   documented divergence rather than drift: do not "unify" it back onto the admin tokens.

   THE IMAGE TILE IS THE FALLBACK, and it is labelled as one. A product's `image_url` is relative to
   the storefront host (the seeder writes /icons/ followed by the product slug) and this host does
   not serve that path, so an <img> here would arrive broken - and a broken picture is a false claim
   about a product. The initials tile is what the storefront itself draws when a product has no
   image, so it is a real state of the real page rather than an invented stand-in.

   NOTHING HERE IS INTERACTIVE. The buy box's button is a span: a control that looks pressable and
   does nothing is worse than one that plainly is not, and this panel is a picture of another page. */

const TRUST = ["Serialised", "Graded A-D", "Warehouse-tracked"];

export default function LivePreview({ title, description, product, unit, detail, lot }: {
  title: string;
  description: string;
  product: CatalogItem | null;
  unit: WorklistAsset;
  detail: AssetDetail | null;
  lot: Worklist;
}) {
  const brand = product?.brand ?? "";
  const category = product?.category ?? unit.category ?? "";
  const grade = detail?.grade ?? unit.grade;
  const priceCents = detail?.sale_price_cents ?? null;
  const initials = (brand || unit.product_title || "?").slice(0, 2).toUpperCase();
  const listed = (detail?.status ?? unit.status) === "listed";

  return (
    <section aria-label="Storefront preview">
      <Heading level="h3" as="h2">Live preview</Heading>
      <p className="mt-1 pb-3 text-xs text-ink-500">
        The storefront product page, updated as you type. {listed
          ? "This unit is already listed, so the page is live now."
          : "This unit is not listed yet - publishing is what puts it on this page."}
      </p>

      {/* The mockup is a light panel inside the dark app on purpose: it stands for the storefront,
          not for this screen. */}
      <div className="overflow-hidden rounded-card bg-stone-50 ring-1 ring-line">
        <div className="p-5">
          <nav className="text-xs text-slate-400">
            <span>Home</span> <span className="px-1">/</span>
            <span>{category || "Category"}</span> <span className="px-1">/</span>
            <span className="text-slate-600">{title || "Untitled"}</span>
          </nav>

          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <div>
              <p className="text-eyebrow uppercase text-slate-500">
                {brand || "Brand"} - {category || "Category"}
              </p>
              <h4 className="mt-1 text-lg font-bold text-slate-900">
                {title || "The listing title appears here"}
              </h4>

              {/* The storefront draws this badge when the product has no listed units. A unit that
                  is not yet listed is exactly that state, which is why it is shown before publish. */}
              {!listed && (
                <p className="mt-2 inline-block rounded-control bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                  Out of stock
                </p>
              )}

              <div className="mt-3 flex aspect-[4/3] flex-col items-center justify-center rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 text-slate-600">
                <p className="text-3xl font-bold text-slate-400">{initials}</p>
                <p className="mt-2 text-xs">Product photo coming soon</p>
                <p className="mt-0.5 text-[10px] text-slate-400">{brand} {product?.model ?? ""}</p>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[10px] text-slate-500">
                {TRUST.map((t) => (
                  <div key={t} className="rounded-xl bg-white px-2 py-2 shadow-sm">{t}</div>
                ))}
              </div>
            </div>

            <aside>
              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <p className="text-xs text-slate-500">Selected grade</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {grade ? "Grade " + grade : "No grade set"}
                </p>
                <p className="mt-3 text-xl font-bold text-slate-900">{aud(priceCents)}</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {priceCents == null
                    ? "A unit cannot be listed without a sale price."
                    : "Includes GST - set on the unit, not by this page."}
                </p>
                <div className="mt-3">
                  <Button as="span" size="sm" className="w-full">Add to cart</Button>
                </div>
                <p className="mt-2 text-[10px] text-slate-400">
                  Drawn, not wired - this panel is a preview, not the shop.
                </p>
              </div>

              <p className="mt-3 text-[11px] text-slate-400">
                Lot {lot.lot.lot_number} ({lot.lot.status}). A listed unit in a non-active lot is
                stored but stays off the storefront.
              </p>
            </aside>
          </div>

          <div className="mt-5 border-t border-slate-200 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Description</p>
            <p className="mt-2 whitespace-pre-line text-sm text-slate-600">
              {description || "The description appears here as you write it."}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
