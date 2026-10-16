import type { ReactNode } from "react";

/* A GLYPH PER CATEGORY - what a product shows when there is no photograph of it yet.

   WHY THIS EXISTS. The card's fallback used to be the first two letters of the BRAND, drawn at 20px
   inside a 4:3 grey well. On this catalogue that is one third of the shop: no photograph has been
   taken of a battery, a cable, a backpack or a stick of RAM, so the grid showed "HP", "LE", "DE",
   "TA", "KI", "SK" in 200px boxes - which reads as a page that failed to load, not as a shop. A
   letter is also the wrong FACT to draw: it names the brand, which the eyebrow above the title is
   already saying, and says nothing about the object.

   A CATEGORY GLYPH IS THE HONEST PLACEHOLDER. It is true (the category is what the catalogue
   actually stores), it is the same size and weight for every product, and it tells the shopper what
   kind of thing they are looking at before they read the title. It is also what a real shop does when
   a supplier sends a part with no photography.

   INLINE SVG RATHER THAN FILES, and keyed on the CATEGORY rather than the slug. `lib/productIcons`
   ships 60 SVG files addressed by product slug, and they were drawn for the demo catalogue - every
   one of them 404s for a product imported since. A switch on the category needs no file at build
   time, cannot 404, and follows the taxonomy the API hands us: 14 categories today, and a new one
   falls through to the neutral box rather than to a broken image.

   Drawn on a 48-unit grid at 1.5 stroke with round caps, in `currentColor`, so the caller decides
   the colour and the size and every glyph has the same optical weight as its neighbours. */
type Kind =
  | "laptop" | "phone" | "tablet" | "desktop" | "monitor" | "network" | "thin"
  | "keyboard" | "ram" | "battery" | "screen" | "bag" | "cable" | "board" | "box";

/* ORDER MATTERS: the first keyword that matches wins, so the narrower words come first. "Laptop
   Bags" contains "laptop" and is a bag; "Thin Client" is not a desktop; "Network Equipment" is not
   a cable. Matching is on letters and digits only, so "Network Equipment", "network-equipment" and
   "Network  Equipment" are one category. */
const KEYWORDS: [string, Kind][] = [
  ["bag", "bag"],
  ["cable", "cable"],
  ["battery", "battery"],
  ["ram", "ram"],
  ["memory", "ram"],
  ["motherboard", "board"],
  ["mainboard", "board"],
  ["keyboard", "keyboard"],
  ["mice", "keyboard"],
  ["mouse", "keyboard"],
  ["screen", "screen"],
  ["display", "screen"],
  ["network", "network"],
  ["router", "network"],
  ["switch", "network"],
  ["thin", "thin"],
  ["monitor", "monitor"],
  ["laptop", "laptop"],
  ["notebook", "laptop"],
  ["tablet", "tablet"],
  ["ipad", "tablet"],
  ["phone", "phone"],
  ["mobile", "phone"],
  ["desktop", "desktop"],
  ["tower", "desktop"],
  ["workstation", "desktop"],
];

/** The glyph family a category belongs to. Exported so a screen can ask without drawing. */
export function glyphKind(category?: string | null): Kind {
  const c = (category ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (c === "") return "box";
  for (const [word, kind] of KEYWORDS) if (c.includes(word)) return kind;
  return "box";
}

const SHAPES: Record<Kind, ReactNode> = {
  laptop: (<><rect x="9" y="12" width="30" height="19" rx="2" /><path d="M6 34h36M18 34h12" /></>),
  phone: (<><rect x="16" y="7" width="16" height="34" rx="3" /><path d="M22 36h4" /></>),
  tablet: (<><rect x="11" y="8" width="26" height="32" rx="3" /><path d="M22 35h4" /></>),
  desktop: (<><rect x="9" y="11" width="30" height="17" rx="2" /><path d="M24 28v7M17 35h14" /></>),
  monitor: (<><rect x="7" y="10" width="34" height="22" rx="2" /><path d="M24 32v6M16 38h16" /></>),
  network: (<><rect x="8" y="21" width="32" height="13" rx="2" /><path d="M15 34v-6M24 34v-6M33 34v-6M12 15l6-4M24 11v4M36 15l-6-4" /></>),
  thin: (<><rect x="12" y="19" width="24" height="15" rx="2" /><path d="M18 26h12M18 30h7" /></>),
  keyboard: (<><rect x="6" y="22" width="26" height="14" rx="2" /><path d="M11 28h1M16 28h1M21 28h1M26 28h1M14 32h10" /><rect x="35" y="24" width="9" height="14" rx="4" /></>),
  ram: (<><rect x="7" y="18" width="34" height="12" rx="1" /><path d="M11 30v5M17 30v5M23 30v5M29 30v5M35 30v5M12 22h24" /></>),
  battery: (<><rect x="7" y="16" width="31" height="16" rx="2" /><path d="M41 21v6M12 21v6M18 21v6M24 21v6" /></>),
  /* A BARE PANEL, WITH ITS RIBBON - not a picture frame. The first draft of this glyph was a
     rectangle with a mountain in it, which is the universal icon for "image failed to load": on the
     two replacement-screen products it made the tile look MORE broken than the letters it replaced.
     A replacement LCD is a panel with a connector hanging off its edge, and that is what this is, so
     it cannot be mistaken for the monitor (which has a stand) or for a missing picture. */
  screen: (<><rect x="9" y="8" width="30" height="22" rx="2" /><path d="M20 30v5h8v-5" /></>),
  bag: (<><path d="M13 19h22v20H13z" /><path d="M19 19v-3a5 5 0 0 1 10 0v3M13 27h22" /></>),
  cable: (<><path d="M10 20v8a7 7 0 0 0 14 0v-8" /><path d="M10 20v-6M24 20v-6" /><path d="M31 34v-8a7 7 0 0 1 7-7" /><circle cx="38" cy="19" r="2" /></>),
  board: (<><rect x="10" y="10" width="28" height="28" rx="2" /><rect x="17" y="17" width="14" height="14" rx="1" /><path d="M5 16h5M5 24h5M5 32h5M38 16h5M38 24h5M38 32h5" /></>),
  box: (<><path d="M24 7l15 8v18l-15 8-15-8V15z" /><path d="M9 15l15 8 15-8M24 23v18" /></>),
};

export default function CategoryGlyph({ category, className }: { category?: string | null; className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none" stroke="currentColor" strokeWidth={1.5}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {SHAPES[glyphKind(category)]}
    </svg>
  );
}
