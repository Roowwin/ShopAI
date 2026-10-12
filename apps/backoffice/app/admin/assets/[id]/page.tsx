"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Badge, Button, Card, Heading, Input, Stat, Table, TBody, TD, TH, THead, TR, cn } from "@/app/components/ui";
import { aud, when } from "@/lib/format";
import { requireRole, useMe } from "@/lib/session";
import { gradeTone, linkClass, statusTone } from "@/lib/ui";
import AuditFeed from "@/app/components/dashboard/AuditFeed";
import ImageHub, { type HubImage } from "./ImageHub";

/* One unit's whole history: where it came from, where it has been, what it is worth and who it
   is held for - and the two things an operator does to a unit that is ready for the shop.

   WHAT IS AN ACTION HERE, AND WHAT IS STILL ONLY A RECORD. A movement, a reservation and an audit
   entry remain reports of something that already happened, exactly as before. The commerce bar at
   the top and the image hub below are the exceptions, and they are deliberate: pricing a unit and
   handing it to the listing studio are the steps between "graded" and "on the storefront", and a
   page that can show a unit in that state without letting anyone move it is a page whose reader
   has to go and find the workbench to do the obvious next thing.

   THE TWO CTAs ARE GUARDED BY THE UNIT'S OWN STATE. Both doors write against the unit as a piece
   of saleable stock, so both are dead until the unit reads `graded` - a price on a unit nobody has
   graded is a guess, and a listing drafted from one is a draft about nothing. The buttons say
   which of the two reasons they are off (state, or role) rather than being greyed out silently.

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
type Detail = { asset: Asset; lot: Lot; movements: Movement[]; reservations: Reservation[];
                images: HubImage[]; grade_templates: Record<string, number | null>;
                audit: AuditEntry[] };

/* The roles the two commerce doors are behind. `manager` IS the store manager in this schema - the
   role check on `staff_users` is (admin, manager, technician, warehouse, sales) and there is no
   `store_manager` to name. The API is the wall (pricing and publishing both refuse anyone else);
   this is the same set spelled for the UI so the buttons and the doors agree. */
const COMMERCE_ROLES = ["admin", "manager"];

/* A cent field the API will accept: a whole, non-negative number. Checked here so a mistyped field
   is answered before the request rather than after the service rejects it - the same guard the
   workbench's panel carries. */
function centsGuard(v: string): boolean {
  return v.trim() !== "" && Number.isInteger(Number(v)) && Number(v) >= 0;
}

/* The API caps each sub-list it hands back - movements at 50, reservations at 50, the audit slice
   at 20 - and the payload carries no total to compare a list against. Each note below therefore
   fires when a list arrives at its cap, which is the only case in which it may have been cut
   short: a shorter list is complete by construction. A silent cut is the thing the customer
   page's own note already exists to prevent, and this page draws three lists of exactly that
   kind. */
const MOVEMENT_CAP = 50;
const RESERVATION_CAP = 50;
const AUDIT_CAP = 20;

export default function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me, checked } = useMe();
  const allowed = requireRole(me, ["admin", "manager"]);
  const canManage = requireRole(me, COMMERCE_ROLES);
  const [data, setData] = useState<Detail | null>(null);
  const [msg, setMsg] = useState("");
  const [pricing, setPricing] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch("/staff/assets/" + id);
    if (!r.ok) {
      setMsg(r.status === 403 ? "admin or manager role required"
                              : r.status === 404 ? "No asset with that id"
                              : "Could not load the asset");
      return;
    }
    const j: Detail | null = await r.json().catch(() => null);
    setData(j);
    if (j) setMsg("");
  }, [id]);

  useEffect(() => {
    if (!checked || !allowed) { return; }
    void load();
  }, [checked, allowed, load]);

  const a = data?.asset;
  /* The state guard behind both CTAs. `ready` is the whole of it: the unit has been graded, so
     there is something to price and something to write copy about. */
  const ready = a?.status === "graded";

  return (
    <main className="max-w-5xl mx-auto p-4 space-y-4 min-h-screen">
      <a href="/admin/assets" className={cn("text-sm", linkClass)}>&larr; Assets workbench</a>
      <Heading level="h1">
        Asset <span className="font-mono text-base">{a?.serial_number ?? "#" + id}</span>
      </Heading>

      {msg && <Card className="p-4"><p className="text-sm text-ink-600">{msg}</p></Card>}

      {checked && allowed && a && data && (
        <>
          {/* THE COMMERCE BAR. The two moves that take a unit from "graded" to "in the shop", put
              where the operator already is. `Generate Listing` is an ANCHOR, not a handler: the
              listing studio is a page with its own product picker, and handing it the unit in the
              query string means the destination decides what to do with it - a new tab works, and
              the back button works. */}
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-900">Take this unit to market</p>
                <p className="text-xs text-ink-500">
                  {!ready && `A unit is priced and listed once it is graded - this one is ${a.status}.`}
                  {ready && !canManage && "Pricing and listing need the store manager role."}
                  {ready && canManage && "Set the sale price, then draft the listing in the AI studio."}
                </p>
              </div>
              <Button onClick={() => setPricing(true)} disabled={!ready || !canManage}>
                Set Price
              </Button>
              {ready && canManage ? (
                <Button href={`/admin/ai/listings?asset=${a.id}`} variant="secondary">
                  Generate Listing
                </Button>
              ) : (
                <Button as="span" variant="secondary" className="opacity-50">Generate Listing</Button>
              )}
            </div>
          </Card>

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

          {/* The hub sits between the record and its history: what the unit IS, what it looks
              like, and what has happened to it. */}
          <ImageHub assetId={a.id} lotId={data.lot?.id ?? null} images={data.images ?? []}
                    templates={data.grade_templates ?? {}} canManage={canManage} onChanged={load} />

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
            {data.movements.length >= MOVEMENT_CAP && (
              <p className="pt-2 text-xs text-ink-500">Showing the 50 most recent movements.</p>
            )}
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
            {data.reservations.length >= RESERVATION_CAP && (
              <p className="pt-2 text-xs text-ink-500">Showing the 50 most recent reservations.</p>
            )}
          </Card>

          <div>
            <AuditFeed entries={data.audit} />
            {data.audit.length >= AUDIT_CAP && (
              <p className="pt-2 text-xs text-ink-500">Showing the 20 most recent activity entries.</p>
            )}
          </div>

          {pricing && (
            <PriceModal assetId={a.id} serial={a.serial_number} current={a.sale_price_cents}
                        onClose={() => setPricing(false)} onSaved={load} />
          )}
        </>
      )}
    </main>
  );
}

/* THE PRICE MODAL. A dialog, not a panel: one field, one decision, and the page behind it is the
   unit being priced.

   It carries the three things a dialog owes a keyboard: focus goes in on open and back where it
   came from on close, Escape dismisses, and a press outside the card dismisses while a press
   inside it does not. It does NOT carry the focus trap the workbench's slide-over has - that one
   hosts a whole form and a table behind a scrim, while this is a single field over a page the
   reader just came from. If a control is ever added beside the field, the trap comes with it. */
function PriceModal({ assetId, serial, current, onClose, onSaved }:
                    { assetId: number; serial: string | null; current: number | null;
                      onClose: () => void; onSaved: () => void }) {
  const card = useRef<HTMLDivElement | null>(null);
  const [price, setPrice] = useState(current === null ? "" : String(current));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    card.current?.querySelector("input")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onDown = (e: MouseEvent) => {
      if (card.current && !card.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      back?.focus?.();
    };
  }, [onClose]);

  async function save() {
    if (!centsGuard(price)) { setErr("The sale price has to be a whole number of cents, zero or more."); return; }
    setBusy(true);
    setErr("");
    try {
      const r = await apiFetch(`/staff/assets/${assetId}/price`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sale_price_cents: Number(price) }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(typeof j.detail === "string" ? j.detail : "that price was refused (" + r.status + ")");
        return;
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-surface-muted/70 backdrop-blur-sm" aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* The visible heading and the dialog's accessible name are the same words; `aria-label`
            rather than `aria-labelledby` because Heading (hand-mirrored with the storefront) takes
            no id, and widening a shared primitive for one dialog is the wrong trade. */}
        <div ref={card} role="dialog" aria-modal="true" aria-label="Set the sale price"
             className="w-full max-w-sm rounded-card bg-surface p-5 ring-1 ring-line shadow-glow">
          <Heading level="h2">Set the sale price</Heading>
          <p className="mt-1 text-xs text-ink-500">
            Unit <span className="font-mono">{serial ?? "#" + assetId}</span> &middot;{" "}
            {current === null ? "not priced yet" : aud(current, "AUD") + " now"}
          </p>
          <div className="mt-4">
            <Input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)}
                   aria-label="Sale price in cents" placeholder="e.g. 49900"
                   onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } }} />
            <p className="pt-1 text-xs text-ink-500">
              In cents, whole: 49900 is $499.00.
            </p>
          </div>
          {err && <p className="pt-2 text-sm text-danger-600">{err}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? "Saving..." : "Save price"}</Button>
          </div>
        </div>
      </div>
    </>
  );
}
