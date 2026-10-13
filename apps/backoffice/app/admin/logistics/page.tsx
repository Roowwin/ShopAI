"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Heading, PageHeader, Stat, Table, TBody, TD, TH, THead, TR, cn } from "@/app/components/ui";
import { apiFetch } from "@/lib/api";
import { aud } from "@/lib/format";
import { requireRole, useMe } from "@/lib/session";
import ReconcilePanel from "./ReconcilePanel";

/* Logistics: what needs a human today, and which carrier to use for the next parcel.

   THREE PANELS, ONE OF WHICH IS NOT FOR EVERYONE. Alerts and carrier performance are warehouse
   work, so this page opens for admin, manager and warehouse. The reconciliation panel underneath is
   finance and renders only for admin and manager - and it is a separate component for exactly that
   reason, so the role boundary is one line at the bottom of this file rather than a condition
   threaded through every card.

   NOTHING HERE IS COMPUTED. Every count, average, percentage and recommendation is a field the
   server sent; the browser groups nothing and divides nothing. The same rule the import preview
   follows, and it matters most for the carrier table: an average re-derived on the client from a
   rounded payload would disagree with the server's own arithmetic the moment the two round
   differently, and the number an operator uses to choose a carrier should have one author.

   THE THRESHOLDS ARE PRINTED, NOT TYPED. `rules` arrives with every payload and the footer reads it
   back - so a screen can never quote an "overdue" level the server stopped using.

   ALERTS ARE DERIVED ON EVERY READ, which is why this page has no "dismiss" control: there is no
   alert state to dismiss. An alert disappears when the thing causing it is fixed, and a screen that
   could hide one would be hiding a live problem. */

type Alert = {
  kind: string; severity: "critical" | "warning"; order_id: number;
  message: string; days: number; amount_cents: number; href: string;
};
type Alerts = {
  rules: Rules;
  counts: { total: number; critical: number; warning: number; by_kind: Record<string, number> };
  alerts: Alert[]; scanned: number; limit: number; truncated: boolean;
};
type Carrier = {
  carrier: string; shipments: number; delivered: number; in_transit: number; on_time: number;
  on_time_pct: number | null; avg_transit_days: number | null; avg_cost_cents: number | null;
  last_dispatched_days_ago: number | null; thin: boolean;
};
type Recommendation = {
  preference: string; carrier: string | null; why: string | null;
  fastest: { carrier: string; avg_transit_days: number; avg_cost_cents: number } | null;
  cheapest: { carrier: string; avg_cost_cents: number; avg_transit_days: number } | null;
  eligible: number; note: string | null;
};
type Carriers = {
  rules: Rules; window_days: number; shipments_in_window: number;
  carriers: Carrier[]; recommendation: Recommendation;
};
type Rules = {
  overdue_ship_days: number; promise_slip_days: number; stale_transit_days: number;
  unreconciled_days: number; abandoned_days: number; min_carrier_sample: number;
  max_combination: number; alert_kinds: Record<string, string>; note: string;
};

const PREFERENCES: { key: string; label: string }[] = [
  { key: "balanced", label: "Balanced" },
  { key: "cheapest", label: "Cheapest" },
  { key: "fastest", label: "Fastest" },
];

/* The severity tints. `critical` is the danger token the attention feed already uses for "the
   storefront path is blocked" - here it means money is in and nothing has moved, which is the same
   class of problem: the customer is waiting and the fix is ours. Everything else is the accent the
   app uses for "look at this". Colour reinforces the words; each row also states its severity. */
const SEVERITY_TONE: Record<string, string> = {
  critical: "bg-danger-50 text-danger-600",
  warning: "bg-accent-100 text-accent-700",
};

export default function LogisticsPage() {
  const { me, checked } = useMe();
  const allowed = requireRole(me, ["admin", "manager", "warehouse"]);
  const canReconcile = requireRole(me, ["admin", "manager"]);
  const [alerts, setAlerts] = useState<Alerts | null>(null);
  const [carriers, setCarriers] = useState<Carriers | null>(null);
  const [preference, setPreference] = useState("balanced");
  const [msg, setMsg] = useState("");

  const loadAlerts = useCallback(async () => {
    const r = await apiFetch("/staff/logistics/alerts");
    if (!r.ok) { setMsg(r.status === 403 ? "a logistics role is required" : "Could not load the alert feed"); return; }
    setAlerts(await r.json().catch(() => null));
  }, []);

  const loadCarriers = useCallback(async (pref: string) => {
    const r = await apiFetch("/staff/logistics/carriers?preference=" + encodeURIComponent(pref));
    if (!r.ok) { setMsg("Could not load carrier performance"); return; }
    setCarriers(await r.json().catch(() => null));
  }, []);

  useEffect(() => {
    if (!checked) { return; }
    if (!allowed) { setMsg("admin, manager or warehouse role required"); return; }
    void loadAlerts();
  }, [checked, allowed, loadAlerts]);

  useEffect(() => {
    if (!checked || !allowed) { return; }
    void loadCarriers(preference);
  }, [checked, allowed, preference, loadCarriers]);

  const rules = alerts?.rules ?? carriers?.rules;
  const rec = carriers?.recommendation;

  return (
    <main className="max-w-6xl mx-auto p-4 space-y-4 min-h-screen">
      <PageHeader
        title={<>Logistics</>}
        description={
          <>
            What needs a human today, and what each carrier actually costs and takes. Alerts are worked
            out fresh on every read - fix the order and the alert goes; there is nothing to dismiss.
          </>
        }
      />

      {msg && <Card className="p-4"><p className="text-sm text-ink-600">{msg}</p></Card>}

      {checked && allowed && alerts && (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            <Stat label="Needs attention" value={alerts.counts.total}
                  sub={alerts.counts.total ? "listed below, worst first" : "nothing is waiting on a human"} />
            <Stat label="Money in, nothing moving" value={alerts.counts.critical}
                  sub={alerts.counts.critical ? "these are the ones to fix first" : "no order is stuck that way"} />
            <Stat label="Ageing" value={alerts.counts.warning}
                  sub={alerts.counts.warning ? "late, but nobody is blocked" : "nothing is ageing"} />
          </section>

          <Card className="p-4">
            <Heading level="h2" className="mb-2">Alerts</Heading>
            {alerts.alerts.length === 0 ? (
              <p className="text-sm text-ink-600">
                Nothing needs attention: no order is paid-and-unshipped, past a carrier's promise,
                long in transit, delivered with unreconciled money, or abandoned.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {alerts.alerts.map((a) => (
                  <li key={a.kind + "-" + a.order_id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <Badge colorClass={SEVERITY_TONE[a.severity] ?? SEVERITY_TONE.warning}>
                      {a.severity === "critical" ? "critical" : a.kind.replace(/_/g, " ")}
                    </Badge>
                    <span className="min-w-0 flex-1 text-sm text-ink-900">{a.message}</span>
                    <a href={a.href} className="text-xs text-brand-300 hover:underline">Open order &rarr;</a>
                  </li>
                ))}
              </ul>
            )}
            {alerts.truncated && (
              <p className="mt-3 text-xs text-accent-700">
                The scan stops at {alerts.limit} orders and there are more - the list above is the
                oldest {alerts.limit}, not all of them.
              </p>
            )}
            <p className="mt-3 text-xs text-ink-500">
              {alerts.scanned} order{alerts.scanned === 1 ? "" : "s"} scanned for the conditions above.
            </p>
          </Card>
        </>
      )}

      {checked && allowed && carriers && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Heading level="h2" className="mb-0">Carrier performance</Heading>
            <span className="flex gap-2">
              {PREFERENCES.map((p) => (
                <Button key={p.key} size="inline"
                        variant={preference === p.key ? "primary" : "secondary"}
                        onClick={() => setPreference(p.key)}>
                  {p.label}
                </Button>
              ))}
            </span>
          </div>
          <p className="mt-2 text-xs text-ink-500">
            Measured over the last {carriers.window_days} days ({carriers.shipments_in_window} parcels),
            from delivered parcels only - a parcel still moving has no transit time to average. A
            carrier with fewer than {rules?.min_carrier_sample ?? 3} delivered parcels is shown but
            never recommended.
          </p>

          {rec && (
            <div className={cn("mt-3 rounded-card p-3 ring-1",
                               rec.carrier ? "bg-surface-muted ring-line-strong" : "bg-surface-sunken ring-line")}>
              {rec.carrier ? (
                <p className="text-sm text-ink-900">
                  <span className="font-semibold">{rec.carrier}</span> - {rec.why}.
                  {rec.note ? <span className="text-ink-500"> {rec.note}.</span> : null}
                </p>
              ) : (
                <p className="text-sm text-ink-600">
                  No recommendation yet: {rec.note}.
                </p>
              )}
              {rec.fastest && rec.cheapest && (
                <p className="mt-1 text-xs text-ink-500">
                  Fastest: {rec.fastest.carrier} ({rec.fastest.avg_transit_days} days,{" "}
                  {aud(rec.fastest.avg_cost_cents)} a parcel). Cheapest: {rec.cheapest.carrier} (
                  {aud(rec.cheapest.avg_cost_cents)}, {rec.cheapest.avg_transit_days} days).
                </p>
              )}
            </div>
          )}

          <div className="mt-3">
            <Table label="Carrier performance">
              <THead>
                <TR>
                  <TH>Carrier</TH><TH>Parcels</TH><TH>Delivered</TH><TH>On time</TH>
                  <TH>Avg transit</TH><TH>Avg cost</TH><TH>Last used</TH>
                </TR>
              </THead>
              <TBody>
                {carriers.carriers.map((c) => (
                  <TR key={c.carrier}>
                    <TD className="text-ink-900">
                      {c.carrier}
                      {c.thin && <span className="ml-2 text-xs text-ink-500">too few to judge</span>}
                    </TD>
                    <TD className="text-right tabular-nums">{c.shipments}</TD>
                    <TD className="text-right tabular-nums">{c.delivered}</TD>
                    <TD className="text-right tabular-nums">
                      {c.on_time_pct === null
                        ? <span className="text-ink-500" title="No promise date was recorded, so lateness cannot be measured">-</span>
                        : c.on_time_pct + "%"}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {c.avg_transit_days === null ? <span className="text-ink-500">-</span> : c.avg_transit_days + " d"}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {c.avg_cost_cents === null ? <span className="text-ink-500">-</span> : aud(c.avg_cost_cents)}
                    </TD>
                    <TD className="text-right tabular-nums text-ink-500">
                      {c.last_dispatched_days_ago === null ? "-" : c.last_dispatched_days_ago + " d ago"}
                    </TD>
                  </TR>
                ))}
                {carriers.carriers.length === 0 && (
                  <TR><TD colSpan={7}>
                    <span className="text-ink-500">
                      No parcels recorded in the window yet - ship an order and this fills in.
                    </span>
                  </TD></TR>
                )}
              </TBody>
            </Table>
          </div>
        </Card>
      )}

      {checked && canReconcile && <ReconcilePanel />}

      {checked && allowed && rules && (
        <p className="text-xs text-ink-500">
          The rules behind the numbers above: an order is overdue after{" "}
          {rules.overdue_ship_days} days paid, a parcel is late a day past its promise, in transit
          unaccounted for at {rules.stale_transit_days} days, and delivered money is flagged after{" "}
          {rules.unreconciled_days} days unexplained. Nothing on this page writes by itself -
          a person ships and a person confirms a match.
        </p>
      )}
    </main>
  );
}
