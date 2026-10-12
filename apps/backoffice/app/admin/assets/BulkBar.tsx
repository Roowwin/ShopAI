"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { Button, Input, cn } from "@/app/components/ui";

/* The floating action bar for the workbench's selection.

   Every button here writes for real, on one existing endpoint per unit, so NOTHING fires on the
   first press: a press opens a confirmation strip, and only the second, deliberate press runs
   the batch. That is ADR 0006's rule (a confirmation stays with the human) rather than a taste
   choice - an assistant identity can reach these same endpoints through its own guard, and this
   control is the one place where a batch of them is dispatched from a single press.

   HONESTY ABOUT A PARTIAL RUN. The endpoints are per unit: there is no batch door on this API,
   so this loop sends one request per selected unit and a batch can genuinely HALF-SUCCEED - the
   database trigger that polices the lifecycle rejects an illegal step for one unit while its
   neighbour is accepted. A run therefore reports the split ("4 of 6 done - 2 failed") and names
   each failure with the API's own detail, rather than a blanket success line. The selection is
   kept when anything failed, so the remainder can be retried; it is cleared only when every
   unit in the run was written. */

export type BulkTarget = { id: number; serial_number: string | null };

type Action = "grade" | "price" | "store";

const BUTTON: Record<Action, string> = {
  grade: "Bulk grade A",
  price: "Set price",
  store: "Push to store",
};

const QUESTION: Record<Action, string> = {
  grade: "Grade every selected unit A?",
  price: "Set one sale price on every selected unit?",
  store: "List every selected unit for sale?",
};

/* What the API actually does, said before the press rather than after it. Each of these was read
   off the handler, not inferred:
   - /grade writes the grade AND moves the unit to `graded` in the same transaction (it also takes
     an optional cost, which this bar does not send);
   - /price writes the sale price alone and touches no status;
   - /status with `listed` is the only thing that makes a unit eligible for the storefront, and the
     catalog query additionally requires the unit's LOT to be active - so a listed unit in a draft
     lot stays out of the shop. That is the caveat below, and it is the reason this bar never says
     "published". */

function caveat(action: Action): string {
  if (action === "grade") { return "Grading also moves each unit to the graded state."; }
  if (action === "price") { return "This writes the price only; it does not change any status."; }
  return "A listed unit reaches the storefront only once its lot is active; in a draft lot it stays hidden.";
}

const FAIL_SHOWN = 5;

type Failure = { label: string; detail: string };
type Run = { label: string; done: number; total: number; failed: Failure[]; caveat: string };

export default function BulkBar({ targets, onDone, onClear }: {
  targets: BulkTarget[];
  /** Reload the workbench so the rows show what the run wrote. */
  onDone: () => void | Promise<void>;
  onClear: () => void;
}) {
  const [pending, setPending] = useState<Action | null>(null);
  const [price, setPrice] = useState("19900");
  const [busy, setBusy] = useState(false);
  const [guard, setGuard] = useState("");
  const [run, setRun] = useState<Run | null>(null);

  const n = targets.length;

  function ask(a: Action) {
    setRun(null); setGuard(""); setPending(a);
  }

  async function call(action: Action, id: number): Promise<Response> {
    if (action === "grade") {
      return apiFetch("/staff/assets/" + id + "/grade", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grade: "A" }),
      });
    }
    if (action === "price") {
      return apiFetch("/staff/assets/" + id + "/price", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sale_price_cents: Number(price) }),
      });
    }
    return apiFetch("/staff/assets/" + id + "/status", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "listed" }),
    });
  }

  async function fire() {
    if (!pending || busy) { return; }
    const action = pending;
    if (action === "price") {
      const cents = Number(price);
      if (price.trim() === "" || !Number.isInteger(cents) || cents < 0) {
        setGuard("The price has to be a whole number of cents, zero or more.");
        return;
      }
    }
    setGuard(""); setBusy(true);

    /* The list is snapshotted here, so a checkbox moved while the loop is in flight cannot change
       which units this run writes - the reader is told how many were in the run it started. */
    const batch = targets.slice();
    const failed: Failure[] = [];
    let done = 0;

    for (const t of batch) {
      const label = t.serial_number ?? "#" + t.id;
      try {
        const r = await call(action, t.id);
        if (r.status === 200 || r.status === 201) { done++; continue; }
        const j: any = await r.json().catch(() => ({}));
        failed.push({ label, detail: typeof j?.detail === "string" ? j.detail : "request refused (" + r.status + ")" });
      } catch {
        // A transport failure (or the session gate tearing the page away) is reported per unit
        // rather than thrown: the units after it still get their turn, and none of them reads as
        // written when it was not.
        failed.push({ label, detail: "the request could not be sent" });
      }
    }

    setBusy(false);
    setPending(null);
    setRun({ label: BUTTON[action], done, total: batch.length, failed, caveat: caveat(action) });
    await onDone();
    if (failed.length === 0) { onClear(); }
  }

  const heading = run
    ? run.failed.length === 0
      ? run.label + ": " + run.done + " of " + run.total + " done."
      : run.done === 0
        ? run.label + ": nothing was written - all " + run.total + " refused."
        : run.label + ": " + run.done + " of " + run.total + " done - " + run.failed.length + " failed."
    : "";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-2xl overflow-hidden rounded-card bg-surface-glass/90 ring-1 ring-line shadow-glow backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <p className="text-sm text-ink-900">
            <span className="font-semibold">{n}</span> {n === 1 ? "unit" : "units"} selected
          </p>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => ask("grade")}>Bulk grade A</Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => ask("price")}>Set price</Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => ask("store")}>Push to store</Button>
            <Button variant="muted" size="sm" disabled={busy} onClick={onClear}>Clear</Button>
          </div>
        </div>

        {/* The foot of the bar: the confirmation, the guard, or what the last run actually did.
            It carries its own ground so it reads as the bar's floor rather than as another row. */}
        <div className="border-t border-line bg-surface-muted px-4 py-3">
          {pending && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[16rem] flex-1">
                <p className="text-sm text-ink-900">{QUESTION[pending]} That is {n} {n === 1 ? "unit" : "units"}.</p>
                <p className="pt-1 text-xs text-ink-500">{caveat(pending)}</p>
              </div>
              {/* The width goes on a wrapper, never on the field: Input carries its own full width
                  in the base and this app has no merge step, so a width passed alongside it would
                  be decided by stylesheet order rather than by intent - which is the same reason
                  Select leaves its width to the caller. */}
              {pending === "price" && (
                <div className="w-32">
                  <Input
                    inputMode="numeric"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    aria-label="Sale price in cents"
                  />
                </div>
              )}
              <div className="flex gap-2">
                <Button size="sm" disabled={busy} onClick={fire}>{busy ? "Working..." : "Confirm"}</Button>
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => setPending(null)}>Cancel</Button>
              </div>
            </div>
          )}

          {!pending && guard && <p className="text-sm text-danger-600">{guard}</p>}

          {!pending && !guard && run && (
            <div className="space-y-1">
              <p className={cn("text-sm", run.failed.length === 0 ? "text-brand-300" : "text-danger-600")}>{heading}</p>
              {run.failed.length > 0 && (
                <ul className="space-y-0.5">
                  {run.failed.slice(0, FAIL_SHOWN).map((f, i) => (
                    <li key={i} className="text-xs text-danger-600">
                      <span className="font-mono text-ink-700">{f.label}</span> - {f.detail}
                    </li>
                  ))}
                  {run.failed.length > FAIL_SHOWN && (
                    <li className="text-xs text-ink-500">and {run.failed.length - FAIL_SHOWN} more</li>
                  )}
                </ul>
              )}
              <p className="text-xs text-ink-500">{run.caveat}</p>
            </div>
          )}

          {!pending && !guard && !run && (
            <p className="text-xs text-ink-500">
              Pick an action, then confirm it - nothing is written before that second press.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
