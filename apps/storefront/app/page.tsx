import { apiInternal } from "@/lib/api";
import LoadMore from "./components/LoadMore";
import DealOfMonth from "./components/DealOfMonth";
import BannerSlider from "./components/BannerSlider";
import TrustRow from "./components/TrustRow";
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
  /* The shelf is drawn from twelve so four tiles can be photographed ones - see the section below. */
  const arrivalsRaw: any[] = await apiInternal("/store/catalog?limit=12&sort=new");
  const arrivals = [...arrivalsRaw.filter((i) => i.image_url), ...arrivalsRaw.filter((i) => !i.image_url)].slice(0, 4);
  let best: any[] = [];
  try { best = await apiInternal("/store/best-sellers", 60); } catch { void 0; }
  let cats: any[] = [];
  try { cats = await apiInternal("/store/categories", 60); } catch { void 0; }
  /* Devices first, then parts and accessories - split by the shop menu's own table, which is the one
     place that decides which category is which, and stable within each half (the API returns them
     alphabetically). The count is the sum of what the catalogue reports per category, not a number
     kept here. */
  /* Still fetched for `deal_of_month` alone. The headline and CTA it also carries went with the
     hero (see below), and the promo band the homepage once read for itself came out of the layout,
     so a live offer now shows on product pages only. */
  let hero: any = { hero_title: "Renewed tech. Zero waste.",
    hero_sub: "Certified refurbished devices - serialised, graded, warehouse-tracked.", cta_label: "Shop devices" };
  try { hero = await apiInternal("/store/home-content", 60); } catch { void 0; }
  /* The banners the operator has put on the shop front, already addressed as `/media/<uuid>` by the
     API. Absent is normal: a shop with no banners simply starts at its introduction. */
  const banners: any[] = Array.isArray(hero.banners) ? hero.banners : [];
  return (
    <main>
      {/* THE BANNERS THE OPERATOR PUT ON THE SHOP FRONT, above everything else, as a slider (see
          components/BannerSlider: scroll-snap, dots, and a timer that stops the moment a shopper
          hovers, focuses or swipes). They are 2048x768 - about 8:3 - so they carry their own message
          in their own words and the page does not say anything around them: that is why the
          introduction below is one line rather than a paragraph.

          THE ADDRESSES COME FROM THE API (`/store/home-content`), which turns the media ids in the
          site setting into the shop-relative `/media/<uuid>` this page's CSP admits. Nothing here
          knows a media id, and a banner whose row has been deleted is simply not in the list. */}
      {banners.length > 0 && <BannerSlider banners={banners} />}

      {/* ONE LINE, NOT A PARAGRAPH. What the shop is, said once, under the banners: what is sold,
          and the four promises the product page makes at the point of sale. The <h1> is real and
          visible - it was `sr-only` while the page opened on the catalogue. */}
      <section className="max-w-6xl mx-auto px-4 pt-10">
        <h1 className="font-display text-h1 text-ink-900">Certified refurbished devices, graded one at a time</h1>
        <p className="mt-3 max-w-3xl text-sm text-ink-600">
          Laptops, phones, tablets, monitors, networking and the parts that keep them going - every
          unit serialised, tested and graded before it is listed.
        </p>
        {/* A BAND, NOT SMALL PRINT. These four promises were a row of grey labels under a sentence;
            on their own surface, spanning the page, they are the first thing a shopper can scan after
            the banner - which is what they are for. */}
        <TrustRow keys={["shipping", "returns", "warranty", "graded"]}
          className="mt-8 grid-cols-2 rounded-card bg-surface px-4 py-5 ring-1 ring-line sm:grid-cols-4" />
      </section>

      <DealOfMonth deal={hero.deal_of_month} />

      <section className="max-w-6xl mx-auto px-4 pt-20">
        <div className="flex items-end justify-between"><Heading level="h2">New arrivals</Heading><a href="/" className={cn("text-xs", linkClass)}>View all</a></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mt-6">
          {/* WHAT WE CAN SHOW FIRST, still newest-first within that. A third of this catalogue has no
              photograph yet (every battery, cable, bag and memory stick), and a front-page shelf of
              four tiles is the worst place to spend two of them on placeholders - so four are drawn
              from the newest twelve, photographed ones first, and the rest only if there are not four
              photographed arrivals to fill the row. Every tile is still recent; only the order inside
              the shelf changes.

              `category` IS PASSED HERE and was not before: without it every icon tile on this shelf
              drew the generic box glyph, whatever the product actually was - a Wyse thin client and a
              replacement LCD both came out as the same cube. */}
          {arrivals.map((i: any) => (
            <ProductCard key={i.slug} variant="compact" href={"/products/" + i.slug} title={i.title}
              brand={i.brand} category={i.category} slug={i.slug} imageUrl={i.image_url}
              priceCents={i.price_from_cents} />
          ))}
        </div>
      </section>
      {best.length > 0 && (
      <section className="max-w-6xl mx-auto px-4 pt-14">
        <Heading level="h2">Best sellers</Heading>
        {/* "(paid orders)" was a note about which rows the ranking reads - a fact for whoever maintains
            the query, printed at the shopper. "real customers" said the quiet part: it implies the rest
            of the shop is not real ones. */}
        <p className="text-xs text-ink-400 mt-2">The models our customers buy most.</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mt-6">
          {best.map((i: any) => (
            <ProductCard key={i.slug} variant="compact" href={"/products/" + i.slug} title={i.title}
              brand={i.brand} category={i.category} slug={i.slug} imageUrl={i.image_url}
              priceCents={i.price_from_cents} meta={i.sold + " sold"} />
          ))}
        </div>
      </section>)}

      {/* THE CATALOGUE, LAST - after the shelves that are already selling and the categories that
          index them. It used to lead the page; the flow is now banner -> what the shop is -> the range
          -> what is moving -> everything, which is the order a shopper asks those questions in.

          The heading stays ABOVE the filter bar rather than under it: the toolbar's negative margins
          exist to line its first trigger up with the heading above it (see LoadMore), so the two are
          a pair and the order inside this section is not free. */}
      <section id="shop" className="max-w-6xl mx-auto px-4 pt-14 pb-28">
        <Heading level="h2">Everything in stock</Heading>
        <LoadMore initial={catalog.items ?? []} applied={catalog.applied ?? filters}
          brands={catalog.brands ?? []} categories={cats} />
      </section>
    </main>
  );
}
