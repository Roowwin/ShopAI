/* THE STOREFRONT, SEEN FROM THE ADMIN.

   Two jobs that both need the shop's own origin rather than the admin's:

   1. A product photo is a plain address (`products.image_url`) with no credential in front of it -
      that is the whole point of it, and the storefront renders it with a bare image tag. An admin
      page sitting on `admin.rfo.localhost` therefore cannot resolve the catalogue's root-relative
      addresses (`/icons/dell-monitors.svg`) on its own: pointed at the admin origin they 404 and
      every model tile draws its "no photo" placeholder. Resolving them against the shop's origin is
      what makes the CMS show the SAME picture the shopper sees.

   2. "Live on the storefront" has to be a link an operator can follow.

   The origin defaults to the compose file's own value so a dev box needs no setup; the build reads
   NEXT_PUBLIC_SITE_URL at bundle time, exactly as the storefront's own env does. */
export const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://shop.rfo.localhost").replace(/\/+$/, "");

/** An absolute address as written, a shop-relative one resolved against the shop. */
export function storefrontUrl(address: string | null | undefined): string | null {
  if (!address) return null;
  if (/^(https?:)?\/\//i.test(address) || address.startsWith("data:")) { return address; }
  return SITE + (address.startsWith("/") ? address : "/" + address);
}

export function storefrontPage(slug: string): string {
  return SITE + "/products/" + slug;
}

/* ---------------------------------------------------------------------------
   A MODEL, WHICH IS WHAT THE CMS NOW EDITS.

   The catalogue's content lives on the PARENT product: the photo, the title and the featured flag
   are all rows on `products`, and a unit (an asset) inherits every one of them. So a product row is
   already "one entry for all the assets of that model" - except that one model can be several
   products. The seeded catalogue carries both `iphone-13` and `seed-demo-ip13` for "Refurbished
   iPhone 13", and the pytest sweep leaves hundreds more.

   Folding them is what the brief asks for and what the write door expects: one entry, one press,
   every product that shares the model updated. The fold key is brand AND model, because "iPhone 13"
   under Apple and under an accessory brand are two different things.
   --------------------------------------------------------------------------- */
export type CProd = {
  id: number;
  title: string;
  slug: string;
  model: string;
  status: string;
  brand: string;
  category: string;
  image_url: string | null;
  featured: boolean;
  listed_units: number;
  /** The storefront's own publishable predicate: listed AND in an active lot. */
  live_units: number;
  price_from_cents: number | null;
};

export type Model = {
  key: string;
  brand: string;
  model: string;
  products: CProd[];
  /** Usually one; a model filed under two categories names both rather than hiding one. */
  categories: string[];
  units: number;
  live: number;
  price: number | null;
  /** The switch reads ON only when EVERY product in the group is featured - see the note in page.tsx. */
  featured: boolean;
  /** Members disagree on the flag, or on which photo the model shows. Both are surfaced, not smoothed. */
  mixedFeatured: boolean;
  mixedPhoto: boolean;
  /** The one address the group agrees on, for the tile. Null when no member has a photo. */
  address: string | null;
};

function finish(key: string, brand: string, model: string, products: CProd[]): Model {
  const addresses = products.map((p) => p.image_url).filter((a): a is string => Boolean(a));
  const prices = products.map((p) => p.price_from_cents).filter((c): c is number => c !== null);
  const featuredCount = products.filter((p) => p.featured).length;
  return {
    key, brand, model, products,
    categories: [...new Set(products.map((p) => p.category))].sort(),
    units: products.reduce((n, p) => n + p.listed_units, 0),
    live: products.reduce((n, p) => n + p.live_units, 0),
    price: prices.length ? Math.min(...prices) : null,
    featured: featuredCount === products.length,
    mixedFeatured: featuredCount > 0 && featuredCount < products.length,
    mixedPhoto: new Set(addresses).size > 1,
    address: addresses[0] ?? null,
  };
}

export function groupModels(prods: CProd[]): Model[] {
  const byKey = new Map<string, CProd[]>();
  for (const p of prods) {
    const key = p.brand + "\u0000" + p.model;
    const bucket = byKey.get(key);
    if (bucket) { bucket.push(p); } else { byKey.set(key, [p]); }
  }
  const out: Model[] = [];
  for (const [key, products] of byKey) {
    out.push(finish(key, products[0].brand, products[0].model, products));
  }
  // Featured first (that is the catalogue's own order), then by what a person is looking for.
  return out.sort((a, b) =>
    Number(b.featured) - Number(a.featured) ||
    a.brand.localeCompare(b.brand) ||
    a.model.localeCompare(b.model));
}

/** One line naming a group: "Apple iPhone 13", "Kingston Pytest filter device". */
export function modelName(m: Model): string {
  return m.model.toLowerCase().startsWith(m.brand.toLowerCase())
    ? m.model
    : m.brand + " " + m.model;
}
