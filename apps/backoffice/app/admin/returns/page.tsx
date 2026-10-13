"use client";

/* RMA Manager: the queue of returns, and the screen a manager decides one on.

   REVIEW IS THE WHOLE JOB, so the detail panel puts the three things a decision needs side by side:
   what the customer said (and the photographs they attached), what the ORDER was, and what their
   HISTORY is - a first-time buyer with a fault reads differently from a fifth return in a month, and
   an operator should not have to open three screens to tell them apart.

   WHY THE PHOTOGRAPHS ARE FETCHED AS BLOBS. The staff token is a bearer header, and no `<img src>`
   can carry one; the alternative - a public image URL - would make every customer's defect
   photograph readable by anyone who ever saw the link. So each photo is fetched through the
   authenticated API door and rendered from an object URL, which is revoked when the selection
   changes so a long shift does not leak them.

   DECIDING IS NARROWER THAN READING. The warehouse reads the queue because it receives the parcels,
   but approving commits the shop to freight and a refund - admin/manager only, and the buttons say
   so rather than failing on click. */

import { useCallback, useEffect, useState } from "react";

import { Badge, Button, Card, Heading, Input, cn } from "@/app/components/ui";
import { apiFetch } from "@/lib/api";
import { aud, when } from "@/lib/format";
import { requireRole, useMe } from "@/lib/session";
import { kickerClass } from "@/lib/ui";

type Rma = {
  id: number; public_id: string; number: string; order_id: number; customer_id: number | null;
  email: string; reason: string; detail: string | null; status: string; resolution: string | null;
  carrier: string | null; tracking_ref: string | null; label_issued_at: string | null;
  decided_at: string | null; decision_note: string | null; received_at: string | null;
  created_at: string | null;
};
type Photo = { id: number; media_id: number; filename: string | null; content_type: string;
               byte_size: number };
type Label = { carrier: string; tracking_ref: string; barcode: string;
               return_to: { name: string; address: string; email: string };
               order_public_id: string | null };
type Detail = {
  request: Rma; photos: Photo[];
  history: { orders: number; returns: number; spent_cents: number;
             previous_returns: { number: string; status: string; reason: string;
                                 created_at: string | null }[] };
  order: { public_id: string; status: string; currency: string; total_cents: number;
           placed_at: string | null; ship_to_name: string | null; ship_city: string | null } | null;
  label: Label | null;
};

const REASON_LABEL: Record<string, string> = {
  defective: "Defective", wrong_item: "Wrong item", changed_mind: "Changed mind",
};
const TONE: Record<string, string> = {
  pending: "bg-status-listed-soft text-status-listed-ink",
  info_requested: "bg-surface-sunken text-ink-700",
  approved: "bg-status-sold-soft text-status-sold-ink",
  received: "bg-status-sold-soft text-status-sold-ink",
  completed: "bg-status-listed-soft text-status-listed-ink",
  denied: "bg-danger-50 text-danger-600",
  cancelled: "bg-surface-sunken text-ink-600",
};

export default function ReturnsManagerPage() {
  const { me, checked } = useMe();
  const allowed = requireRole(me, ["admin", "manager", "warehouse"]);
  const canDecide = requireRole(me, ["admin", "manager"]);

  const [rows, setRows] = useState<Rma[]>([]);
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [shots, setShots] = useState<{ name: string; url: string }[]>([]);
  const [note, setNote] = useState("");
  const [carrier, setCarrier] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const q = status ? `?status=${status}` : "";
    const r = await apiFetch(`/staff/returns${q}`);
    if (!r.ok) { setErr(`Could not read the queue (${r.status})`); setLoaded(true); return; }
    const j: any = await r.json().catch(() => ({}));
    setRows(j?.returns ?? []);
    setLoaded(true);
  }, [status]);

  const loadDetail = useCallback(async (id: number) => {
    setErr(""); setMsg(""); setDetail(null);
    const r = await apiFetch(`/staff/returns/${id}`);
    if (!r.ok) { setErr(`Could not read that return (${r.status})`); return; }
    const j: Detail = await r.json();
    setDetail(j);
    // Revoke the previous selection's object URLs before replacing them.
    setShots((old) => { old.forEach((s) => URL.revokeObjectURL(s.url)); return []; });
    const made: { name: string; url: string }[] = [];
    for (const p of j.photos) {
      const pr = await apiFetch(`/staff/returns/${id}/photos/${p.media_id}/raw`);
      if (!pr.ok) continue;
      made.push({ name: p.filename ?? `photo ${p.id}`, url: URL.createObjectURL(await pr.blob()) });
    }
    setShots(made);
  }, []);

  useEffect(() => { if (checked && allowed) void load(); }, [checked, allowed, load]);
  useEffect(() => {
    if (selected !== null) void loadDetail(selected);
  }, [selected, loadDetail]);
  useEffect(() => () => { shots.forEach((s) => URL.revokeObjectURL(s.url)); }, [shots]);

  async function act(action: "approve" | "deny" | "request_info" | "receive") {
    if (selected === null) return;
    setBusy(true); setErr(""); setMsg("");
    const path = action === "receive" ? `/staff/returns/${selected}/receive`
      : `/staff/returns/${selected}/decide`;
    const body = action === "receive" ? undefined
      : JSON.stringify({ action, note: note.trim() || null, carrier: carrier.trim() || null });
    const r = await apiFetch(path, { method: "POST",
                                     headers: body ? { "Content-Type": "application/json" } : undefined,
                                     body });
    const j: any = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(typeof j?.detail === "string" ? j.detail : `That did not work (${r.status})`); return; }
    setMsg(action === "receive"
      ? "Received - the unit is back on the refurbishment ladder for the Lot Process workbench."
      : `Recorded: ${j.request.status}` + (j.label ? ` - label ${j.label.tracking_ref} issued.` : "."));
    setNote(""); setCarrier("");
    await load(); await loadDetail(selected);
  }

  if (!checked || !loaded) {
    return <main className="mx-auto max-w-5xl px-4 pt-8"><p className="text-sm text-ink-500">Loading...</p></main>;
  }
  if (!allowed) {
    return <main className="mx-auto max-w-5xl px-4 pt-8">
      <p className="text-sm text-danger-600">Returns are an operations screen.</p></main>;
  }

  const r = detail?.request;

  return (
    <main className="mx-auto max-w-6xl px-4 pt-8 pb-24">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Heading level="h1">Returns &amp; RMA</Heading>
        <Badge colorClass="bg-surface-sunken text-ink-700">{rows.length} shown</Badge>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-xs text-ink-600" htmlFor="rma-status">Status</label>
          <select id="rma-status" value={status} onChange={(e) => setStatus(e.target.value)}
                  className="rounded-control bg-surface px-3 py-2 text-sm ring-1 ring-line">
            <option value="">All</option>
            {["pending", "info_requested", "approved", "received", "completed", "denied", "cancelled"]
              .map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {err && <p className="mb-3 text-sm text-danger-600">{err}</p>}
      {msg && <p className="mb-3 text-sm text-ink-700">{msg}</p>}

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {rows.map((row) => (
              <li key={row.id}>
                <button onClick={() => setSelected(row.id)}
                        className={cn("w-full px-4 py-3 text-left hover:bg-surface-sunken",
                                      selected === row.id && "bg-surface-sunken")}>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs text-ink-900">{row.number}</span>
                    <Badge colorClass={TONE[row.status] ?? "bg-surface-sunken text-ink-600"}>{row.status}</Badge>
                  </span>
                  <span className="mt-1 block text-sm text-ink-700">
                    {REASON_LABEL[row.reason] ?? row.reason} - order #{row.order_id}
                  </span>
                  <span className="block text-xs text-ink-500">{row.email}</span>
                </button>
              </li>
            ))}
            {rows.length === 0 && <li className="px-4 py-6 text-sm text-ink-500">No returns here.</li>}
          </ul>
        </Card>

        {!r && <Card className="p-6 text-sm text-ink-500">Select a return to review it.</Card>}

        {r && detail && (
          <div className="space-y-4">
            <Card className="p-6">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-lg font-semibold text-ink-900">{r.number}</span>
                <Badge colorClass={TONE[r.status] ?? "bg-surface-sunken text-ink-600"}>{r.status}</Badge>
                <span className="text-sm text-ink-600">
                  {REASON_LABEL[r.reason] ?? r.reason} - raised {when(r.created_at)}
                </span>
              </div>
              {r.detail && <p className="mt-3 text-body text-ink-700">&ldquo;{r.detail}&rdquo;</p>}
              {r.decision_note && (
                <p className="mt-3 text-sm text-ink-600">Decision note: {r.decision_note}</p>
              )}
            </Card>

            <div className="grid gap-4 sm:grid-cols-2">
              <Card className="p-6">
                <p className={cn(kickerClass, "block")}>The order</p>
                {detail.order ? (
                  <div className="mt-2 text-sm text-ink-700">
                    <p className="text-ink-900">#{r.order_id} - {detail.order.status}</p>
                    <p>{aud(detail.order.total_cents, detail.order.currency)} placed {when(detail.order.placed_at)}</p>
                    <p className="text-ink-600">
                      {detail.order.ship_to_name} {detail.order.ship_city}
                    </p>
                  </div>
                ) : <p className="mt-2 text-sm text-ink-500">The order is gone.</p>}
                <p className={cn(kickerClass, "mt-4 block")}>Customer history</p>
                <div className="mt-2 text-sm text-ink-700">
                  <p>{detail.history.orders} paid orders - {aud(detail.history.spent_cents)} lifetime</p>
                  <p>{detail.history.returns} return(s) raised</p>
                  {detail.history.previous_returns.slice(0, 3).map((p) => (
                    <p key={p.number} className="text-ink-500">
                      {p.number} - {p.reason} - {p.status}
                    </p>
                  ))}
                </div>
              </Card>

              <Card className="p-6">
                <p className={cn(kickerClass, "block")}>Photographs</p>
                {shots.length === 0
                  ? <p className="mt-2 text-sm text-ink-500">No photographs were attached.</p>
                  : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {shots.map((s) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={s.url} src={s.url} alt={s.name}
                             className="h-24 w-24 rounded-control object-cover ring-1 ring-line" />
                      ))}
                    </div>
                  )}
              </Card>
            </div>

            {detail.label && (
              <Card className="p-6">
                <p className={cn(kickerClass, "block")}>Return label</p>
                <p className="mt-2 text-sm text-ink-900">
                  {detail.label.carrier} - tracking <span className="font-mono">{detail.label.tracking_ref}</span>
                </p>
                <p className="text-xs text-ink-500">Issued {when(r.label_issued_at)}</p>
              </Card>
            )}

            <Card className="p-6">
              <p className={cn(kickerClass, "block")}>Decision</p>
              {!canDecide && (
                <p className="mt-2 text-sm text-ink-600">
                  Approving and denying are an administrator&apos;s or manager&apos;s call. You can still
                  record that the parcel arrived.
                </p>
              )}
              {canDecide && (
                <>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-xs text-ink-600">Note to the customer (optional)</span>
                      <Input className="mt-1" value={note} onChange={(e) => setNote(e.target.value)}
                             placeholder="e.g. replacement authorised" />
                    </label>
                    <label className="block">
                      <span className="text-xs text-ink-600">Return carrier (optional - defaults to the one that delivered it)</span>
                      <Input className="mt-1" value={carrier} onChange={(e) => setCarrier(e.target.value)}
                             placeholder="e.g. Australia Post" />
                    </label>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button onClick={() => act("approve")} disabled={busy}>Approve &amp; issue label</Button>
                    <Button onClick={() => act("request_info")} disabled={busy}>Ask for more info</Button>
                    <Button onClick={() => act("deny")} disabled={busy}>Deny</Button>
                  </div>
                </>
              )}
              <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                <Button onClick={() => act("receive")} disabled={busy}>
                  Mark parcel received
                </Button>
                <span className="self-center text-xs text-ink-500">
                  Received units go to the Lot Process workbench to be re-graded - relisted or scrapped.
                </span>
              </div>
            </Card>
          </div>
        )}
      </div>
    </main>
  );
}
