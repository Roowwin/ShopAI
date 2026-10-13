"use client";

import { useEffect, useState } from "react";
import { aud } from "@/lib/api";
import { apiCustomer, signOut, type Customer, type OrderSummary } from "@/lib/session";
import { Badge, Button, Card, EmptyState, Heading } from "../components/ui";

/* MY ORDERS - the customer's own account page.
 *
 * Everything here is scoped by the API: `GET /store/orders` takes its identity from the bearer token
 * and filters on `customer_id`, so this page cannot ask for someone else's orders and does not try.
 * Its only job is to render what that door returns and to send an anonymous visitor to sign in.
 *
 * IT SHOWS A PANEL RATHER THAN REDIRECTING. A redirect on mount would bounce a shopper who is
 * merely curious about the link, and it cannot tell "not signed in yet" from "session just expired"
 * - both are a null `me()`. The panel says which, and offers the way forward.
 */

const STATUS_TONE: Record<string, string> = {
  paid: "bg-brand-500/15 text-brand-300",
  shipped: "bg-brand-500/15 text-brand-300",
  delivered: "bg-brand-700 text-ink-inverse",
  pending: "bg-surface-sunken text-ink-600",
  cancelled: "bg-surface-sunken text-ink-500",
  refunded: "bg-surface-sunken text-ink-500",
};

export default function AccountPage() {
  const [state, setState] = useState<"loading" | "anon" | "ready">("loading");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<OrderSummary[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await apiCustomer("/store/me");
      if (!alive) return;
      if (!r.ok) { setState("anon"); return; }
      const c = await r.json().catch(() => null);
      if (!alive || !c) { setState("anon"); return; }
      setCustomer(c);
      const o = await apiCustomer("/store/orders");
      const rows = o.ok ? await o.json().catch(() => []) : [];
      if (!alive) return;
      setOrders(Array.isArray(rows) ? rows : []);
      setState("ready");
    })();
    return () => { alive = false; };
  }, []);

  if (state === "loading") {
    return <main className="max-w-3xl mx-auto px-4 pt-16 pb-20"><p className="text-ink-500">Loading your account...</p></main>;
  }

  if (state === "anon") {
    return (
      <main className="max-w-lg mx-auto px-4 pt-16 pb-20 text-center">
        <Heading level="h1">Your orders</Heading>
        <p className="text-sm text-ink-600 mt-3">
          Sign in to see every order you have placed and where each one has got to. You can also
          open the order link you were given without an account.
        </p>
        <div className="mt-6 flex gap-3 justify-center">
          <Button href="/account/sign-in">Sign in</Button>
          <Button variant="secondary" href="/account/sign-in?mode=register">Create an account</Button>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto px-4 pt-12 pb-20">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Heading level="h1">Your orders</Heading>
          <p className="text-sm text-ink-500 mt-1">{customer?.email}</p>
        </div>
        {/* Sign out through the API, which revokes the refresh token, and only then drop the local
            token - so a half-signed-out state (token gone here, session alive on the server) cannot
            be navigated back into. Re-rendering the anon panel IS the navigation: there is no page
            to go to, because "signed out" is a state this page already knows how to draw. */}
        <Button variant="secondary" onClick={async () => {
          await signOut();
          setCustomer(null); setOrders([]); setState("anon");
        }}>Sign out</Button>
      </div>

      {orders.length === 0 ? (
        <div className="mt-8">
          <EmptyState>
            No orders yet. Anything you buy while signed in shows up here.
          </EmptyState>
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {orders.map((o) => (
            <a key={o.public_id} href={"/orders/" + o.public_id} className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2">
              <Card interactive className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{o.first_title ?? "Order"}</p>
                    <p className="text-xs text-ink-400 mt-0.5">
                      {new Date(o.placed_at).toLocaleDateString("en-AU")} -{" "}
                      {o.item_count} {o.item_count === 1 ? "unit" : "units"} -{" "}
                      <span className="font-mono">{o.public_id.slice(0, 8)}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Badge colorClass={STATUS_TONE[o.status] ?? "bg-surface-sunken text-ink-600"}>
                      {o.status}
                    </Badge>
                    <span className="font-semibold">{aud(o.total_cents)}</span>
                  </div>
                </div>
              </Card>
            </a>
          ))}
        </div>
      )}
    </main>
  );
}
