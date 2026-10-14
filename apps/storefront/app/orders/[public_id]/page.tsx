"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { aud } from "@/lib/api";
import { apiCustomer } from "@/lib/session";
import { Badge, Button, Card, Heading, linkClass } from "../../components/ui";

/* THE PAYMENT CONFIRMATION AND ORDER STATUS SCREEN.
 *
 * The page a shopper lands on straight after paying - and the page they come back to. It is PUBLIC
 * BY ORDER ID on purpose: a guest checkout has no session to authenticate with, so a confirmation
 * that demanded one would be unopenable by most buyers. The id is a v4 UUID and the API is what
 * decides how much of the order it reveals - the DELIVERY ADDRESS is only in the payload when the
 * caller is the order's own customer, which is why this page attaches the session when it has one.
 *
 * WHY THIS IS A CLIENT COMPONENT. The customer's access token lives in sessionStorage (see
 * lib/session.ts), which does not exist on the server, so a server component could never present it
 * and an owner would be served the masked address. Fetching in the browser is what lets the same URL
 * show the buyer their own delivery details and everyone else only the destination.
 *
 * THE TIMELINE IS THE ORDER'S OWN VOCABULARY. `orders.status` has admitted shipped and delivered
 * since 0001; those rungs are not reachable yet, and the strip below says where the order has got to
 * without promising a mechanism that does not exist. When shipment rows land, the tracking number
 * belongs on the Dispatched step.
 */

type Order = {
  public_id: string; status: string; currency: string; placed_at: string;
  subtotal_cents: number; tax_cents: number; shipping_cents: number; total_cents: number;
  tax: { jurisdiction: string | null; rate_bp: number | null };
  paid: boolean; payment_status: string | null;
  shipment: { carrier: string; service: string | null; tracking_ref: string | null;
              dispatched_at: string | null; promised_at: string | null;
              delivered_at: string | null } | null;
  ship_to: { city: string | null; state: string | null; postcode: string | null; country: string;
             full: boolean; name?: string | null; line1?: string | null; line2?: string | null };
  lines: { title: string; qty: number; grade: string | null; serial_tail: string | null;
           unit_price_cents: number; line_total_cents: number }[];
};

const STEPS = [
  { key: "placed", label: "Order placed" },
  { key: "paid", label: "Payment confirmed" },
  { key: "shipped", label: "Dispatched" },
  { key: "delivered", label: "Delivered" },
];

/* How far down the strip an order has got. A cancelled or refunded order is not "further along" -
 * it is off the road - so it highlights the step it reached and says so in the banner instead. */
function stepIndex(status: string): number {
  if (status === "pending") return 0;
  if (status === "paid") return 1;
  if (status === "shipped") return 2;
  if (status === "delivered") return 3;
  return 0;
}

function banner(status: string): { tone: string; title: string; body: string } {
  switch (status) {
    case "paid":
      return { tone: "bg-brand-500/15 text-brand-300",
               title: "Payment confirmed",
               body: "Your order is with our warehouse team. Every unit is checked and packed by hand before it ships." };
    case "shipped":
      return { tone: "bg-brand-500/15 text-brand-300", title: "On its way",
               body: "Your parcel has left the warehouse." };
    case "delivered":
      return { tone: "bg-brand-500/15 text-brand-300", title: "Delivered",
               body: "This order has been delivered. Thanks for keeping a device out of landfill." };
    case "cancelled":
      return { tone: "bg-surface-sunken text-ink-700", title: "Order cancelled",
               body: "This order was cancelled and nothing was charged. The units went back on sale." };
    case "refunded":
      return { tone: "bg-surface-sunken text-ink-700", title: "Refunded",
               body: "This order was refunded. The money returns to the card it was paid with." };
    default:
      return { tone: "bg-surface-sunken text-ink-700", title: "Awaiting payment",
               body: "This order has been created but the payment has not completed. You can finish it below." };
  }
}

export default function OrderPage() {
  const params = useParams<{ public_id: string }>();
  const publicId = params?.public_id ?? "";
  const [order, setOrder] = useState<Order | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await apiCustomer("/store/orders/" + publicId);
    if (r.status === 404) { setState("missing"); return; }
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) { setState("missing"); return; }
    setOrder(j); setState("ready");
  }, [publicId]);

  useEffect(() => { load(); }, [load]);

  /* Retry the two payment calls for an order that is still pending - the case where checkout
   * succeeded and the payment step did not. Never a second order: this addresses the order that
   * already exists. */
  async function finishPayment() {
    setBusy(true);
    try {
      const p = await apiCustomer("/store/orders/" + publicId + "/pay", { method: "POST" });
      if (p.ok) await apiCustomer("/store/orders/" + publicId + "/simulate-payment", { method: "POST" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") {
    return <main className="max-w-2xl mx-auto px-4 pt-20 pb-28"><p className="text-ink-500">Loading your order...</p></main>;
  }

  if (state === "missing" || order === null) {
    return (
      <main className="max-w-lg mx-auto px-4 pt-20 pb-28 text-center">
        <Heading level="h1">Order not found</Heading>
        <p className="text-sm text-ink-600 mt-3">
          That order link does not match an order. Check the link you were sent, or sign in to see
          your orders.
        </p>
        <div className="mt-6 flex gap-3 justify-center">
          <Button href="/account">My orders</Button>
          <Button variant="secondary" href="/">Keep shopping</Button>
        </div>
      </main>
    );
  }

  const b = banner(order.status);
  const at = stepIndex(order.status);
  const ratePct = order.tax.rate_bp === null ? null : order.tax.rate_bp / 100;

  return (
    <main className="max-w-2xl mx-auto px-4 pt-12 pb-28">
      {/* role="status" so a screen reader announces the outcome of the payment without the shopper
          having to hunt for it - this page IS the result of a button they pressed. It sits on an
          inner element because `Card` is a styled div and takes no ARIA attributes of its own. */}
      <Card className={"p-5 md:p-6 " + b.tone}>
        <div role="status">
          <Heading level="h1" className="!text-current">{b.title}</Heading>
          <p className="text-sm mt-2">{b.body}</p>
        </div>
      </Card>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs text-ink-500">Order number</p>
          <p className="font-mono text-sm">{order.public_id}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-ink-500">Placed</p>
          <p className="text-sm">{new Date(order.placed_at).toLocaleString("en-AU")}</p>
        </div>
      </div>

      {/* The status strip. Reached steps are filled, the rest are outlined, and the current one is
          marked - so the page answers "where is my order" in one glance. */}
      <ol className="mt-6 flex items-center gap-2" aria-label="Order progress">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex-1">
            <div className={"h-1.5 rounded-full " + (i <= at ? "bg-ink-700" : "bg-surface-sunken")} />
            <p className={"mt-1.5 text-eyebrow " + (i === at ? "font-semibold text-ink-900" : "text-ink-500")}>
              {s.label}
            </p>
          </li>
        ))}
      </ol>

      <Card className="p-5 md:p-6 mt-8">
        <Heading level="h2">What you bought</Heading>
        <div className="mt-3">
          {order.lines.map((l, i) => (
            <div key={i} className="flex items-start justify-between gap-3 border-b border-line py-3 last:border-0">
              <div className="min-w-0">
                <p className="font-medium truncate">{l.title}</p>
                <p className="text-xs text-ink-400 mt-0.5">
                  {l.grade ? "Grade " + l.grade : "Certified unit"}
                  {l.serial_tail ? <> - serial <span className="font-mono">***{l.serial_tail}</span></> : null}
                  {l.qty > 1 ? " - qty " + l.qty : null}
                </p>
              </div>
              <span className="font-semibold shrink-0">{aud(l.line_total_cents)}</span>
            </div>
          ))}
        </div>
        <dl className="mt-4 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-500">Subtotal (excl. GST)</dt><dd>{aud(order.subtotal_cents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-500">
              GST{ratePct !== null ? " (" + ratePct.toFixed(ratePct % 1 === 0 ? 0 : 1) + "%)" : ""}
              {order.tax.jurisdiction ? " - " + order.tax.jurisdiction.replace("_", " ") : ""}
            </dt>
            <dd>{aud(order.tax_cents)}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-2 font-semibold text-ink-900">
            <dt>Total {order.paid ? "paid" : "due"}</dt><dd>{aud(order.total_cents)}</dd>
          </div>
        </dl>

        <div className="mt-5 rounded-control bg-surface-sunken px-3 py-3">
          <p className="text-xs font-medium text-ink-600">Delivering to</p>
          {order.ship_to.full ? (
            <p className="text-sm text-ink-900 mt-1">
              {order.ship_to.name}<br />
              {order.ship_to.line1}{order.ship_to.line2 ? <><br />{order.ship_to.line2}</> : null}<br />
              {[order.ship_to.city, order.ship_to.state, order.ship_to.postcode].filter(Boolean).join(" ")}<br />
              {order.ship_to.country}
            </p>
          ) : (
            <p className="text-sm text-ink-900 mt-1">
              {[order.ship_to.city, order.ship_to.state, order.ship_to.postcode].filter(Boolean).join(" ")}
              {order.ship_to.city || order.ship_to.postcode ? ", " : ""}{order.ship_to.country}
              <span className="block text-xs text-ink-500 mt-1">
                Sign in as the account that placed this order to see the full address.
              </span>
            </p>
          )}
        </div>

        {order.shipment && (
          <div className="mt-5 rounded-control bg-surface-sunken px-3 py-3">
            <p className="text-xs font-medium text-ink-600">
              {order.shipment.delivered_at ? "Delivered by" : "On its way with"}
            </p>
            <p className="text-sm text-ink-900 mt-1">
              {order.shipment.carrier}
              {order.shipment.service ? " - " + order.shipment.service : ""}
              {order.shipment.promised_at && !order.shipment.delivered_at
                ? <> &middot; expected by {new Date(order.shipment.promised_at).toLocaleDateString("en-AU")}</> : null}
            </p>
            {order.shipment.tracking_ref && (
              <p className="text-sm mt-1">
                Tracking <span className="font-mono">{order.shipment.tracking_ref}</span> -{" "}
                {/* The public page takes the reference on its own, so a buyer can hand this link to
                    anyone who needs it without handing over the order itself. */}
                <a className={linkClass} href={"/track/" + encodeURIComponent(order.shipment.tracking_ref)}>
                  follow this parcel
                </a>
              </p>
            )}
          </div>
        )}

        {!order.paid && order.status === "pending" && (
          <Button variant="primary" className="w-full mt-5" onClick={finishPayment} disabled={busy} busy={busy}>
            {busy ? "Taking payment..." : "Finish payment - " + aud(order.total_cents)}
          </Button>
        )}
      </Card>

      {order.payment_status && (
        <p className="mt-4 text-xs text-ink-400">
          Payment <Badge colorClass="bg-surface-sunken text-ink-600">{order.payment_status}</Badge>
        </p>
      )}

      <div className="mt-8 flex gap-3">
        <Button variant="secondary" href="/account">My orders</Button>
        <Button variant="secondary" href="/">Keep shopping</Button>
        <a href="/returns" className={"self-center text-sm " + linkClass}>Returns policy</a>
      </div>
    </main>
  );
}
