/* Category-glyph art shipped with the demo catalog: one file per product at public/icons/<slug>.svg,
   800x600 - exactly the card's 4:3 box. ProductArt falls back to it when a product has no image_url,
   so a card with no photo shows device art instead of a bare tile.

   Two things to note when adding art:
   - the file is named after the PRODUCT SLUG (seed-demo-ipad-air4.svg), not the seeder's catalog code
     (ipadair4) - three files arrived hyphen-stripped and two were renamed to match their slug;
   - add the slug here as well. This list is what keeps a card from pointing at a file that is not
     there: a missing icon renders as a broken image, which is worse than the initials tile it
     replaces. So the list is the contract, and it doubles as the answer to "which products have art". */
export const ICON_SLUGS = [
  "galaxy-s21",
  "iphone-12",
  "iphone-13",
  "seed-demo-gb2",
  "seed-demo-gs20",
  "seed-demo-gs21",
  "seed-demo-ip12",
  "seed-demo-ip13",
  "seed-demo-ipad-air4",
  "seed-demo-mba-m1",
  "seed-demo-mbp13",
  "seed-demo-tabs7",
];

const HAVE = new Set(ICON_SLUGS);

export function iconFor(slug?: string | null): string | null {
  return slug && HAVE.has(slug) ? "/icons/" + slug + ".svg" : null;
}
