"use client";

/* One invoice, as a document.

   WHAT IT RENDERS IS WHAT THE API RETURNED. The header amounts are the INVOICE's own - the numbers
   that were documented at the time of the sale - while the lines and the delivery address come from
   the ORDER the invoice is about. That split is the server's (see `ledger.invoice_document`) and
   this page does not second-guess it: an invoice states what an order contained, and the order is
   where that is recorded.

   THE SELLER'S OWN IDENTITY COMES FROM THE SETTINGS STORE. The legal name, ABN, registered address
   and contact email are the one block on this document the platform cannot derive from the sale, so
   they are read from `site_settings` (Settings & System) by the server and rendered here in the
   order a tax invoice needs them: name, then ABN, then address, then the order's own details. A
   field nobody has set is OMITTED rather than invented - there is no placeholder ABN, ever. If the
   legal name itself is unset the document falls back to the trading name and says so ON SCREEN
   ONLY, because a printed page must not carry a note about what it is missing.

   MONOCHROME-SAFE, like the fulfilment documents: the rules are hairlines, the emphasis is weight,
   and nothing depends on an emerald that a mono printer would flatten into grey. */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { Badge, Button, Card, Heading } from "@/app/components/ui";
import { apiFetch } from "@/lib/api";
import { aud, when } from "@/lib/format";
import { requireRole, useMe } from "@/lib/session";
import { cn } from "@/app/components/ui";
import { kickerClass } from "@/lib/ui";

type Line = { asset_id: number | null; sku_title: string; qty: number; unit_price_cents: number;
              line_total_cents: number; grade: string | null; serial_tail: string | null };
type Address = { name: string; line1: string; line2: string; city: string; state: string;
                 postcode: string; country: string };
type Seller = { legal_name: string; tax_id: string; address: string; email: string };
type Doc = {
  id: number; number: string; status: string; currency: string; order_id: number | null;
  subtotal_cents: number; tax_cents: number; shipping_cents: number; total_cents: number;
  issued_on: string | null; due_on: string | null; paid_at: string | null; notes: string | null;
  customer: { email: string; display_name: string | null } | null;
  seller: Seller | null;
  ship_to: Address | null;
  lines: Line[];
};

const STATUS_TONE: Record<string, string> = {
  draft: "bg-surface-sunken text-ink-600",
  issued: "bg-status-listed-soft text-status-listed-ink",
  paid: "bg-status-sold-soft text-status-sold-ink",
  void: "bg-danger-50 text-danger-600",
};

export default function InvoiceDocumentPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { me, checked } = useMe();
  const allowed = requireRole(me, ["admin"]);

  const [doc, setDoc] = useState<Doc | null>(null);
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch(`/staff/finance/invoices/${id}`);
    if (!r.ok) {
      const j: any = await r.json().catch(() => ({}));
      setErr(typeof j?.detail === "string" ? j.detail
        : r.status === 403 ? "the books are an administrator's screen" : `Could not read the invoice (${r.status})`);
      setLoaded(true); return;
    }
    setDoc(await r.json().catch(() => null));
    setLoaded(true);
  }, [id]);

  useEffect(() => {
    if (!checked) return;
    if (!allowed || !id) { setLoaded(true); return; }
    void load();
  }, [checked, allowed, id, load]);

  if (!checked || !loaded) {
    return <main className="mx-auto max-w-3xl px-4 pt-8"><p className="text-sm text-ink-500">Loading...</p></main>;
  }
  if (!allowed || err || !doc) {
    return (
      <main className="mx-auto max-w-3xl px-4 pt-8">
        {err || !allowed
          ? <p className="text-sm text-danger-600">{err || "The books are an administrator's screen."}</p>
          : null}
      </main>
    );
  }

  const addr = doc.ship_to
    ? [doc.ship_to.line1, doc.ship_to.line2,
       [doc.ship_to.city, doc.ship_to.state, doc.ship_to.postcode].filter(Boolean).join(" "),
       doc.ship_to.country].filter(Boolean)
    : [];

  /* The seller block, defaulted to blanks so the document always renders. The registered address is
     free text an operator typed across lines, so it is split on newlines rather than assumed to be
     one string. */
  const seller: Seller = doc.seller ?? { legal_name: "", tax_id: "", address: "", email: "" };
  const sellerLines = seller.address.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  return (
    <main className="mx-auto max-w-3xl px-4 pt-8 pb-24">
      <div className="mb-6 flex flex-wrap items-center gap-3 print:hidden">
        <Heading level="h1">Invoice</Heading>
        <Badge colorClass={STATUS_TONE[doc.status] ?? "bg-surface-sunken text-ink-600"}>{doc.status}</Badge>
        <div className="ml-auto flex gap-2">
          <a className="text-brand-300 hover:underline text-sm" href="/admin/finance/invoices">&larr; Register</a>
          <Button onClick={() => window.print()}>Print</Button>
        </div>
      </div>

      <Card className="p-8 print:ring-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-ink-900 pb-4">
          <div>
            {/* THE SELLER BLOCK, in the order a tax invoice needs it: legal name, ABN, registered
                address, contact email - then the order's own details beside it. */}
            <p className="text-2xl font-semibold tracking-tight text-ink-900">
              {seller.legal_name || "RFO"}
            </p>
            {seller.tax_id && <p className="mt-1 text-sm text-ink-700">ABN {seller.tax_id}</p>}
            {sellerLines.map((l) => (
              <p key={l} className="text-sm text-ink-600">{l}</p>
            ))}
            {seller.email && <p className="mt-1 text-sm text-ink-600">{seller.email}</p>}
            {/* SCREEN ONLY: a printed page must not carry a note about what it is missing. */}
            {!seller.legal_name && (
              <p className="mt-2 max-w-xs text-xs text-ink-500 print:hidden">
                No legal identity is set yet, so this document prints the trading name and nothing
                invented. Set the business&apos;s name, ABN and address under Settings &amp; System.
              </p>
            )}
          </div>
          <div className="text-right">
            <p className={cn(kickerClass, "block")}>Tax invoice</p>
            <p className="mt-1 font-mono text-lg font-semibold text-ink-900">{doc.number}</p>
            <p className="text-xs text-ink-500">Issued {doc.issued_on ?? "-"}</p>
            {doc.due_on && <p className="text-xs text-ink-500">Due {doc.due_on}</p>}
            {doc.order_id !== null && <p className="text-xs text-ink-500">Order #{doc.order_id}</p>}
          </div>
        </header>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <section>
            <p className={cn(kickerClass, "block")}>Billed to</p>
            <address className="mt-2 text-sm not-italic text-ink-900">
              <span className="block font-medium">
                {doc.customer?.display_name || doc.ship_to?.name || "Guest customer"}
              </span>
              {doc.customer?.email && <span className="block text-ink-600">{doc.customer.email}</span>}
              {addr.map((l) => <span key={l} className="block text-ink-600">{l}</span>)}
            </address>
          </section>
          <section className="sm:text-right">
            <p className={cn(kickerClass, "block")}>Payment</p>
            <p className="mt-2 text-sm text-ink-900">
              {doc.paid_at ? `Paid ${when(doc.paid_at)}` : "Not recorded as paid"}
            </p>
            <p className="text-xs text-ink-500">Currency {doc.currency}</p>
          </section>
        </div>

        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-900 text-left text-xs uppercase tracking-wide">
              <th className="py-2">Description</th>
              <th className="py-2">Grade</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Unit</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l, i) => (
              <tr key={`${l.asset_id ?? "x"}-${i}`} className="border-b border-line">
                <td className="py-2 text-ink-900">
                  {l.sku_title}
                  {l.asset_id !== null && <span className="text-xs text-ink-500"> (#{l.asset_id})</span>}
                </td>
                <td className="py-2 text-ink-600">{l.grade ?? "-"}</td>
                <td className="py-2 text-right tabular-nums">{l.qty}</td>
                <td className="py-2 text-right tabular-nums">{aud(l.unit_price_cents, doc.currency)}</td>
                <td className="py-2 text-right tabular-nums">{aud(l.line_total_cents, doc.currency)}</td>
              </tr>
            ))}
            {doc.lines.length === 0 && (
              <tr><td colSpan={5} className="py-2 text-ink-500">
                This invoice has no order behind it, so it carries no line detail.
              </td></tr>
            )}
          </tbody>
        </table>

        <dl className="mt-4 ml-auto w-72 text-sm">
          <div className="flex justify-between py-0.5">
            <dt className="text-ink-600">Subtotal</dt>
            <dd className="tabular-nums">{aud(doc.subtotal_cents, doc.currency)}</dd>
          </div>
          <div className="flex justify-between py-0.5">
            <dt className="text-ink-600">GST</dt>
            <dd className="tabular-nums">{aud(doc.tax_cents, doc.currency)}</dd>
          </div>
          <div className="flex justify-between py-0.5">
            <dt className="text-ink-600">Shipping</dt>
            <dd className="tabular-nums">{aud(doc.shipping_cents, doc.currency)}</dd>
          </div>
          <div className="mt-2 flex justify-between border-t border-ink-900 pt-2 text-base font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{aud(doc.total_cents, doc.currency)}</dd>
          </div>
        </dl>

        {doc.notes && (
          <p className="mt-6 border-t border-line pt-4 text-xs text-ink-600">{doc.notes}</p>
        )}
        <p className="mt-6 text-xs text-ink-500">
          Total includes GST of {aud(doc.tax_cents, doc.currency)}.
        </p>
      </Card>

      <style jsx global>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: #fff; }
        }
      `}</style>
    </main>
  );
}
