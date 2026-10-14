"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Card, Heading } from "@/app/components/ui";
import { when } from "@/lib/format";
import { kickerClass } from "@/lib/ui";

/* THE REMAINING LOTS: the grading queue, as cards.

   The intake page used to be a search box over an empty screen - a workstation with nothing on the
   bench until somebody typed a lot number they already knew. That is fine for a lookup and useless
   as a queue: the operator who arrives at the start of a shift does not know which lot to type. So
   the page opens on the work instead, oldest first, and the search box stays above it for the
   times somebody does know the handle.

   WHAT IT IS NOT: a dashboard. Every card is the same shape and carries only what decides which lot
   to open next - how much is left, how far along it is, and what the units are. No sparklines, no
   counters to read past.

   THE ORDER IS THE SERVER'S AND IT IS BY AGE. `received_at` ascending, so the top-left card is the
   lot that has been waiting longest; that ordering is invisible without a date on the card, which
   is why each one prints how long ago it arrived. A queue sorted oldest-first that does not say so
   looks like a queue sorted at random.

   THE MODEL LINE IS ALWAYS ABLE TO BE HONEST. Most lots are one model, but 208 in this database
   carry two or three, so the server sends up to three (brand, model, count) triples and the true
   number of models. The card names the commonest and says "+1 more" rather than printing a single
   model over a lot that is not only that. A lot whose units have no product at all says so instead
   of showing a blank where a name should be.

   A CARD IS A BUTTON, not a link: pressing it does not navigate anywhere, it opens the lot in the
   workbench below. The accessible name is set explicitly to the lot, its progress and its state -
   a button taking its name from all of its own text would announce every card as a sentence, and a
   queue is a thing you listen to in order. */

type LotModel = { brand: string; model: string; units: number };
type PendingLot = {
  id: number; lot_number: string; received_at: string;
  warehouse: string | null; zone: string | null;
  total_units: number; graded_units: number; awaiting_units: number;
  models: LotModel[]; model_kinds: number | null;
};
type Payload = { lots: PendingLot[]; total_pending_lots: number; truncated: boolean };

/* The two states a not-yet-graded lot can be in, told apart by whether anything has been graded at
   all. "Pending" is the louder of the two on purpose: nothing has happened to it yet, which is the
   one thing an operator can fix by opening it. Both are amber-vs-neutral rather than two colours,
   because neither is an error - this lot is simply work. */
const BADGE = {
  pending: "bg-accent-400/15 text-accent-700 ring-1 ring-accent-400/30",
  started: "bg-brand-500/15 text-brand-300 ring-1 ring-line",
} as const;

const CARD = "w-full rounded-card bg-surface p-5 text-left ring-1 ring-line " +
  "transition-colors duration-150 ease-out hover:ring-line-strong motion-reduce:transition-none " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300";

export default function PendingLots({ onOpen }: { onOpen: (lotNumber: string) => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await apiFetch("/staff/lots/pending");
      if (!r.ok) { setErr(r.status === 403 ? "This role cannot read the grading queue." : "The grading queue could not be read."); return; }
      setErr("");
      setData(await r.json().catch(() => null));
    } catch {
      setErr("The grading queue could not be read.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (err) {
    return (
      <Card className="p-6">
        <p className="text-sm text-danger-600">{err}</p>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card className="p-6">
        <p className="text-sm text-ink-500">Reading the grading queue...</p>
      </Card>
    );
  }
  if (data.lots.length === 0) {
    return (
      <Card className="p-6">
        <Heading level="h3" as="h2">Remaining lots</Heading>
        <p className="mt-2 text-sm text-ink-600">
          Nothing is waiting on a grade. Every lot with units in it is fully graded.
        </p>
      </Card>
    );
  }

  return (
    <section aria-label="Remaining lots" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Heading level="h3" as="h2">Remaining lots</Heading>
        {/* The count is the server's, and the sentence changes when the queue was cut short rather
            than quietly showing sixty of three thousand. */}
        <p className="text-xs text-ink-500">
          {data.truncated
            ? `${data.lots.length} of ${data.total_pending_lots.toLocaleString("en-AU")} lots still to grade, oldest first`
            : `${data.total_pending_lots} ${data.total_pending_lots === 1 ? "lot" : "lots"} still to grade, oldest first`}
        </p>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.lots.map((l) => {
          const graded = l.graded_units;
          const total = l.total_units;
          const pct = total > 0 ? Math.round((graded / total) * 100) : 0;
          const started = graded > 0;
          const first = l.models[0];
          const others = (l.model_kinds ?? 0) - 1;
          return (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => onOpen(l.lot_number)}
                aria-label={`Open lot ${l.lot_number}, ${graded} of ${total} graded, ${started ? "in progress" : "pending"}`}
                className={CARD}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="truncate font-mono text-base font-semibold text-ink-900">{l.lot_number}</p>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${started ? BADGE.started : BADGE.pending}`}>
                    {started ? "In Progress" : "Pending"}
                  </span>
                </div>

                <p className="mt-3 text-sm text-ink-700">
                  <span className="font-semibold text-ink-900">{graded}</span>
                  <span className="text-ink-500"> / {total}</span> Graded
                </p>
                <div
                  role="progressbar"
                  aria-valuenow={graded}
                  aria-valuemin={0}
                  aria-valuemax={total}
                  aria-label={`Lot ${l.lot_number} grading progress`}
                  className="mt-2 h-1.5 w-full overflow-hidden rounded-control bg-surface-sunken ring-1 ring-line"
                >
                  <div
                    className="h-full rounded-control bg-brand-500 transition-[width] duration-fast ease-out motion-reduce:transition-none"
                    style={{ width: pct + "%" }}
                  />
                </div>

                <div className="mt-3">
                  <p className={kickerClass}>Units</p>
                  <p className="mt-1 truncate text-sm text-ink-700">
                    {first
                      ? <><span className="text-ink-900">{first.brand} {first.model}</span>
                          {others > 0 ? <span className="text-ink-500"> +{others} more {others === 1 ? "model" : "models"}</span> : null}</>
                      : <span className="text-ink-500">No model on these units</span>}
                  </p>
                </div>

                <p className="mt-3 text-xs text-ink-500">
                  {l.awaiting_units} still to grade
                  {l.warehouse ? <> &middot; {l.warehouse}</> : null}
                  <> &middot; received {when(l.received_at)}</>
                </p>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
