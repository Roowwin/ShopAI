"use client";

import { use, useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Badge, Card, Heading, Stat, Table, TBody, TD, TH, THead, TR, cn } from "@/app/components/ui";
import { aud, when } from "@/lib/format";
import { requireRole, useMe } from "@/lib/session";
import { linkClass, pageClass, statusTone } from "@/lib/ui";

/* One customer: who they are and every order they have placed.

   READ-ONLY, and the second half of the app's PII surface - the email and display name here are
   the ones the API only hands an admin or manager. The server door decides that; the guard below
   only keeps an unqualified session from firing the request.

   The by-state summary is built with Object.entries over a reduce of THIS PAYLOAD, so a state the
   page has not been taught still appears - there is no list here to fall out of step with the
   API. The history the API returns is capped, and the card says so, so a truncated count is never
   read as a total. */
type Order = { id: number; public_id: string; status: string; total_cents: number; currency: string;
               placed_at: string; customer_email: string | null; item_count: number };
type Detail = {
  customer: { id: number; public_id: string; email: string; display_name: string | null;
              status: string; created_at: string; orders_count: number; lifetime_cents: number };
  orders: Order[];
};

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me, checked } = useMe();
  const allowed = requireRole(me, ["admin", "manager"]);
  const [data, setData] = useState<Detail | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const r = await apiFetch("/staff/customers/" + id);
    if (!r.ok) {
      setMsg(r.status === 403 ? "admin or manager role required"
                              : r.status === 404 ? "No customer with that id"
                              : "Could not load the customer");
      return;
    }
    setData(await r.json().catch(() => null));
  }, [id]);

  useEffect(() => {
    if (!checked || !allowed) { return; }
    void load();
  }, [checked, allowed, load]);

  const c = data?.customer;
  const byState: Record<string, number> = {};
  for (const o of data?.orders ?? []) { byState[o.status] = (byState[o.status] ?? 0) + 1; }
  const shown = data?.orders.length ?? 0;
  const truncated = c != null && c.orders_count > shown;

  /* The one condition that says "the gate below is open". The heading is rendered OUTSIDE that
     gate on purpose (SSR has no session, and a heading that only appeared once data arrived would
     leave an SSR response with no heading at all) - but the email in it is PII the API hands only
     to a qualified session, so the heading takes its value from the same three facts rather than
     from `c` alone. `c` alone is not the gate: it is empty today only because it derives from
     gated state, and a second way to seed this state would put an unqualified customer's address
     in the heading. */
  const cleared = checked && allowed && c != null && data != null;

  return (
    /* WIDE, like the register this customer is opened from - a row press must not re-lay-out the
       page around copy that has not changed. See the correction in lib/ui.ts. */
    <main className={pageClass.wide}>
      <a href="/admin/customers" className={cn("text-sm", linkClass)}>&larr; All customers</a>
      <Heading level="h1">{cleared && c ? c.email : "Customer #" + id}</Heading>

      {msg && <Card className="p-4"><p className="text-sm text-ink-600">{msg}</p></Card>}

      {cleared && c && data && (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Orders" value={c.orders_count} />
            <Stat label="Lifetime spend" value={aud(c.lifetime_cents)}
                  sub="paid, shipped or delivered orders" />
            <Stat label="Joined" value={when(c.created_at)} sub={c.display_name || "no display name"} />
            <Stat label="Account" value={<Badge colorClass={statusTone(c.status)}>{c.status}</Badge>} />
          </section>

          <Card className="p-4">
            <Heading level="h2" className="mb-2">Orders by state</Heading>
            <Table label="This customer's orders by state">
              <THead><TH>State</TH><TH>Orders</TH></THead>
              <TBody>
                {Object.entries(byState).map(([state, n]) => (
                  <TR key={state}>
                    <TD><Badge colorClass={statusTone(state)}>{state}</Badge></TD>
                    <TD className="text-right tabular-nums">{n}</TD>
                  </TR>
                ))}
                {Object.entries(byState).length === 0 && (
                  <TR><TD colSpan={2}><span className="text-ink-500">No orders yet.</span></TD></TR>
                )}
              </TBody>
            </Table>
          </Card>

          <Card className="p-4">
            <Heading level="h2" className="mb-2">Order history</Heading>
            <Table label="This customer's orders">
              <THead><TH>Public id</TH><TH>State</TH><TH>Items</TH><TH>Total</TH><TH>Placed</TH></THead>
              <TBody>
                {data.orders.map((o) => (
                  <TR key={o.id}>
                    <TD className="font-mono text-xs">
                      <a href={"/admin/orders/" + o.id} className={linkClass}>{o.public_id.slice(0, 8)}</a>
                    </TD>
                    <TD><Badge colorClass={statusTone(o.status)}>{o.status}</Badge></TD>
                    <TD className="text-right tabular-nums">{o.item_count}</TD>
                    <TD className="text-right tabular-nums">{aud(o.total_cents, o.currency)}</TD>
                    <TD className="whitespace-nowrap"><span className="text-ink-500">{when(o.placed_at)}</span></TD>
                  </TR>
                ))}
                {shown === 0 && (
                  <TR><TD colSpan={5}><span className="text-ink-500">This customer has no orders.</span></TD></TR>
                )}
              </TBody>
            </Table>
            {truncated && (
              <p className="text-xs text-ink-500 pt-2">
                Showing the {shown} most recent of {c.orders_count} orders.
              </p>
            )}
          </Card>
        </>
      )}
    </main>
  );
}
