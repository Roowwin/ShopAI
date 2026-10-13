import { apiInternal } from "@/lib/api";
import LoadMore from "./components/LoadMore";
import DealOfMonth from "./components/DealOfMonth";
import { catalogPath, Filters, parseFilters } from "./components/catalogFilters";
import { cn, Heading, linkClass, ProductCard } from "./components/ui";

export const revalidate = 30;

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
  let best: any[] = [];
  try { best = await apiInternal("/store/best-sellers", 60); } catch { void 0; }
  let cats: any[] = [];
  try { cats = await apiInternal("/store/categories", 60); } catch { void 0; }
  /* Still fetched for `deal_of_month` alone - the headline and CTA it also carries went with the
     hero (see below), and the shop's live offer reaches the page through the layout's promo band. */
  let hero: any = { hero_title: "Renewed tech. Zero waste.",
    hero_sub: "Certified refurbished devices - serialised, graded, warehouse-tracked.", cta_label: "Shop devices" };
  try { hero = await apiInternal("/store/home-content", 60); } catch { void 0; }
  return (
    <main>
      {/* THE HERO IS REMOVED, and the page now opens on the deal (or, with no deal pinned, on the
          first shelf). Everything the hero carried still exists elsewhere: the offer runs as the
          promo band in the layout, the products it previewed are the shelves below, and the CMS
          headline it showed can be reached from /admin/cms.

          Removing an element removes the page's only <h1> with it, so one stays - the shop's own
          name, which the header wordmark already carries, not new copy. A page with no top-level
          heading loses its place in the document outline for anyone navigating by headings, and
          that is a screen-reader problem rather than a visual one, which is why this one is
          `sr-only`. The first visible heading below is "New arrivals". */}
      <h1 className="sr-only">RFO Store - certified refurbished devices</h1>
      {/* THE CATALOGUE LEADS. It used to be the last section on the page, under New arrivals and
          the best sellers, with the filter bar at the very bottom - so the shop's actual controls
          sat below three shelves, and a filter pick changed a grid the shopper had to scroll back
          to. The bar and the grid it drives are now the first thing under the header, and the
          curated shelves follow.

          The heading stays ABOVE the bar rather than under it: the toolbar's negative margins exist
          to line its first trigger up with the heading above it (see LoadMore), so the two are a
          pair and the order inside this section is not free. */}
      <section id="shop" className="max-w-6xl mx-auto px-4 pt-16 pb-20">
        <Heading level="h2">Our products</Heading>
        <LoadMore initial={catalog.items ?? []} applied={catalog.applied ?? filters}
          brands={catalog.brands ?? []} categories={cats} />
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
      <section className="max-w-6xl mx-auto px-4 pt-14 pb-20">
        <Heading level="h2">Best sellers</Heading>
        <p className="text-xs text-ink-400 mt-2">Most purchased by real customers (paid orders).</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-6">
          {best.map((i) => (
            <ProductCard key={i.slug} variant="compact" href={"/products/" + i.slug} title={i.title}
              brand={i.brand} slug={i.slug} priceCents={i.price_from_cents} meta={i.sold + " sold"} />
          ))}
        </div>
      </section>)}
    </main>
  );
}
