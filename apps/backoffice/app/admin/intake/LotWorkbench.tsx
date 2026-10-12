"use client";

/* The Lot Process workbench: one lot in, every unit graded, one press each.

   WHAT THIS SCREEN IS FOR. Grading used to mean finding a unit in the Asset Workbench, opening
   it, choosing a grade and saving - three navigations per unit, which is not a way to work
   through a lot of three hundred. Here the lot is the unit of work: search it by number, and the
   screen becomes the remaining queue, with a grade one press away on each row.

   THE LADDER IS REAL AND THE SCREEN SAYS SO. The database refuses `received -> graded` in one
   move (the assets trigger admits `tested -> graded`), because a unit is inspected before it is
   graded. So a press here walks the one rung the ladder requires: the server marks the unit
   tested and then graded, writing BOTH steps to the audit trail. The screen never claims to have
   done something the database did not, and it does not hide the intermediate step - the row's
   status is on screen before and after.

   EVERY NUMBER IS THE SERVER'S. `graded` and `total` come from the worklist payload's progress
   block, which counts the WHOLE lot - not the slice this screen happens to be holding. The local
   count only ever moves by one, on a response the server confirmed, so the bar cannot drift ahead
   of the database. When the payload was cut short, the screen says so instead of implying the
   queue ended.

   THE QUEUE IS THE QUEUE. A unit leaves the list when the server confirms its grade, which is why
   a press removes the row rather than leaving a stale one to be graded twice. Nothing is
   optimistic: the row stays, disabled, until the answer arrives. */

import { useState } from "react";

import { Badge, Button, Card, Heading, Input, Table, TBody, TD, TH, THead, TR, cn } from "@/app/components/ui";
import { apiFetch } from "@/lib/api";
import { gradeTone, statusTone } from "@/lib/ui";

type WorkUnit = {
  id: number;
  public_id: string;
  serial_number: string | null;
  status: string;
  grade: string | null;
  product_id: number | null;
  product_title: string | null;
};

type Worklist = {
  lot: { id: number; lot_number: string; status: string; warehouse: string | null; received_at: string };
  progress: { total_units: number; graded_units: number; awaiting_grade_units: number };
  assets: WorkUnit[];
  truncated: boolean;
  limit: number;
};

/* The four grades, in the order the eye reads them. Typed as a tuple so the map below cannot be
   widened to a value the API would refuse. */
const GRADES = ["A", "B", "C", "D"] as const;

/* These buttons live inside the table's horizontal scroll region, and a scroll region trims
   anything its descendants paint outside its own box - so the cue is drawn INSIDE the button's
   edge. An inset cue carries no offset band, which is why there is no offset class here. */
const GRADE_FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-900";

export default function LotWorkbench() {
  const [query, setQuery] = useState("");
  const [list, setList] = useState<Worklist | null>(null);
  const [busy, setBusy] = useState(false);
  /* Which row is mid-flight. The whole queue is disabled while any press is outstanding, so two
     grades can never be in the air for the same lot and the progress bar has one writer. */
  const [inFlight, setInFlight] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function find() {
    const wanted = query.trim();
    if (!wanted || busy) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const r = await apiFetch(`/staff/lots/worklist?lot_number=${encodeURIComponent(wanted)}`);
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) {
        setList(null);
        setErr(typeof j.detail === "string" ? j.detail : "that lot could not be read");
        return;
      }
      setList(j as Worklist);
      setMsg(
        j.progress.awaiting_grade_units === 0
          ? `Lot ${j.lot.lot_number} has nothing left to grade.`
          : `Lot ${j.lot.lot_number}: ${j.progress.awaiting_grade_units} unit${j.progress.awaiting_grade_units === 1 ? "" : "s"} awaiting a grade.`,
      );
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function quickGrade(unit: WorkUnit, grade: string) {
    if (inFlight !== null) return;
    setInFlight(unit.id);
    setErr("");
    try {
      /* test_first walks the one rung the ladder requires for a unit that has not been tested.
         The server records the intermediate step in the audit trail, so the unit's history shows
         the path it took rather than a jump. */
      const r = await apiFetch(`/staff/assets/${unit.id}/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grade, test_first: true }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(typeof j.detail === "string" ? j.detail : "that grade was refused");
        return;
      }
      setList((prev) =>
        prev
          ? {
              ...prev,
              progress: {
                ...prev.progress,
                graded_units: prev.progress.graded_units + 1,
                awaiting_grade_units: prev.progress.awaiting_grade_units - 1,
              },
              assets: prev.assets.filter((u) => u.id !== unit.id),
            }
          : prev,
      );
      setMsg(`${unit.serial_number ?? "unit " + unit.id} graded ${grade}.`);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setInFlight(null);
    }
  }

  const progress = list?.progress ?? null;
  const total = progress?.total_units ?? 0;
  const graded = progress?.graded_units ?? 0;
  /* Rounded for display only - the words beside it carry the exact pair, so a rounded bar can
     never be the only place a number lives. */
  const pct = total > 0 ? Math.round((graded / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <Heading level="h3" as="h2">Find a lot</Heading>
        <p className="mt-1 pb-4 text-xs text-ink-500">
          Search by lot number. The queue below is every unit in that lot still without a grade.
        </p>
        <div className="flex flex-wrap gap-3">
          <div className="min-w-[14rem] flex-1">
            <Input
              placeholder="lot number, e.g. LOT-2026-00050"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); find(); }
              }}
              aria-label="Lot number to process"
            />
          </div>
          <Button onClick={find} disabled={busy || !query.trim()}>
            {busy ? "Reading..." : "Open lot"}
          </Button>
        </div>
      </Card>

      {msg && <p className="text-brand-300 text-sm">{msg}</p>}
      {err && <p className="text-danger-600 text-sm">{err}</p>}

      {list && progress && (
        <>
          <Card className="p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Heading level="h3" as="h2">
                Processing Lot #{list.lot.lot_number}
              </Heading>
              <p className="text-sm text-ink-500">
                {progress.awaiting_grade_units} still to grade
                {list.lot.warehouse ? ` - ${list.lot.warehouse}` : ""}
              </p>
            </div>

            <p className="mt-3 text-sm font-semibold text-ink-700">
              {graded} of {total} units graded
            </p>
            {/* A progress bar needs all three of its values, and its label has to survive being
                read aloud on its own - the row's heading is a separate element. */}
            <div
              role="progressbar"
              aria-valuenow={graded}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-label={`Lot ${list.lot.lot_number} grading progress`}
              className="mt-2 h-3 w-full overflow-hidden rounded-control bg-surface-sunken ring-1 ring-line shadow-glow-sm"
            >
              <div
                className="h-full rounded-control bg-brand-500 transition-[width] duration-fast ease-out motion-reduce:transition-none"
                style={{ width: pct + "%" }}
              />
            </div>
          </Card>

          <Card className="p-6">
            <Heading level="h3" as="h2">Awaiting a grade</Heading>
            {list.assets.length === 0 ? (
              <p className="mt-2 text-sm text-ink-500">
                Every unit in this lot has a grade. Nothing is left to do here.
              </p>
            ) : (
              <>
                <p className="mt-1 pb-3 text-xs text-ink-500">
                  One press grades one unit. A unit that has not been tested is marked tested on
                  the way through - the database will not let a unit skip that step, and both
                  steps are written to the audit trail.
                </p>
                <Table label={`Units in lot ${list.lot.lot_number} awaiting a grade`}>
                  <THead>
                    <TH>Serial</TH>
                    <TH>Product</TH>
                    <TH>Status</TH>
                    <TH>Grade</TH>
                  </THead>
                  <TBody>
                    {list.assets.map((u) => (
                      <TR key={u.id} className={inFlight === u.id ? "opacity-50" : undefined}>
                        <TD className="font-mono text-xs">{u.serial_number ?? "-"}</TD>
                        <TD className="text-ink-600">{u.product_title ?? "-"}</TD>
                        <TD>
                          <Badge colorClass={statusTone(u.status)}>{u.status}</Badge>
                        </TD>
                        <TD>
                          <div className="flex gap-1">
                            {GRADES.map((g) => (
                              <button
                                key={g}
                                type="button"
                                disabled={inFlight !== null}
                                onClick={() => quickGrade(u, g)}
                                aria-label={`Grade ${u.serial_number ?? "unit " + u.id} as ${g}`}
                                className={cn(
                                  "h-7 w-7 rounded-control text-xs font-semibold",
                                  "transition-colors duration-fast ease-out motion-reduce:transition-none",
                                  "hover:opacity-80 disabled:opacity-40 disabled:pointer-events-none",
                                  GRADE_FOCUS,
                                  gradeTone(g),
                                )}
                              >
                                {g}
                              </button>
                            ))}
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                {list.truncated && (
                  <p className="mt-3 text-xs text-ink-500">
                    Showing the first {list.limit} awaiting a grade. Grade these and search the lot
                    again to see the rest.
                  </p>
                )}
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
