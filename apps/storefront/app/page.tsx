import { apiInternal } from "@/lib/api";
import { iconFor } from "@/lib/productIcons";
import LoadMore from "./components/LoadMore";
import DealOfMonth from "./components/DealOfMonth";
import { Button, cn, Eyebrow, Heading, linkClass, ProductCard } from "./components/ui";

export const revalidate = 30;

export default async function Home() {
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
      {/* No emerald block. The hero is the warm page ground with a lot of air, the headline in
          the display face, and a single soft emerald bloom behind the CTA cluster - the only
          chromatic element in the section. It wraps to a column on phones. */}
      <section className="px-4 md:px-8 py-16 md:py-24">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center gap-12 md:gap-16">
          <div className="flex-1">
            <Eyebrow tone="brand">RFO Store</Eyebrow>
            <Heading level="display" className="mt-4">{promo ?? hero.hero_title}</Heading>
            <p className="text-lead text-ink-600 mt-5 max-w-xl">{promo ? "Sale prices below - " + hero.hero_sub : hero.hero_sub}</p>
            <div className="relative mt-9 inline-flex items-center">
              <span aria-hidden="true" className="pointer-events-none absolute -inset-x-12 -inset-y-8 rounded-full bg-gradient-to-r from-brand-300/45 via-brand-200/25 to-transparent blur-2xl" />
              <Button variant="primary" href="#shop" className="relative">{hero.cta_label}</Button>
            </div>
          </div>
          {heroArt.length > 0 && (
            <div className="hidden md:flex flex-1 items-center justify-center gap-5">
              {heroArt.map((src) => (
                <img key={src} src={src} alt="" aria-hidden="true"
                  className="w-40 lg:w-48 aspect-[4/3] object-cover rounded-2xl ring-1 ring-line shadow-sm" />
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

      <section id="shop" className="max-w-6xl mx-auto px-4 pt-16 pb-20">
        <Heading level="h2">Our products</Heading>
        <LoadMore initial={items.filter((_: any, k: number) => k >= 4)} categories={cats} />
      </section>
    </main>
  );
}
