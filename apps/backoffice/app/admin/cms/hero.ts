/* The homepage draft, as the CMS stores it.

   THIS FILE USED TO ALSO DRAW THE HERO. It held a `HeroPreview` component that rendered the shop's
   hero and deal card beside the editor, on the storefront's dark ground, redrawn on every
   keystroke. The storefront no longer renders a hero, so the preview went with it - what is left
   is the SHAPE of the draft, and this file is named for that rather than for a picture that is no
   longer drawn.

   The hero's own three fields are still part of the payload even though nothing edits or shows
   them any more. They ride in the SAME object as `deal_of_month`, and the whole object is what
   `PUT /staff/cms/home` receives - so dropping them here would mean the deal could not be saved
   without inventing a second endpoint. The CMS loads them and writes them back untouched.

   `heroAsPublished` is what stops the auto-save firing for a keystroke that cannot change the
   shop. It normalises a draft into the bytes the server would store - blank fields become the
   shipped defaults, each field is truncated to its limit - and the editor compares two of those.
   That is why the hero fields still appear below despite being uneditable: they are part of what
   "would these two drafts publish the same thing" has to compare. */
export type Deal = { title: string; product_slug: string; badge: string };
export type Hero = { hero_title: string; hero_sub: string; cta_label: string; deal_of_month?: Deal | null };

/* The shipped copy, mirroring staff_ops.HOME_DEFAULTS. A default lives in exactly one place per
   app, and this is the admin's. */
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
