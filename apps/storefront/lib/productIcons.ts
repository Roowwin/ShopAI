/* Category-glyph art shipped with the demo catalog: one file per product at public/icons/<slug>.svg,
   800x600 - exactly the card's 4:3 box. ProductArt falls back to it when a product has no image_url,
   so a card with no photo shows device art instead of a bare tile.

   Two things to note when adding art:
   - the file is named after the PRODUCT SLUG (seed-demo-ipad-air4.svg), not the seeder's catalog code
     (ipadair4) - three files arrived hyphen-stripped and two were renamed to match their slug;
   - add the slug here as well. This list is what keeps a card from pointing at a file that is not
     there: a missing icon renders as a broken image, which is worse than the initials tile it
     replaces. So the list is the contract, and it doubles as the answer to "which products have art".

   THE LIST HAD FALLEN 48 SLUGS BEHIND THE DIRECTORY. It named 12 while public/icons held 60, so
   every product in the other 48 showed the initials tile with its device art sitting unused on
   disk - and the hero, which draws only what it can render, silently came up empty on a catalogue
   where 55 of 100 products carry real photography. Kept sorted, and regenerated from the directory
   rather than by hand:

     ls public/icons/*.svg | xargs -n1 basename | sed 's/\.svg$//' | sort

   Anything added to the directory must land here in the same commit, or the card that needed it
   keeps falling back. */
export const ICON_SLUGS = [
  "galaxy-s21",
  "iphone-12",
  "iphone-13",
  "seed-demo-27ul500",
  "seed-demo-a400-480",
  "seed-demo-ax55",
  "seed-demo-barracuda-2tb",
  "seed-demo-c920",
  "seed-demo-cbs350-24",
  "seed-demo-e24-g4",
  "seed-demo-ed-800-g6",
  "seed-demo-elite-840",
  "seed-demo-gb2",
  "seed-demo-gs20",
  "seed-demo-gs21",
  "seed-demo-gs308",
  "seed-demo-i3-10100",
  "seed-demo-i5-10400",
  "seed-demo-i7-10700",
  "seed-demo-ip12",
  "seed-demo-ip13",
  "seed-demo-ipad-air4",
  "seed-demo-k380",
  "seed-demo-kc3000-1tb",
  "seed-demo-kf-32gb",
  "seed-demo-kvr-16gb",
  "seed-demo-lat-5420",
  "seed-demo-m720",
  "seed-demo-mac-mini-m1",
  "seed-demo-mba-m1",
  "seed-demo-mba-m2",
  "seed-demo-mbp13",
  "seed-demo-mx-keys-mini",
  "seed-demo-mx-master-3s",
  "seed-demo-opt-3070",
  "seed-demo-opt-7080",
  "seed-demo-p2219h",
  "seed-demo-pa248qv",
  "seed-demo-pn50",
  "seed-demo-r5-5600x",
  "seed-demo-r7-5800x",
  "seed-demo-r9-5900x",
  "seed-demo-sg110-16",
  "seed-demo-sg250-08",
  "seed-demo-tab-s7",
  "seed-demo-tabs7",
  "seed-demo-tb4-dock",
  "seed-demo-tc-m720q",
  "seed-demo-tl-sg108",
  "seed-demo-tp-batt-52",
  "seed-demo-tp-t14",
  "seed-demo-tp-x1c9",
  "seed-demo-u2419h",
  "seed-demo-u2720q",
  "seed-demo-uh-323",
  "seed-demo-usbc-g5",
  "seed-demo-wd19s",
  "seed-demo-xps13",
  "seed-demo-zen-14",
  "seed-demo-zone-300",
];

const HAVE = new Set(ICON_SLUGS);

export function iconFor(slug?: string | null): string | null {
  return slug && HAVE.has(slug) ? "/icons/" + slug + ".svg" : null;
}
