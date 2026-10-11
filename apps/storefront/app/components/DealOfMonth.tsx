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
    <section className="max-w-6xl mx-auto px-4 pt-10">
      <Heading level="h2">Deal of the month</Heading>
      <Card radius="control" interactive href={"/products/" + deal.product_slug} className="mt-4 flex flex-col md:flex-row overflow-hidden">
        <ProductArt slug={deal.product_slug} imageUrl={deal.image_url} alt={title} className="md:w-1/2 w-full aspect-[4/3] object-cover"
          fallback={
          <div className="md:w-1/2 w-full aspect-[4/3] bg-gradient-to-br from-brand-50 to-brand-100 flex items-center justify-center">
            <span className="text-2xl font-bold text-brand-700">{title.slice(0, 2).toUpperCase()}</span>
          </div>
          } />
        <div className="p-5 md:w-1/2 flex flex-col justify-center">
          <Badge colorClass="bg-accent-400 text-ink-900" className="self-start">
            {deal.badge || "Deal of the Month"}
          </Badge>
          <Heading level="h2" as="p" className="mt-3">{title}</Heading>
          <p className="text-brand-700 font-semibold mt-2">
            {deal.price_from_cents !== null && deal.price_from_cents !== undefined ? aud(deal.price_from_cents) : "-"}
          </p>
          <Button as="span" variant="primary" className="self-start mt-4">View deal</Button>
        </div>
      </Card>
    </section>
  );
}
