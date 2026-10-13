"use client";

/* Manage invoices: the register, filtered the four ways an operator actually asks for it.

   THE FILTERS ARE THE SERVER'S PARAMETERS, not a client-side narrowing of one page. Filtering in
   the browser would search only the 25 rows already fetched, so "show me everything over $1,000"
   would quietly mean "over $1,000, among these 25" - a wrong answer that looks like a right one.

   MONEY IS ENTERED IN DOLLARS AND SENT IN CENTS. The API stores and speaks cents like every other
   money field in the platform, and the conversion happens here, once, in `dollarsToCents`. Two
   places doing it is two places to lose a factor of 100, and a register filtered by $1000 when the
   operator typed 1000 would be the kind of bug that reads as "the report is wrong".

   INVOICES ARE NOT CREATED HERE. The normal way one exists is that an order was paid and the
   payment path issued it in the same transaction; the only write on this screen is the status
   ladder, because a voided document and a paid one are things an operator marks, while a document
   that never had a sale behind it is not something a button should be able to invent. */

import { useCallback, useEffect, useState } from "react";

import { Badge, Button, Card, Heading, Input, Select, Stat, Table, TBody, TD, TH, THead, TR, cn } from "@/app/components/ui";
import { apiFetch } from "@/lib/api";
import { aud, when } from "@/lib/format";
import { requireRole, useMe } from "@/lib/session";
import { kickerClass, linkClass } from "@/lib/ui";

type Invoice = {
  id: number; public_id: string; number: string; order_id: number | null; customer_id: number | null;
  status: string; currency: string; subtotal_cents: number; tax_cents: number;
  shipping_cents: number; total_cents: number; issued_on: string | null; due_on: string | null;
  paid_at: string | null; notes: string | null;
};

const PAGE = 25;
const STATUS_TONE: Record<string, string> = {
  draft: "bg-surface-sunken text-ink-600",
  issued: "bg-status-listed-soft text-status-listed-ink",
  paid: "bg-status-sold-soft text-status-sold-ink",
  void: "bg-danger-50 text-danger-600",
};

/* Empty stays empty: a blank field is "no filter", not zero. `Number("")` is 0, which would turn an
   untouched amount box into a floor of $0 - harmless-looking, and wrong the moment a credit note
   exists. */
function dollarsToCents(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export default function InvoicesPage() {
  const { me, checked } = useMe();
  const allowed = requireRole(me, ["admin"]);

  const [rows, setRows] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState("");
  const [customer, setCustomer] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [minAmt, setMinAmt] = useState("");
  const [maxAmt, setMaxAmt] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setErr("");
    const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (status) p.set("status", status);
    if (customer.trim()) p.set("customer", customer.trim());
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    const min = dollarsToCents(minAmt); if (min !== null) p.set("amount_min", String(min));
    const max = dollarsToCents(maxAmt); if (max !== null) p.set("amount_max", String(max));
    const r = await apiFetch("/staff/finance/invoices?" + p.toString());
    if (!r.ok) {
      const j: any = await r.json().catch(() => ({}));
      setErr(typeof j?.detail === "string" ? j.detail : `Could not read the register (${r.status})`);
      setRows([]); setLoaded(true); return;
    }
    const j: any = await r.json().catch(() => ({}));
    setRows(j.invoices ?? []); setTotal(j.total ?? 0); setLoaded(true);
  }, [offset, status, customer, from, to, minAmt, maxAmt]);

  useEffect(() => {
    if (!checked) return;
    if (!allowed) { setLoaded(true); return; }
    void load();
  }, [checked, allowed, load]);

  /* Any filter change resets to the first page: staying on offset 50 of a result set that just
     became three rows long shows an empty table and reads as "no matches". */
  function refilter(fn: () => void) { fn(); setOffset(0); }

  async function setInvoiceStatus(inv: Invoice, next: string) {
    setErr(""); setMsg("");
    const r = await apiFetch(`/staff/finance/invoices/${inv.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(typeof j?.detail === "string" ? j.detail : `the change was refused (${r.status})`); return; }
    setMsg(`${inv.number} is now ${j.status}.`);
    await load();
  }

  if (!checked || !loaded) {
    return <main className="mx-auto max-w-6xl px-4 pt-8 pb-16"><p className="text-sm text-ink-500">Loading...</p></main>;
  }
  if (!allowed) {
    return (
      <main className="mx-auto max-w-6xl px-4 pt-8 pb-16">
        <Card className="p-6">
          <Heading level="h3" as="h2">Invoices</Heading>
          <p className="mt-2 text-sm text-ink-500">The books are an administrator&apos;s screen.</p>
        </Card>
      </main>
    );
  }

  const pageValue = rows.reduce((s, i) => s + i.total_cents, 0);

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 pt-8 pb-16">
      <div>
        <Heading level="h1">Manage invoices</Heading>
        <p className="mt-1 text-sm text-ink-500">
          Every document the business has issued, newest first. Invoices are issued by the payment
          path when an order is paid - this screen reads them and moves their status.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label="Invoices matching" value={total} sub="the current filters" />
        <Stat label="On this page" value={rows.length} sub={`offset ${offset}`} />
        <Stat label="Value on this page" value={aud(pageValue)} />
      </section>

      {msg && <p className="text-sm text-brand-300">{msg}</p>}
      {err && <p className="text-sm text-danger-600">{err}</p>}

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <label htmlFor="f-from" className={cn(kickerClass, "block pb-1")}>Issued from</label>
            <Input id="f-from" type="date" value={from} onChange={(e) => refilter(() => setFrom(e.target.value))} />
          </div>
          <div>
            <label htmlFor="f-to" className={cn(kickerClass, "block pb-1")}>Issued to</label>
            <Input id="f-to" type="date" value={to} onChange={(e) => refilter(() => setTo(e.target.value))} />
          </div>
          <div>
            <label htmlFor="f-cust" className={cn(kickerClass, "block pb-1")}>Customer</label>
            <Input id="f-cust" placeholder="email or name" value={customer}
                   onChange={(e) => refilter(() => setCustomer(e.target.value))} />
          </div>
          <div>
            <label htmlFor="f-status" className={cn(kickerClass, "block pb-1")}>Status</label>
            <Select id="f-status" className="w-full" value={status}
                    onChange={(e) => refilter(() => setStatus(e.target.value))}>
              <option value="">any status</option>
              {["draft", "issued", "paid", "void"].map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
          <div>
            <label htmlFor="f-min" className={cn(kickerClass, "block pb-1")}>Amount from ($)</label>
            <Input id="f-min" inputMode="decimal" placeholder="0.00" value={minAmt}
                   onChange={(e) => refilter(() => setMinAmt(e.target.value))} />
          </div>
          <div>
            <label htmlFor="f-max" className={cn(kickerClass, "block pb-1")}>Amount to ($)</label>
            <Input id="f-max" inputMode="decimal" placeholder="any" value={maxAmt}
                   onChange={(e) => refilter(() => setMaxAmt(e.target.value))} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="muted" size="sm"
                  onClick={() => refilter(() => { setStatus(""); setCustomer(""); setFrom(""); setTo(""); setMinAmt(""); setMaxAmt(""); })}>
            Clear filters
          </Button>
          <p className="text-xs text-ink-500">Amounts are entered in dollars; the API speaks cents.</p>
        </div>
      </Card>

      <Card className="p-4">
        <Table label="Issued invoices">
          <THead>
            <TH>Number</TH><TH>Issued</TH><TH>Customer</TH><TH>Status</TH>
            <TH className="text-right">Ex GST</TH><TH className="text-right">GST</TH>
            <TH className="text-right">Total</TH><TH>Actions</TH>
          </THead>
          <TBody>
            {rows.map((i) => (
              <TR key={i.id}>
                <TD className="font-mono text-xs">
                  <a className={linkClass} href={`/admin/finance/invoices/${i.id}`}>{i.number}</a>
                </TD>
                <TD className="text-ink-500">{i.issued_on ? when(i.issued_on) : "-"}</TD>
                <TD className="text-ink-600">
                  {i.customer_id === null
                    ? <span className="text-ink-500">guest sale</span>
                    : <span className="font-mono text-xs">#{i.customer_id}</span>}
                  {i.order_id !== null && (
                    <a className={cn(linkClass, "ml-2 text-xs")} href={`/admin/orders/${i.order_id}`}>
                      order #{i.order_id}
                    </a>
                  )}
                </TD>
                <TD><Badge colorClass={STATUS_TONE[i.status] ?? "bg-surface-sunken text-ink-600"}>{i.status}</Badge></TD>
                <TD className="text-right tabular-nums">{aud(i.subtotal_cents + i.shipping_cents)}</TD>
                <TD className="text-right tabular-nums text-ink-600">{aud(i.tax_cents)}</TD>
                <TD className="text-right tabular-nums font-medium">{aud(i.total_cents)}</TD>
                <TD>
                  <div className="flex items-center gap-2">
                    <a className={linkClass} href={`/admin/finance/invoices/${i.id}`}>View</a>
                    {i.status === "issued" && (
                      <Button variant="muted" size="inline" onClick={() => { void setInvoiceStatus(i, "paid"); }}>
                        Mark paid
                      </Button>
                    )}
                    {(i.status === "issued" || i.status === "draft") && (
                      <Button variant="muted" size="inline" onClick={() => { void setInvoiceStatus(i, "void"); }}>
                        Void
                      </Button>
                    )}
                  </div>
                </TD>
              </TR>
            ))}
            {rows.length === 0 && !err && (
              <TR><TD colSpan={8} className="text-ink-500">No invoices match these filters.</TD></TR>
            )}
          </TBody>
        </Table>

        <div className="mt-3 flex items-center justify-between">
          <Button variant="muted" size="sm" disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
          <span className="text-xs text-ink-500">
            {total === 0 ? "nothing to show" : `${offset + 1}-${Math.min(offset + PAGE, total)} of ${total}`}
          </span>
          <Button variant="muted" size="sm" disabled={offset + PAGE >= total}
                  onClick={() => setOffset(offset + PAGE)}>Next</Button>
        </div>
      </Card>
    </main>
  );
}
