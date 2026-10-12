import { aud } from "@/lib/api";
import ProductArt from "../ProductArt";
import Badge from "./Badge";
import Button from "./Button";
import Card from "./Card";
import Eyebrow from "./Eyebrow";
import { cn } from "./cn";

/* One product tile, three shapes. This replaces six hand-written card markups that had drifted:
   some showed art, some did not; some showed a price, some did not; and the related-products tile
   called aud() unguarded, so a null price rendered as "$0.00".

   - full    catalog tile: art, eco badge, brand-category eyebrow, price, muted stock pill, and the
             card's one action - the name stretched over the whole tile, "View product" at the foot
   - compact art + title + price (home arrivals, best sellers)
   - text    brand eyebrow + title + price, no art (search results, related products)

   Two copy rules apply to all three shapes, both driven by what the catalogue actually stores:

   The titles carry a leading "Refurbished " (56 of 57 do) and this shop sells nothing else, so on a
   card the word is noise - the header already says certified refurbished. It is stripped AT RENDER
   and never in the data: the product page's h1, the OG text and the titles already sitting in a
   shopper's cart keep the stored wording, which is deliberate and not an oversight to "fix".

   The brand repeats itself when the title already opens with it ("ASUS ZenBook 14 UX425", brand
   ASUS): 41 of 57 today. But 16 do not - 4 Samsung, 7 Apple and 5 Lenovo, so most Samsung titles and
   every Apple and Lenovo one (a fifth Samsung title does start with its brand, and correctly loses it
   from the eyebrow) - and for those 16 the eyebrow is the only place the brand is said. So the rule is
   conditional rather than a blanket "category only", which would delete the brand from those cards. */
type Stock = { n: number; label?: string };

type Props = {
  href: string;
  title: string;
  brand?: string | null;
  category?: string | null;
  slug?: string | null;
  imageUrl?: string | null;
  priceCents?: number | null;
  stock?: Stock | null;
  meta?: string | null;
  variant?: "full" | "compact" | "text";
};

/* The title as a card should read it: without the leading "Refurbished ". */
function cardTitle(title: string): string {
  return title.replace(/^refurbished\s+/i, "");
}

/* The eyebrow, minus any brand the title has already said. Returns "" when there is nothing left to
   say, and the callers drop the element rather than rendering an empty line. */
function eyebrowFor(title: string, brand?: string | null, category?: string | null): string {
  const name = cardTitle(title);
  const b = (brand ?? "").trim();
  const c = (category ?? "").trim();
  if (b !== "" && name.toLowerCase().startsWith(b.toLowerCase())) { return c; }
  return b && c ? b + " - " + c : b || c;
}

/* The one place a price is formatted. null/undefined means "no listed units", shown as "-" -
   never "$0.00". */
function price(cents: number | null | undefined) {
  return cents !== null && cents !== undefined ? aud(cents) : "-";
}

function Initials({ brand, large }: { brand?: string | null; large?: boolean }) {
  return (
    <div className="aspect-[4/3] bg-gradient-to-br from-surface-sunken to-line flex items-center justify-center">
      <span className={(large ? "text-xl" : "text-lg") + " font-bold text-ink-400"}>
        {(brand || "?").slice(0, 2).toUpperCase()}
      </span>
    </div>
  );
}

/* Small and quiet: the count is information, not the card's action, and the card already has the
   one control that competes for the eye. A live count and a zero one share the tint and are told
   apart by their own wording. */
function StockPill({ stock }: { stock: Stock }) {
  return (
    <Badge colorClass="bg-surface-sunken text-ink-500">
      {stock.n} {stock.label ?? "in stock"}
    </Badge>
  );
}

export default function ProductCard({ href, title, brand, category, slug, imageUrl, priceCents, stock, meta, variant = "text" }: Props) {
  const name = cardTitle(title);
  // Two lines, not one: the catalog tile's eyebrow names the category, the text tile's never has -
  // it is a brand line alone, and the shared rule only decides whether the brand is worth saying.
  const brandLine = eyebrowFor(title, brand);
  const eyebrowLine = eyebrowFor(title, brand, category);

  if (variant === "full") {
    return (
      /* No `href` on the Card, so it renders a div: the tile holds TWO controls (the name and the
         CTA) and a link wrapped around both would be invalid HTML. The Card's `interactive` shell
         still gives the tile its hover lift; its own focus ring can no longer fire on a div, which
         is why the overlay below carries the ring instead. */
      <Card interactive className="relative overflow-hidden">
        <div className="relative">
          <ProductArt slug={slug} imageUrl={imageUrl} alt={name} className="w-full aspect-[4/3] object-cover"
            fallback={<Initials brand={brand} large />} />
          {!imageUrl && <Badge colorClass="bg-brand-700 text-white" className="absolute top-3 right-3">Eco choice</Badge>}
        </div>
        <div className="p-5">
          {eyebrowLine && <Eyebrow>{eyebrowLine}</Eyebrow>}
          {/* THE card's link. Stretched over the whole tile, so the art, the price row and the
              whitespace around the text are all part of the same target, and the focus ring is drawn
              on that overlay rather than around four words. Its accessible name is the product.
              The ring is INSET: the overlay is a descendant of the card, and the card's own
              overflow-hidden clips a descendant's ring, so an outset one would never be seen - and the
              overlay carries the card's own radius so the ring traces the rounded corners instead of
              being squared off by them. */}
          <a href={href}
            className={cn(
              "font-medium mt-2 block truncate rounded-control",
              "after:absolute after:inset-0 after:rounded-2xl after:content-['']",
              "focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-brand-700 focus-visible:after:ring-inset",
            )}>
            {name}
          </a>
          <div className="mt-3 flex items-center justify-between">
            <span className="font-semibold text-sm">{price(priceCents)}</span>
            {stock && <StockPill stock={stock} />}
          </div>
          {/* Above the overlay (z-10), so it stays a control of its own: hover, keyboard and
              middle-click all behave like a button rather than being swallowed by the tile link.
              Secondary, not primary: a grid of tiles puts one CTA per card on screen, and the design
              system spends emerald on the page's one real action - see Button.tsx's own comment. */}
          <Button variant="secondary" href={href} className="relative z-10 mt-3 w-full">View product</Button>
        </div>
      </Card>
    );
  }

  if (variant === "compact") {
    return (
      <Card interactive href={href} className="overflow-hidden">
        <ProductArt slug={slug} imageUrl={imageUrl} alt={name} className="w-full aspect-[4/3] object-cover"
          fallback={<Initials brand={brand} />} />
        <div className="p-5">
          <p className="font-medium truncate text-sm">{name}</p>
          <p className="text-sm font-semibold mt-2">{price(priceCents)}</p>
          {meta && <p className="text-xs text-ink-500 mt-1">{meta}</p>}
        </div>
      </Card>
    );
  }

  return (
    <Card interactive href={href} className="p-5">
      {brandLine && <Eyebrow>{brandLine}</Eyebrow>}
      <p className="font-medium mt-2 truncate">{name}</p>
      <div className="mt-3 flex items-center justify-between">
        <span className="font-semibold text-sm">{price(priceCents)}</span>
        {stock ? <StockPill stock={stock} /> : meta ? <span className="text-xs text-ink-500">{meta}</span> : null}
      </div>
    </Card>
  );
}
