import { aud } from "@/lib/api";
import ProductArt from "../ProductArt";
import Badge from "./Badge";
import Card from "./Card";
import Eyebrow from "./Eyebrow";

/* One product tile, three shapes. This replaces six hand-written card markups that had drifted:
   some showed art, some did not; some showed a price, some did not; and the related-products tile
   called aud() unguarded, so a null price rendered as "$0.00".

   - full    catalog tile: art, eco badge, brand-category eyebrow, price, stock pill, hover cue
   - compact art + title + price (home arrivals, best sellers)
   - text    brand eyebrow + title + price, no art (search results, related products) */
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

function StockPill({ stock }: { stock: Stock }) {
  return (
    <Badge colorClass={stock.n > 0 ? "bg-brand-50 text-brand-700" : "bg-surface-sunken text-ink-500"}>
      {stock.n} {stock.label ?? "in stock"}
    </Badge>
  );
}

export default function ProductCard({ href, title, brand, category, slug, imageUrl, priceCents, stock, meta, variant = "text" }: Props) {
  if (variant === "full") {
    return (
      <Card radius="control" interactive href={href} className="group overflow-hidden">
        <div className="relative">
          <ProductArt slug={slug} imageUrl={imageUrl} alt={title} className="w-full aspect-[4/3] object-cover"
            fallback={<Initials brand={brand} large />} />
          {!imageUrl && <Badge colorClass="bg-brand-700 text-white" className="absolute top-2 right-2">Eco choice</Badge>}
        </div>
        <div className="p-3">
          <Eyebrow>{brand} - {category}</Eyebrow>
          <p className="font-medium mt-1 truncate">{title}</p>
          <div className="mt-2 flex items-center justify-between">
            <span className="font-semibold text-sm">{price(priceCents)}</span>
            {stock && <StockPill stock={stock} />}
          </div>
          <p className="text-xs text-brand-700 mt-2.5 opacity-0 group-hover:opacity-100 transition">View product</p>
        </div>
      </Card>
    );
  }

  if (variant === "compact") {
    return (
      <Card radius="control" interactive href={href} className="overflow-hidden">
        <ProductArt slug={slug} imageUrl={imageUrl} alt={title} className="w-full aspect-[4/3] object-cover"
          fallback={<Initials brand={brand} />} />
        <div className="p-3">
          <p className="font-medium truncate text-sm">{title}</p>
          <p className="text-sm font-semibold mt-1">{price(priceCents)}</p>
          {meta && <p className="text-xs text-ink-500 mt-1">{meta}</p>}
        </div>
      </Card>
    );
  }

  return (
    <Card radius="control" interactive href={href} className="p-4">
      <Eyebrow>{brand}</Eyebrow>
      <p className="font-medium mt-1 truncate">{title}</p>
      <div className="mt-2 flex items-center justify-between">
        <span className="font-semibold text-sm">{price(priceCents)}</span>
        {stock ? <StockPill stock={stock} /> : meta ? <span className="text-xs text-ink-500">{meta}</span> : null}
      </div>
    </Card>
  );
}
