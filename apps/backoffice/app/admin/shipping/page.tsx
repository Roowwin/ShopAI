"use client";

/* Pick & Pack: the bench where a paid order becomes a parcel.

   FOUR THINGS HAPPEN HERE, in the order a packer does them: read what has to go in the box, read
   where it is going, get the label, then record that it left. The screen is built as a worklist
   rather than a browser because this is a queue of work, not a catalogue - the order that has been
   waiting longest is at the top, and picking one opens its bench beside the list rather than
   navigating away from it. An operator packing ten orders does not want to lose their place ten
   times.

   THE CARRIER IS ALLOWED TO BE UNCONFIGURED, AND THE SCREEN SAYS SO. `GET /staff/logistics/carriers`
   reports which carriers can actually be used and what each one is missing; this page prints that
   list instead of offering a button that fails on press, and disables the label action with the
   reason as its tooltip. `services/carriers.py` will not invent a label or a tracking number, and
   neither will this page - the tracking field is the operator's, and it stays empty until either the
   carrier fills it or a human types it from the parcel.

   MARKING SHIPPED IS NOT THE SAME ACT AS BOOKING A LABEL, and the two are separate controls on
   purpose. A label can be spoiled and reprinted; a parcel is recorded once, by the sibling
   logistics endpoint that owns the `shipments` table. So the label this page fetches does not write
   anything - it fills the tracking field in, and the second, deliberate press is what records the
   dispatch. The manual path stays open the whole time: a packer with a satchel and a pen can type
   the carrier and the tracking reference and ship, with no carrier integration at all.

   THE PII ON THIS SCREEN is a customer's name and address, which is why the API behind it is gated
   to the warehouse roles and why the page is too. It is also why the printable documents live their
   own route: the slip and the label are the only places this data is meant to be reproduced, and
   they are print-formatted for exactly that. */

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Badge, Button, Card, Heading, Input, Select, Stat, Table, TBody, TD, TH, THead, TR, cn,
} from "@/app/components/ui";
import { apiFetch } from "@/lib/api";
import { aud, when } from "@/lib/format";
import { requireRole, useMe } from "@/lib/session";
import { gradeTone, kickerClass, linkClass } from "@/lib/ui";

type Line = { asset_id: number | null; sku_title: string; unit_price_cents: number;
              line_total_cents: number; grade: string | null; serial_tail: string | null };
type Recipient = { name: string; line1: string; line2: string; city: string; state: string;
                   postcode: string; country: string };
type Order = { id: number; public_id: string; status: string; currency: string; total_cents: number;
               subtotal_cents: number; tax_cents: number; shipping_cents: number; placed_at: string;
               customer_email: string | null; recipient: Recipient; lines: Line[] };
type Carriers = { key: string; label: string; configured: boolean; needs: string; missing: string[] };
type Label = { order_id: number; carrier: string; service: string; tracking_ref: string;
               label_format: string; label_base64: string; bytes: number; note: string | null };

const ROLES = ["admin", "manager", "warehouse"];

export default function PickAndPackPage() {
  const { me, checked } = useMe();
  const allowed = requireRole(me, ROLES);

  const [queue, setQueue] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [carriers, setCarriers] = useState<Carriers[]>([]);
  const [selected, setSelected] = useState<Order | null>(null);
  const [carrier, setCarrier] = useState("auspost");
  const [weight, setWeight] = useState("1000");
  const [tracking, setTracking] = useState("");
  const [label, setLabel] = useState<Label | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [q, c] = await Promise.all([
      apiFetch("/staff/logistics/queue?limit=50"),
      apiFetch("/staff/logistics/carriers"),
    ]);
    if (!q.ok) {
      setErr(q.status === 403 ? "warehouse, manager or admin role required" : `Could not read the queue (${q.status})`);
      setLoaded(true);
      return;
    }
    const qj: any = await q.json().catch(() => ({}));
    setQueue(qj.orders ?? []);
    setTotal(qj.total ?? 0);
    if (c.ok) {
      // `label_readiness`, not `carriers`: the rail's carrier endpoint answers two questions in one
      // response - what each carrier has cost and how fast it has been (`carriers`, the performance
      // stats this bench does not show) and whether a label can be booked right now. This reads the
      // second; the first is the Logistics page's.
      const cj: any = await c.json().catch(() => ({}));
      setCarriers(cj.label_readiness ?? []);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!checked) return;
    if (!allowed) { setLoaded(true); return; }
    void load();
  }, [checked, allowed, load]);

  const chosen = useMemo(() => carriers.find((c) => c.key === carrier), [carriers, carrier]);

  async function detail(r: Response, fallback: string) {
    const j: any = await r.json().catch(() => ({}));
    return typeof j?.detail === "string" ? j.detail : `${fallback} (${r.status})`;
  }

  function open(o: Order) {
    setSelected(o); setLabel(null); setTracking(""); setMsg(""); setErr("");
    setWeight("1000");
  }

  async function getLabel() {
    if (!selected || busy) return;
    setBusy("label"); setErr(""); setMsg("");
    try {
      const r = await apiFetch(`/staff/logistics/orders/${selected.id}/label`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carrier, weight_grams: Math.max(parseInt(weight || "0", 10) || 0, 0),
        }),
      });
      if (!r.ok) { setErr(await detail(r, "the carrier refused the label")); return; }
      const j: Label = await r.json();
      setLabel(j);
      setTracking(j.tracking_ref);
      setMsg(j.note ? `Label booked, with a caveat: ${j.note}` : `Label booked with ${chosen?.label ?? carrier}.`);
    } finally {
      setBusy("");
    }
  }

  function downloadLabel() {
    if (!label?.label_base64) return;
    const bin = atob(label.label_base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${label.tracking_ref || "label"}.${label.label_format || "pdf"}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function markShipped() {
    if (!selected || busy) return;
    if (!tracking.trim()) { setErr("a tracking reference is required to record a dispatch"); return; }
    setBusy("ship"); setErr(""); setMsg("");
    try {
      const r = await apiFetch(`/staff/logistics/orders/${selected.id}/ship`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carrier: chosen?.label ?? carrier,
          service: label?.service ?? null,
          tracking_ref: tracking.trim(),
          cost_cents: 0,
        }),
      });
      if (!r.ok) { setErr(await detail(r, "the dispatch was refused")); return; }
      const j: any = await r.json().catch(() => ({}));
      setMsg(`Order #${selected.id} is on its way - ${j.units_shipped ?? 0} unit(s) marked shipped.`);
      setSelected(null); setLabel(null); setTracking("");
      await load();
    } finally {
      setBusy("");
    }
  }

  if (!checked || !loaded) {
    return <main className="mx-auto max-w-6xl px-4 pt-8 pb-16"><p className="text-sm text-ink-500">Loading...</p></main>;
  }
  if (!allowed) {
    return (
      <main className="mx-auto max-w-6xl px-4 pt-8 pb-16">
        <Card className="p-6">
          <Heading level="h3" as="h2">Pick &amp; Pack</Heading>
          <p className="mt-2 text-sm text-ink-500">
            Packing is a warehouse screen. Your role is {me?.role ?? "unknown"}.
          </p>
        </Card>
      </main>
    );
  }

  const unconfigured = chosen && !chosen.configured;

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 pt-8 pb-16">
      <div>
        <Heading level="h1">Pick &amp; Pack</Heading>
        <p className="mt-1 text-sm text-ink-500">
          Paid orders with no parcel yet, oldest first. Pick the units, read the address, book a
          label, then record the dispatch.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Awaiting fulfilment" value={total}
              sub={total ? "oldest is first in the list" : "everything paid has a parcel"} />
        <Stat label="Carriers ready" value={carriers.filter((c) => c.configured).length}
              sub={carriers.some((c) => c.configured) ? "labels can be booked" : "labels cannot be booked yet"} />
        <Stat label="Shown" value={queue.length} sub="this page of the queue" />
      </div>

      {msg && <p className="text-sm text-brand-300">{msg}</p>}
      {err && <p className="text-sm text-danger-600">{err}</p>}

      {carriers.some((c) => !c.configured) && (
        <div className="rounded-card bg-accent-100 p-4 ring-1 ring-accent-400">
          <p className="text-sm font-semibold text-accent-700">
            {carriers.filter((c) => !c.configured).map((c) => c.label).join(", ")} cannot be used yet
          </p>
          <ul className="mt-2 space-y-1 text-xs text-ink-600">
            {carriers.filter((c) => !c.configured).flatMap((c) =>
              c.missing.map((m, i) => <li key={`${c.key}-${i}`}>- {m}</li>))}
          </ul>
          <p className="mt-2 text-xs text-ink-600">
            Nothing here invents a label or a tracking number. Until it is configured, record
            dispatches with the carrier and tracking reference printed on the parcel.
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Card className="p-4">
          <div className="flex items-baseline justify-between">
            <Heading level="h3" as="h2">Worklist</Heading>
            <Button variant="muted" size="sm" onClick={() => { void load(); }}>Refresh</Button>
          </div>
          {queue.length === 0 ? (
            <p className="mt-3 text-sm text-ink-500">Nothing is waiting to be packed.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {queue.map((o) => (
                <li key={o.id}>
                  <button
                    onClick={() => open(o)}
                    aria-current={selected?.id === o.id ? "true" : undefined}
                    className={cn(
                      "w-full rounded-control px-3 py-2 text-left transition",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500",
                      selected?.id === o.id ? "bg-brand-50 text-brand-300" : "hover:bg-surface-sunken",
                    )}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-ink-900">#{o.id}</span>
                      <span className="text-xs text-ink-500">{when(o.placed_at)}</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-500">
                      {o.lines.length} unit{o.lines.length === 1 ? "" : "s"} - {aud(o.total_cents)} -{" "}
                      {o.recipient.city || o.recipient.country}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {!selected ? (
          <Card className="p-6">
            <Heading level="h3" as="h2">Bench</Heading>
            <p className="mt-2 text-sm text-ink-500">Choose an order from the worklist to pack it.</p>
          </Card>
        ) : (
          <div className="space-y-6">
            <Card className="p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <Heading level="h3" as="h2">Order #{selected.id}</Heading>
                <a className={linkClass} href={`/admin/orders/${selected.id}/documents`}>
                  Packing slip &amp; label
                </a>
              </div>

              <div className="mt-4 grid gap-6 md:grid-cols-2">
                <section>
                  <p className={cn(kickerClass, "block")}>Pick list</p>
                  <div className="mt-2">
                    <Table label={`Units on order ${selected.id}`}>
                      <THead><TH>Unit</TH><TH>Grade</TH><TH>Serial</TH><TH>Value</TH></THead>
                      <TBody>
                        {selected.lines.map((l, i) => (
                          <TR key={`${l.asset_id ?? "x"}-${i}`}>
                            <TD>{l.sku_title}</TD>
                            <TD>{l.grade ? <Badge colorClass={gradeTone(l.grade)}>{l.grade}</Badge> : <span className="text-ink-500">-</span>}</TD>
                            <TD className="font-mono text-xs text-ink-600">{l.serial_tail ? `…${l.serial_tail}` : "-"}</TD>
                            <TD>{aud(l.line_total_cents)}</TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </div>
                  <p className="mt-2 text-xs text-ink-500">
                    {aud(selected.subtotal_cents)} of stock, {aud(selected.tax_cents)} tax,{" "}
                    {aud(selected.shipping_cents)} shipping - {aud(selected.total_cents)} paid.
                  </p>
                </section>

                <section>
                  <p className={cn(kickerClass, "block")}>Deliver to</p>
                  <address className="mt-2 text-sm not-italic text-ink-700">
                    <span className="block font-medium text-ink-900">{selected.recipient.name || "-"}</span>
                    <span className="block">{selected.recipient.line1}</span>
                    {selected.recipient.line2 && <span className="block">{selected.recipient.line2}</span>}
                    <span className="block">
                      {[selected.recipient.city, selected.recipient.state, selected.recipient.postcode]
                        .filter(Boolean).join(" ")}
                    </span>
                    <span className="block">{selected.recipient.country}</span>
                  </address>
                  {selected.customer_email && (
                    <p className="mt-2 text-xs text-ink-500">{selected.customer_email}</p>
                  )}
                </section>
              </div>
            </Card>

            <Card className="p-6 space-y-5">
              <Heading level="h3" as="h2">Send it</Heading>

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="carrier" className={cn(kickerClass, "block pb-1")}>Carrier</label>
                  <Select id="carrier" className="w-full" value={carrier}
                          onChange={(e) => setCarrier(e.target.value)}>
                    {carriers.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}{c.configured ? "" : " (not configured)"}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label htmlFor="weight" className={cn(kickerClass, "block pb-1")}>Weight (grams)</label>
                  <Input id="weight" inputMode="numeric" value={weight}
                         onChange={(e) => setWeight(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="tracking" className={cn(kickerClass, "block pb-1")}>Tracking reference</label>
                  <Input id="tracking" value={tracking} placeholder="filled by the carrier, or type it"
                         onChange={(e) => setTracking(e.target.value)} />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <span title={unconfigured ? chosen?.missing.join("; ") : undefined}>
                  <Button onClick={() => { void getLabel(); }} disabled={!!busy || !!unconfigured}>
                    {busy === "label" ? "Booking..." : "Get label"}
                  </Button>
                </span>
                <Button variant="accent" onClick={() => { void markShipped(); }} disabled={!!busy}>
                  {busy === "ship" ? "Recording..." : "Mark shipped"}
                </Button>
                {label?.label_base64 && (
                  <Button variant="secondary" onClick={downloadLabel}>
                    Download label ({label.label_format.toUpperCase()})
                  </Button>
                )}
                {unconfigured && (
                  <p className="text-xs text-ink-500">
                    {chosen?.label} needs {chosen?.missing.join(", ")} - a label cannot be booked until
                    then, though a dispatch can still be recorded by hand.
                  </p>
                )}
              </div>

              {label && (
                <div className="rounded-card bg-surface-sunken p-4">
                  <p className="text-sm font-semibold text-ink-900">
                    {label.carrier} {label.service} - tracking {label.tracking_ref}
                  </p>
                  <p className="mt-1 text-xs text-ink-600">
                    {label.bytes > 0
                      ? `${label.bytes.toLocaleString("en-AU")} bytes of label document returned.`
                      : "The carrier returned a shipment but no label document."}
                    {label.note ? ` ${label.note}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-ink-500">
                    Booking a label writes nothing to the order - recording the dispatch is the
                    separate press to the left.
                  </p>
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
    </main>
  );
}
