import { Stat } from "@/app/components/ui";
import { aud } from "@/lib/format";

/* The dashboard's headline numbers, as one grid of Stat tiles.

   Money is formatted by lib/format.ts's `aud`, not by a local copy: the ops pages need the same
   currency format, and J5's module-local definition existed only because lib/ was outside that
   job's surfaces. One formatter, imported by every money figure in the app.
   Props are the API's own sub-objects, so this file needs no type shared with the page. */

type Props = {
  inventory: { total_units: number };
  stockValue: { at_cost_cents: number; at_list_cents: number; listed_units: number; cost_known_units: number };
  reservations: { active: number; expiring_24h: number };
  orders: { orders_30d: number; revenue_paid_cents_30d: number; aov_cents: number };
  newsletter: { total: number };
};

export default function StatRow({ inventory, stockValue, reservations, orders, newsletter }: Props) {
  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Units listed" value={stockValue.listed_units}
            sub={`of ${inventory.total_units} units on hand`} />
      <Stat label="Stock value at cost" value={aud(stockValue.at_cost_cents)}
            sub={`${stockValue.cost_known_units} units with a cost`} />
      <Stat label="Stock value at list" value={aud(stockValue.at_list_cents)}
            sub={`${stockValue.listed_units} units priced`} />
      <Stat label="Active reservations" value={reservations.active}
            sub={`${reservations.expiring_24h} expiring in 24h`} />
      <Stat label="Orders (30 days)" value={orders.orders_30d} />
      <Stat label="Revenue paid (30 days)" value={aud(orders.revenue_paid_cents_30d)} />
      <Stat label="Average order value" value={aud(orders.aov_cents)} />
      <Stat label="Newsletter" value={newsletter.total} sub="subscribers" />
    </section>
  );
}
