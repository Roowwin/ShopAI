"use client";

import { aud } from "@/lib/format";
import Photo from "./Photo";

/* THE HERO, DRAWN AS THE SHOP DRAWS IT, an arm's length from the fields that write it.

   LITERAL COLOURS, NOT TOKENS, ON PURPOSE - and this is the whole reason the file looks the way it
   does. A token is named by ROLE and its VALUE is whatever that role means on THIS app's ground.
   The two apps keep separate ladders: the backoffice is cool slate, the storefront is warm
   forest-and-charcoal. `text-ink-900` here is the ADMIN's near-white, and importing it would draw
   the admin's colours inside a picture of the shop. So every shop-facing class below is the
   storefront's own value, written as a literal.

   WHAT IT MIRRORS, and what it does not. It is the hero's copy and CTA and the deal card's four
   facts, laid out as the storefront lays them out. It is not a pixel copy - the storefront's
   category-glyph art and its scroll choreography are not reproduced, and pretending otherwise would
   be a preview that lies about everything it cannot see. The panel is labelled as a preview for the
   same reason.

   THE TEXT IS NORMALISED BEFORE IT IS DRAWN. The server replaces a blank field with the shipped
   default and truncates to its own limits, so those are what the shop would actually show; drawing
   the raw field instead would let an operator believe they had cleared the headline when the
   default is what went live.

   THE BRAND IS A HEX, AND IT HAS TO BE KEPT IN STEP BY HAND. The shop's primary is the storefront's
   --brand-700, which the admin's own --brand-700 also carries today - but the two ladders are
   separate files that have been re-inverted independently before, and a preview whose job is to
   show the SHOP must draw the shop's colour even on the day the admin's differs. So it is written
   as the literal the storefront's own opengraph-image uses. A palette change in the storefront
   means changing these sites by hand, and the ground gradient, the glass alpha and the three ink
   steps below all moved that way on 2026-10-14 when the shop went dark. */
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
    /* The ground, drawn as the shop draws it: a radial wash from the deep forest at the top out to
       the page colour at the edges. An inline style rather than a Tailwind arbitrary value - a
       two-stop radial with colour positions is unreadable once the spaces are escaped. */
    <div className="overflow-hidden rounded-card ring-1 ring-white/10 backdrop-blur-md"
      style={{ backgroundImage: "radial-gradient(120% 90% at 50% 0%, #1a3a2a 0%, #0f172a 68%)" }}>
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#A8B1AA]">
          Preview &middot; homepage hero
        </span>
      </div>

      <div className="px-5 py-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#87BFA0]">RFO Store</p>
        <p className="mt-2 text-xl font-semibold tracking-tight text-[#F7F7F2]">{h.hero_title}</p>
        <p className="mt-2 text-xs leading-relaxed text-[#C6CEC7]">{h.hero_sub}</p>
        <span className="mt-4 inline-flex min-h-[32px] items-center rounded-full bg-[#245B45] px-4 text-xs font-semibold text-white shadow-[0_0_0_1px_rgba(62,143,108,0.45),0_10px_30px_-10px_rgba(62,143,108,0.55)]">
          {h.cta_label}
        </span>
      </div>

      {/* Both notes below are ADMIN chrome annotating the preview, not shop copy - so unlike every
          other class in this file they come from the admin's own accent tokens, which are already
          the deep-and-light pair this ground needs. */}
      {promoActive && (
        <p className="border-t border-accent-100 bg-accent-50 px-5 py-2 text-[11px] text-accent-700">
          An offer is live, so the shop shows the offer&rsquo;s name where this headline is.
        </p>
      )}

      <div className="border-t border-white/10 bg-white/5 px-5 py-5 backdrop-blur-md">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#A8B1AA]">Deal of the month</p>

        {!d && (
          <p className="mt-3 text-xs text-[#A8B1AA]">
            No deal is pinned, so the shop does not draw this section.
          </p>
        )}

        {d && (
          <>
            <div className="mt-3 flex overflow-hidden rounded-2xl bg-white/5 ring-1 ring-white/10 backdrop-blur-md">
              <Photo
                address={deal?.address ?? null}
                alt=""
                className="aspect-[4/3] w-1/2 object-cover"
                fallback={
                  <span className="flex aspect-[4/3] w-1/2 items-center justify-center bg-white/5">
                    <span className="text-lg font-bold text-[#8C968F]">{d.title.slice(0, 2).toUpperCase()}</span>
                  </span>
                }
              />
              <div className="flex w-1/2 flex-col justify-center p-3">
                <span className="inline-flex self-start rounded-full bg-[#080E1A] px-2 py-0.5 text-[10px] font-semibold text-[#E2E7E2]">
                  {d.badge}
                </span>
                <p className="mt-2 text-sm font-semibold text-[#F7F7F2]">{d.title}</p>
                <p className="mt-1 text-sm font-semibold text-[#F7F7F2]">
                  {deal?.price !== null && deal?.price !== undefined ? aud(deal.price) : "-"}
                </p>
                <span className="mt-3 inline-flex self-start rounded-full bg-[#245B45] px-3 py-1 text-[11px] font-semibold text-white">
                  View deal
                </span>
              </div>
            </div>

            {deal && !deal.live && (
              <p className="mt-3 rounded-control bg-accent-50 px-3 py-2 text-[11px] text-accent-700 ring-1 ring-accent-100">
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
