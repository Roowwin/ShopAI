"use client";

/* The P&L report: revenue, what the stock cost, what running the place cost, and what is left.

   THE ARITHMETIC IS THE SERVER'S. Every figure here - revenue, cost of goods, expenses, both
   profits - is a field `GET /staff/finance/pnl` returned. This page draws them; it does not add
   them up. A screen that recomputed the net would be a second answer to the question the statement
   exists to answer, and the two would disagree the first time a rule changed on one side.

   GST IS SHOWN BESIDE REVENUE, NEVER INSIDE IT. The tax collected is money held for the tax office,
   not income, and a report that folded it in would overstate profit by the tax rate on every line.
   The server already keeps it out; this page labels it so an operator is not left wondering where
   it went.

   THE PERIOD IS A CLOSED SET OF CHOICES plus a custom range, rather than two bare date fields.
   "Last quarter" is a thing an owner says and "2026-07-01 to 2026-09-30" is what it means; offering
   both means the common question is one press and the unusual one is still possible. The quarters
   are the CALENDAR quarters, named here rather than computed silently.

   NO CHART LIBRARY. The bars are divs sized from the payload's own numbers, so the picture cannot
   contradict the tiles beside it. Their widths are proportional to the LARGEST bar, which is
   revenue - a bar chart that normalised each row to itself would draw a $200 expense the same width
   as $20,000 of revenue and be worse than no picture at all. */

import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge, Button, Card, Heading, Input, PageHeader, Select, Stat, cn } from "@/app/components/ui";
import { apiFetch } from "@/lib/api";
import { aud } from "@/lib/format";
import { requireRole, useMe } from "@/lib/session";
import { kickerClass } from "@/lib/ui";

type Pnl = {
  from: string; to: string;
  revenue_cents: number; goods_cents: number; shipping_income_cents: number;
  gst_collected_cents: number; cogs_cents: number; gross_profit_cents: number;
  expenses_cents: number; net_profit_cents: number;
  counts: { invoices: number; units_sold: number; expenses: number };
};

type Period = "this_month" | "last_month" | "this_quarter" | "last_quarter" | "custom";

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/* The first and last day of the calendar quarter containing `d`, or the one before it. */
function quarterRange(d: Date, previous: boolean): [string, string] {
  let q = Math.floor(d.getMonth() / 3);
  let year = d.getFullYear();
  if (previous) { q -= 1; if (q < 0) { q = 3; year -= 1; } }
  return [iso(new Date(Date.UTC(year, q * 3, 1))), iso(new Date(Date.UTC(year, q * 3 + 3, 0)))];
}

function monthRange(d: Date, previous: boolean): [string, string] {
  const year = previous && d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
  const m = previous ? (d.getMonth() + 11) % 12 : d.getMonth();
  return [iso(new Date(Date.UTC(year, m, 1))), iso(new Date(Date.UTC(year, m + 1, 0)))];
}

function rangeFor(p: Period, custom: { from: string; to: string }): [string, string] {
  const now = new Date();
  switch (p) {
    case "last_month": return monthRange(now, true);
    case "this_quarter": return quarterRange(now, false);
    case "last_quarter": return quarterRange(now, true);
    case "custom": return [custom.from, custom.to];
    default: return monthRange(now, false);
  }
}

export default function ProfitAndLossPage() {
  const { me, checked } = useMe();
  const allowed = requireRole(me, ["admin"]);

  const [period, setPeriod] = useState<Period>("this_month");
  const [custom, setCustom] = useState(() => {
    const [f, t] = monthRange(new Date(), false);
    return { from: f, to: t };
  });
  const [pnl, setPnl] = useState<Pnl | null>(null);
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);

  const [from, to] = useMemo(() => rangeFor(period, custom), [period, custom]);

  const load = useCallback(async () => {
    setErr("");
    const r = await apiFetch(`/staff/finance/pnl?from=${from}&to=${to}`);
    if (!r.ok) {
      const j: any = await r.json().catch(() => ({}));
      setErr(typeof j?.detail === "string" ? j.detail
        : r.status === 403 ? "the books are the owner's - admin role required" : `Could not read the P&L (${r.status})`);
      setLoaded(true);
      return;
    }
    setPnl(await r.json().catch(() => null));
    setLoaded(true);
  }, [from, to]);

  useEffect(() => {
    if (!checked) return;
    if (!allowed) { setLoaded(true); return; }
    void load();
  }, [checked, allowed, load]);

  if (!checked || !loaded) {
    return <main className="mx-auto max-w-5xl px-4 pt-8 pb-16"><p className="text-sm text-ink-500">Loading...</p></main>;
  }
  if (!allowed) {
    return (
      <main className="mx-auto max-w-5xl px-4 pt-8 pb-16">
        <Card className="p-6">
          <Heading level="h3" as="h2">Profit &amp; loss</Heading>
          <p className="mt-2 text-sm text-ink-500">
            The statement of what the business earned and spent is an administrator's screen.
            Your role is {me?.role ?? "unknown"}.
          </p>
        </Card>
      </main>
    );
  }

  const scale = Math.max(pnl?.revenue_cents ?? 0, 1);
  const steps: { label: string; cents: number; tone: string; sign: string }[] = pnl ? [
    { label: "Revenue (goods + shipping)", cents: pnl.revenue_cents, tone: "bg-brand-500", sign: "" },
    { label: "Cost of goods sold", cents: pnl.cogs_cents, tone: "bg-accent-400", sign: "less" },
    { label: "Gross profit", cents: pnl.gross_profit_cents, tone: "bg-brand-700", sign: "" },
    { label: "Operating expenses", cents: pnl.expenses_cents, tone: "bg-accent-400", sign: "less" },
    { label: "Net profit", cents: pnl.net_profit_cents, tone: pnl.net_profit_cents >= 0 ? "bg-brand-700" : "bg-danger-600", sign: "" },
  ] : [];

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 pt-8 pb-16">
      <PageHeader
        title={<>Profit &amp; loss</>}
        description={
          <>
            {pnl ? `${pnl.from} to ${pnl.to}` : `${from} to ${to}`} - a statement of what the
            business earned and spent. GST collected is shown beside revenue, never inside it.
          </>
        }
        actions={
          <>
            <div>
              <label htmlFor="period" className={cn(kickerClass, "block pb-1")}>Period</label>
              <Select id="period" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
                <option value="this_month">This month</option>
                <option value="last_month">Last month</option>
                <option value="this_quarter">This quarter</option>
                <option value="last_quarter">Last quarter</option>
                <option value="custom">Custom range</option>
              </Select>
            </div>
            {period === "custom" && (
              <>
                <div>
                  <label htmlFor="from" className={cn(kickerClass, "block pb-1")}>From</label>
                  <Input id="from" type="date" value={custom.from}
                         onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
                </div>
                <div>
                  <label htmlFor="to" className={cn(kickerClass, "block pb-1")}>To</label>
                  <Input id="to" type="date" value={custom.to}
                         onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
                </div>
              </>
            )}
            <Button variant="secondary" onClick={() => { void load(); }}>Refresh</Button>
          </>
        }
      />

      {err && <p className="text-sm text-danger-600">{err}</p>}

      {pnl && (
        <>
          <section className="grid gap-4 sm:grid-cols-4">
            <Stat label="Revenue" value={aud(pnl.revenue_cents)} sub={`${pnl.counts.invoices} invoice(s) in the period`} />
            <Stat label="Gross profit" value={aud(pnl.gross_profit_cents)}
                  sub={pnl.revenue_cents ? `${((pnl.gross_profit_cents / pnl.revenue_cents) * 100).toFixed(1)}% of revenue` : "no revenue in the period"} />
            <Stat label="Operating expenses" value={aud(pnl.expenses_cents)} sub={`${pnl.counts.expenses} expense(s)`} />
            <Stat label="Net profit" value={aud(pnl.net_profit_cents)}
                  sub={pnl.net_profit_cents >= 0 ? "the period made money" : "the period lost money"} />
          </section>

          <Card className="p-6">
            <Heading level="h3" as="h2" className="mb-4">The period, step by step</Heading>
            <ul className="space-y-3">
              {steps.map((s) => (
                <li key={s.label}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-ink-700">
                      {s.sign && <span className="text-ink-500">{s.sign} </span>}{s.label}
                    </span>
                    <span className={cn("tabular-nums font-medium", s.cents < 0 ? "text-danger-600" : "text-ink-900")}>
                      {aud(s.cents)}
                    </span>
                  </div>
                  {/* Width is proportional to the LARGEST step, so a row cannot draw itself the size
                      of revenue. A negative step gets no bar rather than a backwards one. */}
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-sunken">
                    <div className={cn("h-full rounded-full", s.tone)}
                         style={{ width: `${Math.max(0, Math.min(100, (Math.abs(s.cents) / scale) * 100))}%` }} />
                  </div>
                </li>
              ))}
            </ul>

            <dl className="mt-6 grid gap-x-6 gap-y-2 border-t border-line pt-4 text-sm sm:grid-cols-2">
              <div className="flex justify-between"><dt className="text-ink-500">Goods</dt><dd className="tabular-nums">{aud(pnl.goods_cents)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500">Shipping income</dt><dd className="tabular-nums">{aud(pnl.shipping_income_cents)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500">GST collected (not income)</dt><dd className="tabular-nums text-ink-600">{aud(pnl.gst_collected_cents)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500">Units sold</dt><dd className="tabular-nums">{pnl.counts.units_sold}</dd></div>
            </dl>

            <p className="mt-4 text-xs text-ink-500">
              Revenue is read from invoices rather than orders: a voided invoice is not income, and a
              paid order that was never invoiced is a bookkeeping gap to be seen rather than quietly
              counted. Cost of goods is the recorded cost basis of each unit sold, and falls back to
              its settlement cost where no cost was recorded.
            </p>
          </Card>

          {pnl.revenue_cents === 0 && pnl.expenses_cents === 0 && (
            <Card className="p-4">
              <p className="text-sm text-ink-600">
                Nothing was invoiced and nothing was spent in this period.{" "}
                <Badge colorClass="bg-surface-sunken text-ink-600">empty period</Badge>
              </p>
            </Card>
          )}
        </>
      )}
    </main>
  );
}
