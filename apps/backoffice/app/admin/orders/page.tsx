"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Badge, Button, Card, Heading, Input, PageHeader, Select, Stat, Table, TBody, TD, TH, THead, TR } from "@/app/components/ui";
import { aud, when } from "@/lib/format";
import { requireRole, useMe } from "@/lib/session";
import { pageClass, statusTone } from "@/lib/ui";

/* The orders browser: every order, its customer and what it is worth.

   READ-ONLY. There is no refund control and no cancel here because the API has no such door -
   refund state is shown as a badge, never actioned. The only writes this app makes live on the
   assets workbench.

   CUSTOMER EMAIL IS PII. It renders on this page and nowhere else in the app except the customer
   pages, and every request behind it is guarded server-side by require_roles("admin","manager").
   The guard below is UX: it stops the call being made at all for a session that cannot read it.

   The by-state summary and the status filter's option list both come from the payload's OWN keys
   (`Object.entries` over the API's grouped counts) - never a list re-typed here. A status the DB
   admits but this page forgot cannot exist, because there is nothing here to forget: a new enum
   value appears the day the API reports it. */
const PAGE = 25;

type Order = { id: number; public_id: string; status: string; total_cents: number; currency: string;
               placed_at: string; customer_email: string | null; item_count: number };
type Page = { total: number; orders: Order[] };
/* The one slice of /staff/overview this page needs: the grouped order counts, which supply both
   the summary rows and the filter's status keys. */
type Overview = { orders: { by_state: Record<string, number> } };

function Breakdown({ counts, onPick, active }: { counts: [string, number][]; onPick: (s: string) => void; active: string }) {
  return (
    <Card className="p-4">
      <Heading level="h3" as="h2" className="mb-2">Orders by state (30 days)</Heading>
      <Table label="Orders by state, last 30 days">
        <THead><TH>State</TH><TH>Orders</TH><TH>Filter</TH></THead>
        <TBody>
          {counts.map(([state, n]) => (
            <TR key={state}>
              <TD><Badge colorClass={statusTone(state)}>{state}</Badge></TD>
              <TD className="text-right tabular-nums">{n}</TD>
              <TD><Button variant="muted" size="inline" onClick={() => onPick(state)}>
                {active === state ? "showing" : "show"}
              </Button></TD>
            </TR>
          ))}
          {counts.length === 0 && <TR><TD colSpan={3}><span className="text-ink-500">No order states reported.</span></TD></TR>}
        </TBody>
      </Table>
    </Card>
  );
}

function Cell({ children }: { children: ReactNode }) {
  return <span className="text-ink-900">{children}</span>;
}

export default function OrdersPage() {
  const { me, checked } = useMe();
  const allowed = requireRole(me, ["admin", "manager"]);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Page | null>(null);
  const [states, setStates] = useState<[string, number][]>([]);
  const [awaiting, setAwaiting] = useState<number | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setMsg("");
    // `limit=1` because only the total is wanted: the count comes from the fulfilment queue so this
    // page and Pick & Pack cannot disagree about what "awaiting" means.
    void apiFetch("/staff/logistics/queue?limit=1")
      .then(async (r) => setAwaiting(r.ok ? ((await r.json()).total ?? 0) : null))
      .catch(() => setAwaiting(null));
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (q) p.set("q", q);
    p.set("limit", String(PAGE));
    p.set("offset", String(offset));
    const r = await apiFetch("/staff/orders?" + p.toString());
    if (!r.ok) {
      setMsg(r.status === 403 ? "admin or manager role required" : "Could not load orders");
      setData(null);
      return;
    }
    setData(await r.json().catch(() => null));
  }, [status, q, offset]);

  /* The status keys are read once from the grouped counts the overview endpoint already
     zero-fills from the DB's CHECK constraint - the same source the dashboard's table uses. */
  useEffect(() => {
    if (!checked || !allowed) { return; }
    void (async () => {
      const r = await apiFetch("/staff/overview");
      if (!r.ok) { return; }
      const j: Overview | null = await r.json().catch(() => null);
      if (j?.orders?.by_state) { setStates(Object.entries(j.orders.by_state)); }
    })();
  }, [checked, allowed]);

  useEffect(() => {
    if (!checked) { return; }
    if (!allowed) { setMsg("admin or manager role required"); return; }
    void load();
  }, [checked, allowed, load]);

  const rows = data?.orders ?? [];
  const total = data?.total ?? 0;
  const onPage = rows.reduce((sum, o) => sum + o.total_cents, 0);

  return (
    <main className={pageClass.wide}>
      <PageHeader
        title={<>Orders</>}
        description={<>Read-only. Refund state is shown, never actioned - this API has no refund door.</>}
      />

      {msg && <Card className="p-4"><p className="text-sm text-ink-600">{msg}</p></Card>}

      {checked && allowed && (
        <>
          {/* Four tiles, not three: this page is where someone looks after money has come in, and
              the question that follows immediately is "what still has to go out?". The count is the
              fulfilment queue's own total rather than a second rule computed here - a page that
              derived "needs shipping" from the state list would drift from the queue the moment the
              queue changed its mind. */}
          <section className="grid gap-4 sm:grid-cols-4">
            <Stat label="Orders (all states)" value={total} />
            <Stat label="On this page" value={rows.length} sub={`offset ${offset}`} />
            <Stat label="Value on this page" value={aud(onPage)} />
            <Stat label="Awaiting fulfilment" value={awaiting ?? "-"}
                  sub={awaiting === null ? "queue unreachable" : (awaiting ? "paid, no parcel yet" : "everything paid has a parcel")} />
          </section>

          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-ink-600">
              {awaiting === null
                ? "The fulfilment queue could not be read, so the count above is unavailable."
                : awaiting > 0
                  ? `${awaiting} paid order${awaiting === 1 ? "" : "s"} have no parcel yet.`
                  : "Every paid order has a parcel recorded."}
            </p>
            <Button variant="secondary" href="/admin/shipping">Open Pick &amp; Pack</Button>
          </Card>

          <Breakdown counts={states} active={status}
                     onPick={(s) => { setStatus(s === status ? "" : s); setOffset(0); }} />

          <Card className="p-4">
            <div className="flex flex-wrap gap-3 mb-3">
              <Select value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}>
                <option value="">any state</option>
                {states.map(([s]) => <option key={s} value={s}>{s}</option>)}
              </Select>
              <div className="w-64">
                <Input placeholder="public id or customer email" value={q}
                       onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
              </div>
            </div>
            <Table label="Orders">
              <THead><TH>Public id</TH><TH>Customer</TH><TH>State</TH><TH>Items</TH><TH>Total</TH><TH>Placed</TH></THead>
              <TBody>
                {rows.map((o) => (
                  <TR key={o.id}>
                    <TD className="font-mono text-xs">
                      <a href={"/admin/orders/" + o.id} className="text-brand-300 hover:underline">{o.public_id.slice(0, 8)}</a>
                    </TD>
                    <TD><Cell>{o.customer_email ?? "guest"}</Cell></TD>
                    <TD><Badge colorClass={statusTone(o.status)}>{o.status}</Badge></TD>
                    <TD className="text-right tabular-nums">{o.item_count}</TD>
                    <TD className="text-right tabular-nums">{aud(o.total_cents, o.currency)}</TD>
                    <TD className="whitespace-nowrap"><span className="text-ink-500">{when(o.placed_at)}</span></TD>
                  </TR>
                ))}
                {data && rows.length === 0 && (
                  <TR><TD colSpan={6}><span className="text-ink-500">No orders match.</span></TD></TR>
                )}
              </TBody>
            </Table>
            <div className="flex items-center justify-between pt-3">
              <span className="text-sm text-ink-500">
                {rows.length === 0 ? 0 : offset + 1}-{offset + rows.length} of {total}
              </span>
              <span className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={offset === 0}
                        onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
                <Button variant="secondary" size="sm" disabled={offset + rows.length >= total}
                        onClick={() => setOffset(offset + PAGE)}>Next</Button>
              </span>
            </div>
          </Card>
        </>
      )}
    </main>
  );
}
