import { apiInternal } from "@/lib/api";
import { iconFor } from "@/lib/productIcons";
import LoadMore from "./components/LoadMore";
import DealOfMonth from "./components/DealOfMonth";
import { catalogPath, Filters, parseFilters } from "./components/catalogFilters";
import { Button, cn, Eyebrow, Heading, linkClass, ProductCard } from "./components/ui";

export const revalidate = 30;

/* Where the hero's three cards sit: a fanned cluster, each with its own tilt and its own drift
   delay. Written as whole class strings rather than composed from fragments, because Tailwind
   scans source TEXT - a class assembled at runtime would never be emitted into the stylesheet. */
const HERO_SLOTS = [
  "left-0 top-10 -rotate-6",
  "left-1/2 -translate-x-1/2 top-0 z-10 rotate-2",
  "right-0 top-14 rotate-6",
];

/* The catalog's filters live in the query string, and this page is where that string is read: the
   server parses it, asks the API for that page of results, and hands the applied filter set to the
   catalog section (which writes the URL back on a chip click). Reading `searchParams` is what makes
   the route request-rendered - a pasted link has to render the filtered view in the first paint, not
   after a client-side correction - and the four other fetches on this page keep their own data
   cache, so the only live call per request is the catalog page itself. */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseFilters(await searchParams);
  let catalog: { items: any[]; applied: Filters; brands: any[] } =
    { items: [], applied: filters, brands: [] };
  try {
    catalog = await apiInternal(catalogPath(filters, { limit: 8, withFilters: true }), 0);
  } catch { void 0; }
  const items: any[] = await apiInternal("/store/catalog?limit=4&sort=new");
  const arrivals: any[] = items;
  /* Hero art: the category glyphs already shipped in public/icons, for the newest arrivals.
     No product photos exist, so this degrades to text-only when nothing matches. */
  const heroArt = arrivals.map((i) => iconFor(i.slug)).filter((s): s is string => Boolean(s)).slice(0, 3);
  let best: any[] = [];
  try { best = await apiInternal("/store/best-sellers", 60); } catch { void 0; }
  let cats: any[] = [];
  try { cats = await apiInternal("/store/categories", 60); } catch { void 0; }
  let hero: any = { hero_title: "Renewed tech. Zero waste.",
    hero_sub: "Certified refurbished devices - serialised, graded, warehouse-tracked.", cta_label: "Shop devices" };
  try { hero = await apiInternal("/store/home-content", 60); } catch { void 0; }
  let promo: string | null = null;
  try {
    const p: any[] = await apiInternal("/store/promotions", 60);
    if (p.length) { promo = p[0].name + (p[0].kind === "percent" ? " - " + p[0].value + "% off" : ""); }
  } catch { void 0; }
  return (
    <main>
      {/* THE HERO. Minimal text, a lot of air, and the device cards floating off the centre line.
          The headline is the only near-white thing at display size and the CTA is the only solid
          brand fill on the page - everything else is glass and hairlines, which is what makes one
          button read as THE action.

          The three cards are the category glyphs already shipped in public/icons, fanned and
          offset so they read as floating rather than as a row. They are decorative (`alt=""`,
          aria-hidden): the headline beside them is the content, and three unlabelled glyphs would
          only be noise to a screen reader. With no glyphs to show the column collapses and the
          text takes the full width - text-only, never a broken grid. */}
      <section className="px-4 md:px-8 pt-20 pb-16 md:pt-28 md:pb-24">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center gap-14 md:gap-20">
          <div className="flex-1 text-center md:text-left">
            <Eyebrow tone="brand">RFO Store</Eyebrow>
            <Heading level="display" className="mt-5">{promo ?? hero.hero_title}</Heading>
            <p className="text-lead text-ink-500 mt-5 max-w-xl mx-auto md:mx-0">{promo ? "Sale prices below - " + hero.hero_sub : hero.hero_sub}</p>
            <div className="relative mt-10 inline-flex items-center">
              {/* Two layers of bloom behind the button, both `pointer-events-none` so they cannot
                  steal the click: a wide soft wash and the button's own tight glow ring. */}
              <span aria-hidden="true" className="pointer-events-none absolute -inset-x-16 -inset-y-10 rounded-full bg-brand-500/25 blur-3xl" />
              <Button variant="primary" href="#shop" className="relative shadow-glow px-8 text-sm">{hero.cta_label}</Button>
            </div>
          </div>
          {heroArt.length > 0 && (
            <div className="hidden md:block flex-1 relative h-80" aria-hidden="true">
              {heroArt.map((src, i) => (
                /* The rotation lives on the wrapper and the drift on the image, because both want
                   the `transform` property and an animation would otherwise overwrite the tilt.
                   The key carries the index: `iconFor` maps many slugs to one glyph, so two
                   arrivals of the same category return the SAME src string and a key of `src`
                   alone would collide. */
                <div key={src + "-" + i} className={cn("absolute w-44 lg:w-52", HERO_SLOTS[i] ?? HERO_SLOTS[0])}>
                  <img src={src} alt=""
                    style={{ animationDelay: (i * 900) + "ms" }}
                    className="hero-float w-full aspect-[4/3] object-cover rounded-card bg-surface-glass/5 ring-1 ring-brand-500/20 shadow-glow-sm" />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
      <DealOfMonth deal={hero.deal_of_month} />
      <section className="max-w-6xl mx-auto px-4 pt-16">
        <div className="flex items-end justify-between"><Heading level="h2">New arrivals</Heading><a href="/" className={cn("text-xs", linkClass)}>View all</a></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-6">
          {arrivals.map((i) => (
            <ProductCard key={i.slug} variant="compact" href={"/products/" + i.slug} title={i.title}
              brand={i.brand} slug={i.slug} imageUrl={i.image_url} priceCents={i.price_from_cents} />
          ))}
        </div>
      </section>
      {best.length > 0 && (
      <section className="max-w-6xl mx-auto px-4 pt-14">
        <Heading level="h2">Best sellers</Heading>
        <p className="text-xs text-ink-400 mt-2">Most purchased by real customers (paid orders).</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-6">
          {best.map((i) => (
            <ProductCard key={i.slug} variant="compact" href={"/products/" + i.slug} title={i.title}
              brand={i.brand} slug={i.slug} priceCents={i.price_from_cents} meta={i.sold + " sold"} />
          ))}
        </div>
      </section>)}

      {/* pt-12, not pt-16: the gap above "Our products" closes onto the best-sellers grid, which is
          the pairing a shopper reads as one shelf ("everything else"), while the gaps between the
          page's other sections keep their own rhythm. 48px against the 64px it was. */}
      <section id="shop" className="max-w-6xl mx-auto px-4 pt-12 pb-20">
        <Heading level="h2">Our products</Heading>
        <LoadMore initial={catalog.items ?? []} applied={catalog.applied ?? filters}
          brands={catalog.brands ?? []} categories={cats} />
      </section>
    </main>
  );
}
