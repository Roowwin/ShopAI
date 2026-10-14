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
    <section className="max-w-6xl mx-auto px-4 pt-20">
      <Heading level="h2">Deal of the month</Heading>
      <Card interactive href={"/products/" + deal.product_slug} className="mt-6 flex flex-col md:flex-row overflow-hidden">
        <ProductArt slug={deal.product_slug} imageUrl={deal.image_url} alt={title} className="md:w-1/2 w-full aspect-[4/3] object-cover"
          fallback={
          <div className="md:w-1/2 w-full aspect-[4/3] bg-surface-sunken flex items-center justify-center">
            <span className="text-2xl font-bold text-ink-400">{title.slice(0, 2).toUpperCase()}</span>
          </div>
          } />
        <div className="p-8 md:w-1/2 flex flex-col justify-center">
          {/* a sale chip, not a colour - a NEUTRAL fill keeps the emerald for the CTA below.
              It said `surface-deep` for that reason, and `surface-deep` used to BE the neutral dark;
              on this ground it is a soft green, so the chip was quietly competing with the button it
              is supposed to leave room for. `surface-sunken` is the neutral step now. */}
          <Badge colorClass="bg-surface-sunken text-ink-700" className="self-start">
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
