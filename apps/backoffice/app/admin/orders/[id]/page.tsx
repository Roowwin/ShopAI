"use client";

import { use, useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Badge, Card, Heading, Stat, Table, TBody, TD, TH, THead, TR } from "@/app/components/ui";
import { aud, when } from "@/lib/format";
import { requireRole, useMe } from "@/lib/session";
import { gradeTone, pageClass, statusTone } from "@/lib/ui";
import FulfilmentCard from "./FulfilmentCard";

/* One order in full: its lines, its payments and whose it is.

   READ-ONLY - the payment rows are a record of what the provider did, not a control surface.
   There is no refund button anywhere in this app.

   PII: `customer.email` and `customer.display_name` are the only personal values on this payload,
   and the server door behind it is require_roles("admin","manager"). A guest checkout (the store
   allows one) has no customer row at all, so the block renders an explicit "guest checkout"
   instead of a blank - an empty box there would read as a loading failure. */
type Line = { asset_id: number | null; sku_title: string; unit_price_cents: number;
              line_total_cents: number; grade: string | null; serial_tail: string | null };
type Payment = { provider: string | null; status: string; amount_cents: number; created_at: string };
type Detail = {
  order: { id: number; public_id: string; status: string; subtotal_cents: number; tax_cents: number;
           shipping_cents: number; total_cents: number; currency: string; placed_at: string;
           customer_id: number | null };
  lines: Line[];
  payments: Payment[];
  customer: { email: string; display_name: string | null } | null;
};

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me, checked } = useMe();
  const allowed = requireRole(me, ["admin", "manager"]);
  // Shipping is warehouse work, so the fulfilment card admits a wider set than this page's reads.
  const canFulfil = requireRole(me, ["admin", "manager", "warehouse"]);
  const [data, setData] = useState<Detail | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const r = await apiFetch("/staff/orders/" + id);
    if (!r.ok) {
      setMsg(r.status === 403 ? "admin or manager role required"
                              : r.status === 404 ? "No order with that id"
                              : "Could not load the order");
      return;
    }
    setData(await r.json().catch(() => null));
  }, [id]);

  useEffect(() => {
    if (!checked || !allowed) { return; }
    void load();
  }, [checked, allowed, load]);

  const o = data?.order;

  return (
    <main className={pageClass.narrow}>
      <a href="/admin/orders" className="text-sm text-brand-300 hover:underline">&larr; All orders</a>
      <Heading level="h1">
        Order <span className="font-mono text-base">{o ? o.public_id : "#" + id}</span>
      </Heading>

      {msg && <Card className="p-4"><p className="text-sm text-ink-600">{msg}</p></Card>}

      {checked && allowed && o && data && (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Total" value={aud(o.total_cents, o.currency)} />
            <Stat label="Subtotal" value={aud(o.subtotal_cents, o.currency)}
                  sub={`tax ${aud(o.tax_cents, o.currency)} + shipping ${aud(o.shipping_cents, o.currency)}`} />
            <Stat label="Placed" value={when(o.placed_at)} sub={o.status} />
            <Stat label="Lines" value={data.lines.length} sub={`${data.payments.length} payment rows`} />
          </section>

          <Card className="p-4">
            <Heading level="h2" className="mb-2">Customer</Heading>
            {data.customer ? (
              <p className="text-sm text-ink-600">
                <span className="text-ink-900">{data.customer.email}</span>
                {data.customer.display_name ? <> &middot; {data.customer.display_name}</> : null}
                {o.customer_id != null && (
                  <> &middot; <a href={"/admin/customers/" + o.customer_id}
                                 className="text-brand-300 hover:underline">all their orders</a></>
                )}
              </p>
            ) : (
              <p className="text-sm text-ink-600">Guest checkout - this order has no customer account.</p>
            )}
          </Card>

          <Card className="p-4">
            <Heading level="h2" className="mb-2">Lines</Heading>
            <Table label="Order lines">
              <THead><TH>Unit</TH><TH>Title</TH><TH>Grade</TH><TH>Serial tail</TH><TH>Unit price</TH><TH>Line total</TH></THead>
              <TBody>
                {data.lines.map((l, i) => (
                  <TR key={l.asset_id ?? "p" + i}>
                    <TD className="font-mono text-xs">
                      {l.asset_id == null
                        ? <span className="text-ink-500">no unit</span>
                        : <a href={"/admin/assets/" + l.asset_id} className="text-brand-300 hover:underline">{l.asset_id}</a>}
                    </TD>
                    <TD><span className="text-ink-900">{l.sku_title}</span></TD>
                    <TD>{l.grade ? <Badge colorClass={gradeTone(l.grade)}>{l.grade}</Badge>
                                 : <span className="text-ink-500">-</span>}</TD>
                    <TD className="font-mono">{l.serial_tail ?? "-"}</TD>
                    <TD className="text-right tabular-nums">{aud(l.unit_price_cents, o.currency)}</TD>
                    <TD className="text-right tabular-nums">{aud(l.line_total_cents, o.currency)}</TD>
                  </TR>
                ))}
                {data.lines.length === 0 && (
                  <TR><TD colSpan={6}><span className="text-ink-500">This order has no lines.</span></TD></TR>
                )}
              </TBody>
            </Table>
          </Card>

          <Card className="p-4">
            <Heading level="h2" className="mb-2">Payments</Heading>
            <Table label="Payments for this order">
              <THead><TH>Provider</TH><TH>Status</TH><TH>Amount</TH><TH>Created</TH></THead>
              <TBody>
                {data.payments.map((p, i) => (
                  <TR key={i}>
                    <TD><span className="text-ink-900">{p.provider ?? "-"}</span></TD>
                    <TD><Badge colorClass={statusTone(p.status)}>{p.status}</Badge></TD>
                    <TD className="text-right tabular-nums">{aud(p.amount_cents, o.currency)}</TD>
                    <TD className="whitespace-nowrap"><span className="text-ink-500">{when(p.created_at)}</span></TD>
                  </TR>
                ))}
                {data.payments.length === 0 && (
                  <TR><TD colSpan={4}><span className="text-ink-500">No payment attempt recorded.</span></TD></TR>
                )}
              </TBody>
            </Table>
            <p className="text-xs text-ink-500 pt-2">
              Payment rows are a record of what the provider reported, never a control surface:
              there is no refund action in this app.
            </p>
          </Card>

          {/* The one write on this page, and the only place an order can leave `paid`. Warehouse
              ships, so the card takes a wider role than the read gate above it. */}
          <FulfilmentCard orderId={Number(id)} orderStatus={o.status}
                          canWrite={canFulfil} onChanged={load} />
        </>
      )}
    </main>
  );
}
