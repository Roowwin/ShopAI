"use client";

import { use, useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Badge, Card, Heading, Stat, Table, TBody, TD, TH, THead, TR } from "@/app/components/ui";
import { aud, when } from "@/lib/format";
import { requireRole, useMe } from "@/lib/session";
import { gradeTone, statusTone } from "@/lib/ui";
import AuditFeed from "@/app/components/dashboard/AuditFeed";

/* One unit's whole history: where it came from, where it has been, what it is worth and who it
   is held for.

   READ-ONLY. The writes that move a unit live on the assets workbench; this page only reports
   them. A movement, a reservation and an audit entry are all records of something that already
   happened, and none of them is an affordance here.

   The audit block reuses the dashboard's feed component: the asset payload carries the same
   entry keys it reads (when, actor, entity, action), so there is one renderer for audit rows
   rather than a second one grown here. */
type Asset = { id: number; public_id: string; product_id: number | null; serial_number: string | null;
               imei: string | null; status: string; grade: string | null; cost_cents: number | null;
               sale_price_cents: number | null; intake_at: string; location: string | null;
               notes: string | null; lot_id: number; updated_at: string };
type Lot = { id: number; lot_number: string; status: string; warehouse: string | null; received_at: string } | null;
type Movement = { id: number; moved_at: string; qty: number; reason: string; actor_staff_id: number | null };
type Reservation = { id: number; public_id: string; status: string; expires_at: string; created_at: string };
type AuditEntry = { at: string; actor_type: string; actor_id: number | null; entity: string;
                    action: string; entity_id: number | null };
type Detail = { asset: Asset; lot: Lot; movements: Movement[]; reservations: Reservation[]; audit: AuditEntry[] };

export default function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me, checked } = useMe();
  const allowed = requireRole(me, ["admin", "manager"]);
  const [data, setData] = useState<Detail | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const r = await apiFetch("/staff/assets/" + id);
    if (!r.ok) {
      setMsg(r.status === 403 ? "admin or manager role required"
                              : r.status === 404 ? "No asset with that id"
                              : "Could not load the asset");
      return;
    }
    setData(await r.json().catch(() => null));
  }, [id]);

  useEffect(() => {
    if (!checked || !allowed) { return; }
    void load();
  }, [checked, allowed, load]);

  const a = data?.asset;

  return (
    <main className="max-w-5xl mx-auto p-4 space-y-4 min-h-screen">
      <a href="/admin/assets" className="text-sm text-brand-700 hover:underline">&larr; Assets workbench</a>
      <Heading level="h1">
        Asset <span className="font-mono text-base">{a?.serial_number ?? "#" + id}</span>
      </Heading>

      {msg && <Card className="p-4"><p className="text-sm text-ink-600">{msg}</p></Card>}

      {checked && allowed && a && data && (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Status" value={<Badge colorClass={statusTone(a.status)}>{a.status}</Badge>} />
            <Stat label="Grade" value={a.grade
              ? <Badge colorClass={gradeTone(a.grade)}>{a.grade}</Badge>
              : <span className="text-ink-500">not graded</span>} />
            <Stat label="Cost" value={aud(a.cost_cents, "AUD")} sub="what the unit cost us" />
            <Stat label="Sale price" value={aud(a.sale_price_cents, "AUD")} sub="blank until priced" />
          </section>

          <Card className="p-4">
            <Heading level="h2" className="mb-2">Unit</Heading>
            <dl className="text-sm text-ink-600 grid gap-2 sm:grid-cols-2">
              <div><dt className="text-ink-500">Public id</dt><dd className="font-mono text-xs">{a.public_id}</dd></div>
              <div><dt className="text-ink-500">IMEI</dt><dd className="font-mono text-xs">{a.imei ?? "-"}</dd></div>
              <div><dt className="text-ink-500">Location</dt><dd>{a.location ?? "-"}</dd></div>
              <div><dt className="text-ink-500">Product</dt><dd>{a.product_id ?? "-"}</dd></div>
              <div><dt className="text-ink-500">Intake</dt><dd>{when(a.intake_at)}</dd></div>
              <div><dt className="text-ink-500">Last change</dt><dd>{when(a.updated_at)}</dd></div>
              {a.notes && <div className="sm:col-span-2"><dt className="text-ink-500">Notes</dt><dd>{a.notes}</dd></div>}
            </dl>
          </Card>

          <Card className="p-4">
            <Heading level="h2" className="mb-2">Lot</Heading>
            {data.lot ? (
              <p className="text-sm text-ink-600">
                <span className="font-mono text-ink-900">{data.lot.lot_number}</span>
                {" "}&middot; <Badge colorClass={statusTone(data.lot.status)}>{data.lot.status}</Badge>
                {data.lot.warehouse ? <span> &middot; {data.lot.warehouse}</span> : null}
                <span> &middot; received {when(data.lot.received_at)}</span>
              </p>
            ) : (
              <p className="text-sm text-ink-600">The lot this unit belongs to is missing.</p>
            )}
          </Card>

          <Card className="p-4">
            <Heading level="h2" className="mb-2">Movements</Heading>
            <Table label="Stock movements for this asset">
              <THead><TH>When</TH><TH>Quantity</TH><TH>Reason</TH><TH>Staff</TH></THead>
              <TBody>
                {data.movements.map((m) => (
                  <TR key={m.id}>
                    <TD className="whitespace-nowrap"><span className="text-ink-500">{when(m.moved_at)}</span></TD>
                    <TD className="text-right tabular-nums">{m.qty}</TD>
                    <TD><span className="text-ink-900">{m.reason}</span></TD>
                    <TD>{m.actor_staff_id ?? <span className="text-ink-500">system</span>}</TD>
                  </TR>
                ))}
                {data.movements.length === 0 && (
                  <TR><TD colSpan={4}><span className="text-ink-500">No movements recorded.</span></TD></TR>
                )}
              </TBody>
            </Table>
          </Card>

          <Card className="p-4">
            <Heading level="h2" className="mb-2">Reservations</Heading>
            <Table label="Reservations for this asset">
              <THead><TH>When held</TH><TH>Status</TH><TH>Expires</TH><TH>Reservation</TH></THead>
              <TBody>
                {data.reservations.map((r) => (
                  <TR key={r.id}>
                    <TD className="whitespace-nowrap"><span className="text-ink-500">{when(r.created_at)}</span></TD>
                    <TD><Badge colorClass={statusTone(r.status)}>{r.status}</Badge></TD>
                    <TD className="whitespace-nowrap"><span className="text-ink-500">{when(r.expires_at)}</span></TD>
                    <TD className="font-mono text-xs"><span className="text-ink-600">{r.public_id.slice(0, 8)}</span></TD>
                  </TR>
                ))}
                {data.reservations.length === 0 && (
                  <TR><TD colSpan={4}><span className="text-ink-500">Never held.</span></TD></TR>
                )}
              </TBody>
            </Table>
          </Card>

          <AuditFeed entries={data.audit} />
        </>
      )}
    </main>
  );
}
