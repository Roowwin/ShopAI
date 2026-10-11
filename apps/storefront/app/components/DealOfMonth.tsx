import { aud } from "@/lib/api";
import ProductArt from "./ProductArt";
import { Badge, Button, Card, Heading } from "./ui";

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
    <section className="max-w-6xl mx-auto px-4 pt-16">
      <Heading level="h2">Deal of the month</Heading>
      <Card interactive href={"/products/" + deal.product_slug} className="mt-6 flex flex-col md:flex-row overflow-hidden">
        <ProductArt slug={deal.product_slug} imageUrl={deal.image_url} alt={title} className="md:w-1/2 w-full aspect-[4/3] object-cover"
          fallback={
          <div className="md:w-1/2 w-full aspect-[4/3] bg-gradient-to-br from-surface-sunken to-line flex items-center justify-center">
            <span className="text-2xl font-bold text-ink-400">{title.slice(0, 2).toUpperCase()}</span>
          </div>
          } />
        <div className="p-8 md:w-1/2 flex flex-col justify-center">
          {/* a sale chip, not a colour - the neutral dark keeps emerald for the CTA below */}
          <Badge colorClass="bg-ink-900 text-white" className="self-start">
            {deal.badge || "Deal of the Month"}
          </Badge>
          <Heading level="h2" as="p" className="mt-4">{title}</Heading>
          <p className="text-ink-900 font-semibold mt-3">
            {deal.price_from_cents !== null && deal.price_from_cents !== undefined ? aud(deal.price_from_cents) : "-"}
          </p>
          <Button as="span" variant="primary" className="self-start mt-6">View deal</Button>
        </div>
      </Card>
    </section>
  );
}
