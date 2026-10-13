"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Heading, Input } from "@/app/components/ui";
import { apiFetch } from "@/lib/api";
import { aud, when } from "@/lib/format";
import { statusTone } from "@/lib/ui";

/* Fulfilment: the parcel, and the two writes that move an order off `paid`.

   WHY THIS IS ON THE ORDER rather than on a logistics screen: shipping is an act performed while
   looking at the order you are shipping. It reads its own shipment through its own door
   (`/staff/logistics/orders/{id}/shipment`) rather than the order payload - the order read is the
   commerce desk's shape and this is logistics' record, so neither module has to grow the other's
   fields.

   THE FORM IS ONLY OFFERED WHEN THE ORDER CAN ACTUALLY SHIP. `status === "paid"` is the API's own
   precondition (paid -> shipped is the only rung the order ladder admits into shipping), so an
   order in any other state shows the parcel or an explanation instead of a button that would come
   back a 409. The server refuses it anyway; this is the screen agreeing with the server rather than
   discovering it.

   `promised_days` is asked for because it is the only thing that makes a carrier's lateness
   measurable afterwards. It is optional - a carrier that quotes nothing can still be recorded - and
   the carrier table says "no promise recorded" rather than pretending those parcels were on time. */

type Shipment = {
  shipment_id: number; order_id: number; order_status: string; carrier: string; service: string | null;
  tracking_ref: string | null; cost_cents: number; dispatched_at: string;
  promised_at: string | null; delivered_at: string | null;
};

export default function FulfilmentCard({ orderId, orderStatus, canWrite, onChanged }:
  { orderId: number; orderStatus: string; canWrite: boolean; onChanged: () => void }) {
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [form, setForm] = useState({ carrier: "", service: "", tracking_ref: "", cost: "", promised_days: "" });

  const load = useCallback(async () => {
    const r = await apiFetch(`/staff/logistics/orders/${orderId}/shipment`);
    if (!r.ok) {
      setErr(r.status === 403 ? "a logistics role is required" : "Could not read this order's parcel");
      setLoaded(true);
      return;
    }
    const j: any = await r.json().catch(() => ({}));
    setShipment(j.shipment ?? null);
    setLoaded(true);
  }, [orderId]);

  useEffect(() => { if (canWrite) { void load(); } }, [canWrite, load]);

  async function ship(e: React.FormEvent) {
    e.preventDefault();
    if (busy) { return; }
    if (!form.carrier.trim()) { setErr("A carrier is required - it is what the performance table groups by."); return; }
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await apiFetch(`/staff/logistics/orders/${orderId}/ship`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carrier: form.carrier.trim(),
          service: form.service.trim() || null,
          tracking_ref: form.tracking_ref.trim() || null,
          cost_cents: form.cost.trim() ? Math.round(Number(form.cost) * 100) : 0,
          promised_days: form.promised_days.trim() ? Math.round(Number(form.promised_days)) : null,
        }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(typeof j.detail === "string" ? j.detail : "the shipment was refused"); return; }
      setMsg(`Recorded with ${j.carrier}. ${j.units_shipped} unit${j.units_shipped === 1 ? "" : "s"} marked shipped.`);
      setForm({ carrier: "", service: "", tracking_ref: "", cost: "", promised_days: "" });
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function deliver() {
    if (busy || !shipment) { return; }
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await apiFetch(`/staff/logistics/shipments/${shipment.shipment_id}/deliver`, { method: "POST" });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(typeof j.detail === "string" ? j.detail : "the delivery could not be recorded"); return; }
      setMsg("Delivery recorded. The order is closed; the units stay on `shipped`.");
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (!canWrite) { return null; }

  return (
    <Card className="p-4">
      <Heading level="h2" className="mb-2">Fulfilment</Heading>

      {msg && <p className="text-sm text-brand-300">{msg}</p>}
      {err && <p className="text-sm text-danger-600">{err}</p>}

      {!loaded && <p className="text-sm text-ink-500">Reading the parcel...</p>}

      {loaded && shipment && (
        <div className="text-sm text-ink-600 space-y-1">
          <p>
            <span className="text-ink-900">{shipment.carrier}</span>
            {shipment.service ? <> &middot; {shipment.service}</> : null}
            {shipment.tracking_ref ? <> &middot; <span className="font-mono text-xs">{shipment.tracking_ref}</span></> : null}
            {" "}&middot; {aud(shipment.cost_cents)}
          </p>
          <p>
            Dispatched {when(shipment.dispatched_at)}
            {shipment.promised_at ? <> &middot; promised {when(shipment.promised_at)}</> : <> &middot; no promise recorded</>}
          </p>
          <p className="flex items-center gap-2">
            {shipment.delivered_at
              ? <><Badge colorClass={statusTone("delivered")}>delivered</Badge> {when(shipment.delivered_at)}</>
              : <><Badge colorClass={statusTone(orderStatus)}>{orderStatus}</Badge> still in transit</>}
          </p>
          {!shipment.delivered_at && (
            <div className="pt-2">
              <Button onClick={deliver} disabled={busy}>
                {busy ? "Working..." : "Record delivery"}
              </Button>
              <span className="ml-3 text-xs text-ink-500">
                The asset ladder ends at shipped, so the units are not moved again.
              </span>
            </div>
          )}
        </div>
      )}

      {loaded && !shipment && orderStatus === "paid" && (
        <form onSubmit={ship} className="grid gap-3 sm:grid-cols-5">
          <Input placeholder="Carrier" value={form.carrier} aria-label="Carrier"
                 onChange={(e) => setForm({ ...form, carrier: e.target.value })} />
          <Input placeholder="Service (optional)" value={form.service} aria-label="Service"
                 onChange={(e) => setForm({ ...form, service: e.target.value })} />
          <Input placeholder="Tracking (optional)" value={form.tracking_ref} aria-label="Tracking reference"
                 onChange={(e) => setForm({ ...form, tracking_ref: e.target.value })} />
          <Input placeholder="Cost (AUD)" inputMode="decimal" value={form.cost} aria-label="Shipping cost"
                 onChange={(e) => setForm({ ...form, cost: e.target.value })} />
          <Input placeholder="Promised in (days)" inputMode="numeric" value={form.promised_days}
                 aria-label="Carrier's promised days"
                 onChange={(e) => setForm({ ...form, promised_days: e.target.value })} />
          <div className="sm:col-span-5 flex items-center gap-3">
            <Button type="submit" disabled={busy}>{busy ? "Working..." : "Record shipment"}</Button>
            <span className="text-xs text-ink-500">
              Moves this order and its units from sold to shipped, and puts the cost into the carrier
              table.
            </span>
          </div>
        </form>
      )}

      {loaded && !shipment && orderStatus !== "paid" && (
        <p className="text-sm text-ink-600">
          This order has not shipped. Only a <span className="font-mono text-xs">paid</span> order can
          be shipped, and this one is <span className="font-mono text-xs">{orderStatus}</span> - take
          the payment first, then come back.
        </p>
      )}
    </Card>
  );
}
