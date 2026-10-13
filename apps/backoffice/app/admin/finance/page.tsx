"use client";

/* Financials: the seat in the rail, and the month's headline in one screen.

   WHY A LANDING PAGE AND NOT A BARE MENU. "Financials" is a place an operator goes to find out how
   the business is doing, and a page that only listed three links would answer "where do I go" while
   leaving "how are we doing" for three more clicks. The current month's statement is the smallest
   useful answer, and the three registers are one press away from it.

   THE FIGURES ARE THE P&L'S OWN. This page asks the same endpoint the report does, over the current
   month, and renders what comes back - so the headline here and the statement behind the link can
   never disagree about what the month made. */

import { useCallback, useEffect, useState } from "react";

import { Card, Heading, Stat } from "@/app/components/ui";
import { apiFetch } from "@/lib/api";
import { aud } from "@/lib/format";
import { requireRole, useMe } from "@/lib/session";
import { cn } from "@/app/components/ui";
import { kickerClass } from "@/lib/ui";

type Pnl = {
  from: string; to: string; revenue_cents: number; cogs_cents: number;
  gross_profit_cents: number; expenses_cents: number; net_profit_cents: number;
  gst_collected_cents: number;
  counts: { invoices: number; units_sold: number; expenses: number };
};

const LINKS = [
  { href: "/admin/finance/invoices", label: "Invoices",
    blurb: "Every document issued, filtered by date, customer and amount - and the printable tax invoice behind each one." },
  { href: "/admin/finance/expenses", label: "Expenses",
    blurb: "Record what the business spends, and correct a figure that was entered wrong." },
  { href: "/admin/finance/pnl", label: "P&L report",
    blurb: "Revenue, cost of goods, operating expenses and what is left, over any month or quarter." },
];

export default function FinancialsPage() {
  const { me, checked } = useMe();
  const allowed = requireRole(me, ["admin"]);

  const [pnl, setPnl] = useState<Pnl | null>(null);
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch("/staff/finance/pnl");
    if (!r.ok) {
      const j: any = await r.json().catch(() => ({}));
      setErr(typeof j?.detail === "string" ? j.detail : `Could not read the month (${r.status})`);
      setLoaded(true); return;
    }
    setPnl(await r.json().catch(() => null));
    setLoaded(true);
  }, []);

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
          <Heading level="h3" as="h2">Financials</Heading>
          <p className="mt-2 text-sm text-ink-500">
            The statement of what the business earned and spent is an administrator&apos;s screen.
            Your role is {me?.role ?? "unknown"}.
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 pt-8 pb-16">
      <div>
        <Heading level="h1">Financials</Heading>
        <p className="mt-1 text-sm text-ink-500">
          {pnl ? `This month so far: ${pnl.from} to ${pnl.to}.` : "The month to date."}
        </p>
      </div>

      {err && <p className="text-sm text-danger-600">{err}</p>}

      {pnl && (
        <section className="grid gap-4 sm:grid-cols-4">
          <Stat label="Revenue" value={aud(pnl.revenue_cents)} sub={`${pnl.counts.invoices} invoice(s)`} />
          <Stat label="Cost of goods" value={aud(pnl.cogs_cents)} sub={`${pnl.counts.units_sold} unit(s) sold`} />
          <Stat label="Expenses" value={aud(pnl.expenses_cents)} sub={`${pnl.counts.expenses} recorded`} />
          <Stat label="Net profit" value={aud(pnl.net_profit_cents)}
                sub={pnl.net_profit_cents >= 0 ? "the month is ahead" : "the month is behind"} />
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {LINKS.map((l) => (
          <Card key={l.href} href={l.href} interactive className="p-5">
            <p className={cn(kickerClass, "block")}>Open</p>
            <p className="mt-1 text-base font-semibold text-ink-900">{l.label}</p>
            <p className="mt-2 text-sm text-ink-600">{l.blurb}</p>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <p className="text-xs text-ink-500">
          Revenue is read from issued invoices, so a voided document is not income and a paid order
          that was never invoiced shows as a gap rather than being counted. Cost of goods is each
          sold unit&apos;s recorded cost basis. GST collected is reported on the statement beside
          revenue and never inside it - it is money held for the tax office, not income.
        </p>
      </Card>
    </main>
  );
}
