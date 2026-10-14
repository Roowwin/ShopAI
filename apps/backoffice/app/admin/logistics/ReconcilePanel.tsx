"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Heading, Input, Stat, Table, TBody, TD, TH, THead, TR, cn } from "@/app/components/ui";
import { apiFetch } from "@/lib/api";
import { aud } from "@/lib/format";

/* Reconciliation: is every bank credit explained, and by which orders?

   WHO SEES THIS. It renders only for admin and manager - the parent page owns that condition - and
   the API enforces it again behind every call. A bank statement is the one artefact on this platform
   that is nobody else's business.

   THE MATCH IS CONFIRMED BY A PERSON, AND THE BUTTON SAYS WHAT IT WILL DO. The suggestions are
   ranked by the server and each one shows its working (which payments, what they add up to, how the
   dates and the bank's own reference agree); the operator reads that and presses Confirm. This
   panel does not auto-match on load, does not match on a timer, and does not quietly pick the top
   suggestion - a wrong match moves money in the accounts and the whole point of the ranked list is
   that a human can check it in a second.

   THE AMOUNT IS PARSED HERE AND CHECKED THERE. The credit's amount is typed in dollars and converted
   to cents in this file, because that is user input rather than a payload number. Whether the
   payments chosen actually balance is the SERVER's question, and it answers with both figures when
   they do not - the panel prints that refusal rather than second-guessing it. */

type Suggestion = {
  payment_ids: number[]; order_ids: number[]; total_cents: number; score: number;
  confidence: string; reasons: string[];
};
type Payout = {
  payout_id: number; public_id: string; bank_ref: string; amount_cents: number;
  received_on: string; note: string | null; matched_cents: number; matched_payments: number;
  unmatched_cents: number; settled: boolean;
};
type Payouts = {
  payouts: Payout[];
  unmatched_payments: { count: number; cents: number };
};
type Matches = { payout: Payout; candidates: number; window_days: number;
                 suggestions: Suggestion[]; suggestion_total: number };

/* The three bands the server names. The colours are the app's own caution/confirm pair - a `strong`
   match is the one the reference confirms and wears the brand tone, not the danger tint, because a
   good match is not an emergency. */
const CONFIDENCE_TONE: Record<string, string> = {
  strong: "bg-brand-100 text-brand-300",
  likely: "bg-surface-sunken text-ink-600",
  possible: "bg-accent-100 text-accent-700",
};

export default function ReconcilePanel() {
  const [data, setData] = useState<Payouts | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ bank_ref: "", amount: "", received_on: "", note: "" });
  const [openFor, setOpenFor] = useState<number | null>(null);
  const [matches, setMatches] = useState<Matches | null>(null);

  const load = useCallback(async () => {
    const r = await apiFetch("/staff/logistics/payouts");
    if (!r.ok) { setMsg(r.status === 403 ? "admin or manager role required" : "Could not load payouts"); return; }
    setData(await r.json().catch(() => null));
  }, []);

  useEffect(() => { void load(); }, [load]);

  /* Today's date as the default for the credit's landing date, set AFTER mount rather than in the
     useState initialiser: this component is server-rendered first, and a date computed on the
     server would disagree with the client's at midnight or across a timezone, which React reports
     as a hydration mismatch. Empty on the server, filled by the browser, is the version that cannot
     disagree with itself. */
  useEffect(() => {
    setForm((f) => (f.received_on ? f : { ...f, received_on: new Date().toISOString().slice(0, 10) }));
  }, []);

  async function record(e: React.FormEvent) {
    e.preventDefault();
    if (busy) { return; }
    setBusy(true); setErr(""); setMsg("");
    try {
      const dollars = Number(form.amount);
      if (!form.bank_ref.trim()) { setErr("A bank reference is required - it is what makes re-entry safe."); return; }
      if (!(dollars > 0)) { setErr("A credit is a positive amount."); return; }
      const r = await apiFetch("/staff/logistics/payouts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bank_ref: form.bank_ref.trim(),
                               amount_cents: Math.round(dollars * 100),
                               received_on: form.received_on || undefined,
                               note: form.note || null }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(typeof j.detail === "string" ? j.detail : "the credit could not be recorded"); return; }
      setMsg(`Recorded ${aud(j.amount_cents)} as ${j.bank_ref}.`);
      setForm({ bank_ref: "", amount: "", received_on: "", note: "" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function findMatches(payout_id: number) {
    setErr(""); setMsg("");
    const r = await apiFetch(`/staff/logistics/payouts/${payout_id}/matches`);
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(typeof j.detail === "string" ? j.detail : "could not rank the matches"); return; }
    setOpenFor(payout_id);
    setMatches(j as Matches);
  }

  async function confirm(payout_id: number, payment_ids: number[]) {
    if (busy) { return; }
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await apiFetch(`/staff/logistics/payouts/${payout_id}/match`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_ids }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(typeof j.detail === "string" ? j.detail : "that match was refused"); return; }
      setMsg(`Matched ${payment_ids.length} payment${payment_ids.length === 1 ? "" : "s"} to ${j.payout.bank_ref}.`);
      setOpenFor(null); setMatches(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const payouts = data?.payouts ?? [];

  return (
    <Card className="p-4">
      <Heading level="h2" className="mb-2">Bank reconciliation</Heading>
      <p className="mt-1 text-xs text-ink-500">
        Every credit on the statement should end up explained by the orders it settled. The matcher
        offers the ways a credit could match - exact amounts only, one order or a basket - and a
        person confirms one. Nothing is matched automatically.
      </p>

      {msg && <p className="mt-3 text-sm text-brand-300">{msg}</p>}
      {err && <p className="mt-3 text-sm text-danger-600">{err}</p>}

      {data && (
        <section className="mt-3 grid gap-4 sm:grid-cols-2">
          <Stat label="Credits recorded" value={payouts.length}
                sub={payouts.length ? `${payouts.filter((p) => p.settled).length} fully explained` : "none yet"} />
          <Stat label="Payments with no credit behind them" value={data.unmatched_payments.count}
                sub={data.unmatched_payments.count ? aud(data.unmatched_payments.cents) + " taken and unexplained"
                                                   : "every completed payment is reconciled"} />
        </section>
      )}

      <form onSubmit={record} className="mt-4 grid gap-3 sm:grid-cols-4">
        <Input placeholder="Bank reference" value={form.bank_ref} aria-label="Bank reference"
               onChange={(e) => setForm({ ...form, bank_ref: e.target.value })} />
        <Input placeholder="Amount (AUD)" inputMode="decimal" value={form.amount} aria-label="Credit amount"
               onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        <Input type="date" value={form.received_on} aria-label="Date the credit landed"
               onChange={(e) => setForm({ ...form, received_on: e.target.value })} />
        <Button type="submit" disabled={busy}>{busy ? "Working..." : "Record a credit"}</Button>
      </form>

      <div className="mt-4">
        <Table label="Bank credits">
          <THead>
            <TH>Reference</TH><TH>Landed</TH><TH>Amount</TH><TH>Explained by</TH>
            <TH>Left to explain</TH><TH>Matches</TH>
          </THead>
          <TBody>
            {payouts.map((p) => (
              <TR key={p.payout_id}>
                <TD className="font-mono text-xs text-ink-600">{p.bank_ref}</TD>
                <TD className="text-ink-600">{p.received_on}</TD>
                <TD className="text-right tabular-nums">{aud(p.amount_cents)}</TD>
                <TD className="text-right tabular-nums">
                  {p.matched_payments === 0
                    ? <span className="text-ink-500">nothing yet</span>
                    : `${p.matched_payments} payment${p.matched_payments === 1 ? "" : "s"} (${aud(p.matched_cents)})`}
                </TD>
                <TD className={cn("text-right tabular-nums",
                                  p.settled ? "text-ink-500" : "font-semibold text-accent-700")}>
                  {p.settled ? "balanced" : aud(p.unmatched_cents)}
                </TD>
                <TD>
                  <Button size="inline" variant="secondary" disabled={busy || p.settled}
                          onClick={() => findMatches(p.payout_id)}>
                    {p.settled ? "settled" : "find matches"}
                  </Button>
                </TD>
              </TR>
            ))}
            {payouts.length === 0 && (
              <TR><TD colSpan={6}>
                <span className="text-ink-500">
                  No credits recorded yet. Enter one from the bank statement above.
                </span>
              </TD></TR>
            )}
          </TBody>
        </Table>
      </div>

      {matches && openFor !== null && (
        <section className="mt-4 rounded-card bg-surface-muted p-3 ring-1 ring-line-strong">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink-900">
              <span className="font-mono text-xs">{matches.payout.bank_ref}</span> &middot;{" "}
              {aud(matches.payout.amount_cents)} &middot; {matches.candidates} unexplained
              payment{matches.candidates === 1 ? "" : "s"} within {matches.window_days} days
            </p>
            <Button size="inline" variant="muted" onClick={() => { setOpenFor(null); setMatches(null); }}>
              close
            </Button>
          </div>

          {matches.suggestions.length === 0 ? (
            <p className="mt-2 text-sm text-ink-600">
              Nothing in that window adds up to this credit exactly. It may belong to an order paid
              before the window, or be a fee or a refund rather than a sale.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {matches.suggestions.map((s) => (
                <li key={s.payment_ids.join("-")} className="flex flex-wrap items-start gap-3 py-2.5">
                  <Badge colorClass={CONFIDENCE_TONE[s.confidence] ?? CONFIDENCE_TONE.likely}>
                    {s.confidence} match
                  </Badge>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-ink-900">
                      {s.order_ids.length === 1
                        ? `Order #${s.order_ids[0]}`
                        : `${s.order_ids.length} orders: ${s.order_ids.map((o) => "#" + o).join(", ")}`}
                      {" "}&middot; {aud(s.total_cents)}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-500">{s.reasons.join(". ")}.</span>
                  </span>
                  <Button size="inline" disabled={busy}
                          onClick={() => confirm(matches.payout.payout_id, s.payment_ids)}>
                    Confirm
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {matches.suggestion_total > matches.suggestions.length && (
            <p className="mt-2 text-xs text-ink-500">
              Showing the top {matches.suggestions.length} of {matches.suggestion_total} ways this
              credit could match.
            </p>
          )}
        </section>
      )}
    </Card>
  );
}
