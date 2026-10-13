"use client";

import { aud } from "@/lib/format";
import Photo from "./Photo";

/* THE HERO, DRAWN AS THE SHOP DRAWS IT, an arm's length from the fields that write it.

   A LIGHT ISLAND ON A DARK PAGE, ON PURPOSE. The backoffice's palette is the midnight one: its
   `ink-900` is near-white and its `surface` is the darkest step, because a token named by ROLE
   flips its VALUE when the ground flips. The storefront is the warm light theme. So this panel does
   not use the admin's tokens at all - it uses literal colours, which is the only way a preview of a
   LIGHT page can be drawn inside a dark one. Writing `text-ink-900` here would be near-white ink on
   a white card: the exact failure the palette's own note warns about.

   WHAT IT MIRRORS, and what it does not. It is the hero's copy and CTA and the deal card's four
   facts, laid out as the storefront lays them out. It is not a pixel copy - the storefront's
   category-glyph art and its scroll choreography are not reproduced, and pretending otherwise would
   be a preview that lies about everything it cannot see. The panel is labelled as a preview for the
   same reason.

   THE TEXT IS NORMALISED BEFORE IT IS DRAWN. The server replaces a blank field with the shipped
   default and truncates to its own limits, so those are what the shop would actually show; drawing
   the raw field instead would let an operator believe they had cleared the headline when the
   default is what went live. */
export type Deal = { title: string; product_slug: string; badge: string };
export type Hero = { hero_title: string; hero_sub: string; cta_label: string; deal_of_month?: Deal | null };

/* The shipped copy, mirroring staff_ops.HOME_DEFAULTS (and the storefront's own page, which carries
   the same three strings). A default lives in exactly one place per app, and this is the admin's. */
export const HOME_DEFAULTS = {
  hero_title: "Renewed tech. Zero waste.",
  hero_sub: "Certified refurbished devices - serialised, graded, warehouse-tracked.",
  cta_label: "Shop devices",
};

/** What the server will store for this draft - see the note above. */
export function heroAsPublished(hero: Hero): Hero {
  const deal = hero.deal_of_month;
  const slug = (deal?.product_slug ?? "").trim();
  return {
    hero_title: (hero.hero_title || HOME_DEFAULTS.hero_title).slice(0, 120),
    hero_sub: (hero.hero_sub || HOME_DEFAULTS.hero_sub).slice(0, 240),
    cta_label: (hero.cta_label || HOME_DEFAULTS.cta_label).slice(0, 40),
    deal_of_month: slug
      ? {
          title: (deal?.title ?? "").trim().slice(0, 140),
          product_slug: slug.slice(0, 140),
          badge: (deal?.badge ?? "").trim().slice(0, 40) || "Deal of the Month",
        }
      : null,
  };
}

export type PreviewDeal = {
  slug: string;
  address: string | null;
  price: number | null;
  /** The storefront publishes the deal only when the product has a listed unit in an active lot. */
  live: boolean;
};

type Props = {
  hero: Hero;
  deal: PreviewDeal | null;
  /** An active offer replaces the headline on the live site - said here, not simulated there. */
  promoActive: boolean;
};

export default function HeroPreview({ hero, deal, promoActive }: Props) {
  const h = heroAsPublished(hero);
  const d = h.deal_of_month;

  return (
    <div className="overflow-hidden rounded-card bg-white ring-1 ring-slate-200">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
          Preview &middot; homepage hero
        </span>
      </div>

      <div className="px-5 py-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-emerald-700">RFO Store</p>
        <p className="mt-2 text-xl font-semibold tracking-tight text-slate-900">{h.hero_title}</p>
        <p className="mt-2 text-xs leading-relaxed text-slate-600">{h.hero_sub}</p>
        <span className="mt-4 inline-flex min-h-[32px] items-center rounded-full bg-emerald-700 px-4 text-xs font-semibold text-white">
          {h.cta_label}
        </span>
      </div>

      {promoActive && (
        <p className="border-t border-amber-200 bg-amber-50 px-5 py-2 text-[11px] text-amber-800">
          An offer is live, so the shop shows the offer&rsquo;s name where this headline is.
        </p>
      )}

      <div className="border-t border-slate-200 bg-slate-50 px-5 py-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Deal of the month</p>

        {!d && (
          <p className="mt-3 text-xs text-slate-500">
            No deal is pinned, so the shop does not draw this section.
          </p>
        )}

        {d && (
          <>
            <div className="mt-3 flex overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
              <Photo
                address={deal?.address ?? null}
                alt=""
                className="aspect-[4/3] w-1/2 object-cover"
                fallback={
                  <span className="flex aspect-[4/3] w-1/2 items-center justify-center bg-slate-100">
                    <span className="text-lg font-bold text-slate-400">{d.title.slice(0, 2).toUpperCase()}</span>
                  </span>
                }
              />
              <div className="flex w-1/2 flex-col justify-center p-3">
                <span className="inline-flex self-start rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-white">
                  {d.badge}
                </span>
                <p className="mt-2 text-sm font-semibold text-slate-900">{d.title}</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {deal?.price !== null && deal?.price !== undefined ? aud(deal.price) : "-"}
                </p>
                <span className="mt-3 inline-flex self-start rounded-full bg-emerald-700 px-3 py-1 text-[11px] font-semibold text-white">
                  View deal
                </span>
              </div>
            </div>

            {deal && !deal.live && (
              <p className="mt-3 rounded-control bg-amber-50 px-3 py-2 text-[11px] text-amber-800 ring-1 ring-amber-200">
                This product has no listed unit in an active lot, so the shop will not publish this
                section yet.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
