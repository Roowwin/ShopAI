import { apiInternal, aud } from "@/lib/api";
import { iconFor } from "@/lib/productIcons";
import LoadMore from "./components/LoadMore";
import DealOfMonth from "./components/DealOfMonth";
import ProductArt from "./components/ProductArt";
import { Button, Card, Eyebrow, Heading } from "./components/ui";

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
      <section className="bg-gradient-to-r from-brand-700 via-brand-800 to-brand-950 text-white px-4 md:px-8 py-12">
        <div className="max-w-6xl mx-auto flex items-center gap-8">
          <div className="flex-1">
            <p className="text-eyebrow uppercase text-brand-200">RFO Store</p>
            <Heading level="display" className="mt-2">{promo ?? hero.hero_title}</Heading>
            <p className="text-brand-100 mt-2 max-w-xl">{promo ? "Sale prices below - " + hero.hero_sub : hero.hero_sub}</p>
            <Button variant="accent" href="#shop" className="mt-5">{hero.cta_label}</Button>
          </div>
          {heroArt.length > 0 && (
            <div className="hidden md:flex flex-1 items-center justify-center gap-4">
              {heroArt.map((src) => (
                <img key={src} src={src} alt="" aria-hidden="true"
                  className="w-40 lg:w-48 aspect-[4/3] object-cover rounded-card ring-1 ring-white/20 shadow-lg" />
              ))}
            </div>
          )}
        </div>
      </section>
      <DealOfMonth deal={hero.deal_of_month} />
      <section className="max-w-6xl mx-auto px-4 pt-10">
        <div className="flex items-end justify-between"><Heading level="h2">New arrivals</Heading><a href="/" className="text-xs text-brand-700">View all</a></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          {arrivals.map((i) => (
            <Card key={i.slug} radius="control" interactive href={"/products/" + i.slug} className="overflow-hidden">
              <ProductArt slug={i.slug} imageUrl={i.image_url} alt={i.title} className="w-full aspect-[4/3] object-cover"
                fallback={
                <div className="aspect-[4/3] bg-gradient-to-br from-surface-sunken to-line flex items-center justify-center">
                  <span className="text-lg font-bold text-ink-400">{(i.brand || "?").slice(0, 2).toUpperCase()}</span></div>
                } />
              <div className="p-3"><p className="font-medium truncate text-sm">{i.title}</p>
                <p className="text-sm font-semibold mt-1">{i.price_from_cents !== null ? aud(i.price_from_cents) : "-"}</p></div>
            </Card>
          ))}
        </div>
      </section>
      {best.length > 0 && (
      <section className="max-w-6xl mx-auto px-4 pt-8">
        <Heading level="h2">Best sellers</Heading>
        <p className="text-xs text-ink-400">Most purchased by real customers (paid orders).</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          {best.map((i) => (
            <Card key={i.slug} radius="control" interactive href={"/products/" + i.slug} className="p-3">
              <Eyebrow>{i.brand}</Eyebrow>
              <p className="font-medium truncate text-sm">{i.title}</p>
              <p className="text-xs text-ink-500 mt-1">{i.sold} sold</p>
            </Card>
          ))}
        </div>
      </section>)}

      <section id="shop" className="max-w-6xl mx-auto px-4 pt-10 pb-8">
        <Heading level="h2">Our products</Heading>
        <LoadMore initial={items.filter((_: any, k: number) => k >= 4)} categories={cats} />
      </section>
    </main>
  );
}
