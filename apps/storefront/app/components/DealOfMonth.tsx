import { aud } from "@/lib/api";
import ProductArt from "./ProductArt";

type Deal = {
  title?: string | null;
  product_slug?: string | null;
  badge?: string | null;
  image_url?: string | null;
  price_from_cents?: number | null;
};

export default function DealOfMonth({ deal }: { deal?: Deal | null }) {
  if (!deal || !deal.product_slug) return null;
  const title = deal.title || "Deal of the month";
  return (
    <section className="max-w-6xl mx-auto px-4 pt-10">
      <h2 className="text-xl font-semibold">Deal of the month</h2>
      <a href={"/products/" + deal.product_slug}
        className="mt-4 flex flex-col md:flex-row rounded-xl ring-1 ring-emerald-200 bg-white overflow-hidden hover:ring-emerald-300 transition">
        <ProductArt slug={deal.product_slug} imageUrl={deal.image_url} alt={title} className="md:w-1/2 w-full aspect-[4/3] object-cover"
          fallback={
          <div className="md:w-1/2 w-full aspect-[4/3] bg-gradient-to-br from-emerald-50 to-emerald-100 flex items-center justify-center">
            <span className="text-2xl font-bold text-emerald-600">{title.slice(0, 2).toUpperCase()}</span>
          </div>
          } />
        <div className="p-5 md:w-1/2 flex flex-col justify-center">
          <span className="self-start bg-amber-400 text-slate-900 text-[11px] uppercase tracking-widest font-semibold rounded-full px-3 py-1">
            {deal.badge || "Deal of the Month"}
          </span>
          <p className="text-lg font-semibold mt-3">{title}</p>
          <p className="text-emerald-700 font-semibold mt-2">
            {deal.price_from_cents !== null && deal.price_from_cents !== undefined ? aud(deal.price_from_cents) : "-"}
          </p>
          <span className="self-start mt-4 bg-emerald-600 text-white rounded-xl px-5 py-2.5 font-semibold">View deal</span>
        </div>
      </a>
    </section>
  );
}
