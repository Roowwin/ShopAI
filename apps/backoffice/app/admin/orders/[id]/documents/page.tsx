"use client";

/* The bench documents: a packing slip and a dispatch label, one per printed page.

   WHY THESE ARE THEIR OWN ROUTE. They are the one place in the backoffice where a customer's name
   and address are meant to be reproduced, and they are reproduced onto paper. Keeping them off the
   order detail page means the PII renders for exactly one purpose, behind the same warehouse gate as
   the queue, and it means the print rules cannot leak into a screen somebody is reading on a
   monitor - `@media print` here is scoped to this page's own markup.

   WHAT THIS LABEL IS, AND WHAT IT IS NOT. It is the dispatch label for the BENCH: who it is from,
   who it is going to, which carrier and service, and the tracking reference, at a size a packer can
   check at arm's length. It is NOT the carrier's own label document - when a label was booked, the
   carrier issued a PDF and that file is the authoritative one, downloadable from Pick & Pack. This
   page does not redraw the carrier's artwork, and it deliberately does not draw a barcode: a
   symbology rendered from a reference by hand is a scannable symbol that may not scan, and a label
   that fails at the scanner is worse than a label with no barcode at all. The tracking reference is
   printed large and in full so a human can read it and type it wherever it is needed.

   NO COLOUR IS LOAD-BEARING. A packing bench has a mono laser printer at best, so the label reads
   in black on white: the rules are hairlines, the emphasis is weight and size, and nothing depends
   on a tone that a greyscale print would flatten. */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { Button, Card, Heading } from "@/app/components/ui";
import { apiFetch } from "@/lib/api";
import { aud, when } from "@/lib/format";
import { requireRole, useMe } from "@/lib/session";

type Line = { asset_id: number | null; sku_title: string; unit_price_cents: number;
              line_total_cents: number; grade: string | null; serial_tail: string | null };
type Recipient = { name: string; line1: string; line2: string; city: string; state: string;
                   postcode: string; country: string };
type Doc = {
  order: { id: number; public_id: string; status: string; currency: string; total_cents: number;
           subtotal_cents: number; tax_cents: number; shipping_cents: number; placed_at: string;
           customer_email: string | null };
  recipient: Recipient;
  lines: Line[];
  shipment: { carrier: string; service: string | null; tracking_ref: string | null;
              dispatched_at: string | null; promised_at: string | null } | null;
};

const ROLES = ["admin", "manager", "warehouse"];

export default function OrderDocumentsPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { me, checked } = useMe();
  const allowed = requireRole(me, ROLES);

  const [doc, setDoc] = useState<Doc | null>(null);
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch(`/staff/shipping/orders/${id}`);
    if (!r.ok) {
      const j: any = await r.json().catch(() => ({}));
      setErr(typeof j?.detail === "string" ? j.detail : `Could not read the order (${r.status})`);
      setLoaded(true);
      return;
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
  if (!allowed) {
    return (
      <main className="mx-auto max-w-3xl px-4 pt-8">
        <Card className="p-6">
          <Heading level="h3" as="h2">Documents</Heading>
          <p className="mt-2 text-sm text-ink-500">Packing is a warehouse screen.</p>
        </Card>
      </main>
    );
  }
  if (err || !doc) {
    return (
      <main className="mx-auto max-w-3xl px-4 pt-8">
        <p className="text-sm text-danger-600">{err || "Order not found."}</p>
      </main>
    );
  }

  const { order, recipient, lines, shipment } = doc;
  const addr = [recipient.line1, recipient.line2, [recipient.city, recipient.state, recipient.postcode]
    .filter(Boolean).join(" "), recipient.country].filter(Boolean);

  return (
    <main className="mx-auto max-w-3xl px-4 pt-8 pb-24">
      {/* Screen-only controls. Every one of them is `print:hidden`, so paper carries the documents
          and nothing else. */}
      <div className="mb-6 flex flex-wrap items-center gap-3 print:hidden">
        <Heading level="h1">Documents</Heading>
        <span className="text-sm text-ink-500">Order #{order.id}</span>
        <div className="ml-auto flex gap-2">
          <a className="text-brand-300 hover:underline text-sm" href={`/admin/shipping`}>&larr; Pick &amp; Pack</a>
          <Button onClick={() => window.print()}>Print both</Button>
        </div>
      </div>

      {/* ---------------------------------------------------------------- packing slip */}
      <section className="print-page rounded-card bg-white p-8 text-ink-900 ring-1 ring-line print:ring-0">
        <header className="flex items-baseline justify-between border-b border-ink-900 pb-2">
          <h2 className="text-xl font-semibold tracking-tight">Packing slip</h2>
          <span className="text-sm">Order #{order.id}</span>
        </header>

        <div className="mt-4 grid grid-cols-2 gap-6 text-sm">
          <div>
            <p className="text-xs uppercase tracking-wide">Ship to</p>
            <address className="mt-1 not-italic">
              <span className="block font-semibold">{recipient.name || "-"}</span>
              {addr.map((l) => <span key={l} className="block">{l}</span>)}
            </address>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide">Placed</p>
            <p className="mt-1">{when(order.placed_at)}</p>
            <p className="mt-2 text-xs uppercase tracking-wide">Reference</p>
            <p className="mt-1 font-mono text-xs break-all">{order.public_id}</p>
          </div>
        </div>

        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-900 text-left text-xs uppercase tracking-wide">
              <th className="py-2">Item</th>
              <th className="py-2">Grade</th>
              <th className="py-2">Serial</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={`${l.asset_id ?? "x"}-${i}`} className="border-b border-ink-300">
                <td className="py-2">{l.sku_title}{l.asset_id ? <span className="text-xs"> (#{l.asset_id})</span> : null}</td>
                <td className="py-2">{l.grade ?? "-"}</td>
                <td className="py-2 font-mono text-xs">{l.serial_tail ? `…${l.serial_tail}` : "-"}</td>
                <td className="py-2 text-right">1</td>
                <td className="py-2 text-right">{aud(l.line_total_cents, order.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="mt-4 ml-auto w-64 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{aud(order.subtotal_cents, order.currency)}</dd></div>
          <div className="flex justify-between"><dt>Tax</dt><dd>{aud(order.tax_cents, order.currency)}</dd></div>
          <div className="flex justify-between"><dt>Shipping</dt><dd>{aud(order.shipping_cents, order.currency)}</dd></div>
          <div className="mt-2 flex justify-between border-t border-ink-900 pt-2 font-semibold">
            <dt>Paid</dt><dd>{aud(order.total_cents, order.currency)}</dd>
          </div>
        </dl>

        <p className="mt-6 text-xs">
          Check every unit above is in the box before sealing it. {lines.length} unit
          {lines.length === 1 ? "" : "s"} on this order.
        </p>
      </section>

      {/* ---------------------------------------------------------------- dispatch label */}
      <section className="print-page mt-8 rounded-card bg-white p-8 text-ink-900 ring-1 ring-line print:mt-0 print:ring-0">
        <header className="flex items-baseline justify-between border-b-2 border-ink-900 pb-2">
          <h2 className="text-xl font-semibold tracking-tight">Dispatch label</h2>
          <span className="text-sm">{shipment ? (shipment.carrier || "").toUpperCase() : "NOT DISPATCHED"}</span>
        </header>

        <div className="mt-4 grid grid-cols-2 gap-6 text-sm">
          <div>
            <p className="text-xs uppercase tracking-wide">From</p>
            <p className="mt-1">RFO Warehouse</p>
            <p className="text-xs">See the configured return address on the carrier label.</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide">Service</p>
            <p className="mt-1">{shipment?.service || "-"}</p>
          </div>
        </div>

        <div className="mt-6 border-2 border-ink-900 p-4">
          <p className="text-xs uppercase tracking-wide">Deliver to</p>
          <address className="mt-2 not-italic">
            <span className="block text-lg font-semibold leading-tight">{recipient.name || "-"}</span>
            {addr.map((l) => <span key={l} className="block text-base leading-tight">{l}</span>)}
          </address>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-6 text-sm">
          <div>
            <p className="text-xs uppercase tracking-wide">Tracking reference</p>
            <p className="mt-1 font-mono text-lg font-semibold">
              {shipment?.tracking_ref || "-"}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide">Order</p>
            <p className="mt-1 font-mono text-xs break-all">{order.public_id}</p>
          </div>
        </div>

        <p className="mt-6 text-xs">
          {shipment
            ? "The carrier's own label document is the authoritative one - download it from Pick & Pack."
            : "Nothing has been recorded as dispatched for this order yet, so this label carries no tracking reference."}
          {" "}No barcode is drawn here on purpose: a hand-rendered symbol that fails at a scanner
          would be worse than none, and the carrier's own label carries the scannable one.
        </p>
      </section>

      {/* Print rules, scoped to this page. `@page` sets the paper; the two sections each force a
          page break so a packer never gets a slip on the back of a label. */}
      <style jsx global>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: #fff; }
          .print-page { break-inside: avoid; }
          .print-page + .print-page { break-before: page; }
        }
      `}</style>
    </main>
  );
}
