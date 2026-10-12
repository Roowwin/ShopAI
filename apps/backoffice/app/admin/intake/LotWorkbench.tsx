"use client";

/* The Lot Process workbench: find a unit, grade it, correct it, and see the lot move.

   ONE SEARCH BOX, THREE HANDLES. The operator has a lot number, an asset id or a serial, and
   which one they are holding depends on where they are standing. The box takes any of the three
   and the SERVER decides, then tells us which rule matched (`match.resolved_by`) - shown under the
   box, because a search that silently picks one reading of an ambiguous term is a search whose
   answer nobody can check.

   TWO VIEWS, ONE QUEUE. "Unfinished" is the grading queue: units with no grade still on the
   ladder. "All in lot" is the same lot with the finished units included, which is what correcting
   a grade needs. A search that resolved to a single asset shows that asset either way - the
   operator asked for it by name.

   CORRECTIONS ARE FIRST-CLASS. A grade can be replaced (pressing a different letter overwrites it)
   and a description can be edited in place. Both go through the staff ops doors that already
   audit: the grade through the grade handler - which writes the before/after pair - and the
   description through the notes handler, which exists for exactly this. Nothing on this page
   writes without a trail.

   TAKING A GRADE BACK leaves the unit's status where it is, because the database has no legal
   demotion from graded - so the row says "graded, no grade" rather than pretending otherwise, and
   the unit returns to the unfinished queue, which is `grade IS NULL` and therefore true again the
   moment the grade is cleared.

   EVERY NUMBER IS THE SERVER'S, and it is re-read after every change rather than adjusted
   locally. A progress bar that counts its own edits is a bar that can disagree with the database
   it is describing; one extra small request per press is a cheap price for never lying. */

import { useState } from "react";

import { Badge, Button, Card, Heading, Input, Table, TBody, TD, TH, THead, TR, cn } from "@/app/components/ui";
import { apiFetch } from "@/lib/api";
import { gradeTone, kickerClass, statusTone } from "@/lib/ui";

type WorkUnit = {
  id: number;
  public_id: string;
  serial_number: string | null;
  status: string;
  grade: string | null;
  product_id: number | null;
  product_title: string | null;
  product_model: string | null;
  notes: string | null;
  gradable: boolean;
  ready_for_pricing: boolean;
};

type Worklist = {
  match: { kind: "lot" | "asset"; resolved_by: string; term: string | null };
  lot: { id: number; lot_number: string; status: string; warehouse: string | null; received_at: string };
  progress: {
    total_units: number;
    received_units: number;
    graded_units: number;
    awaiting_grade_units: number;
    ready_for_pricing_units: number;
  };
  scope: Scope;
  assets: WorkUnit[];
  truncated: boolean;
  limit: number;
};

type Scope = "unfinished" | "all";

const GRADES = ["A", "B", "C", "D"] as const;

/* These buttons live inside the table's horizontal scroll region, which trims anything its
   descendants paint outside its own box - so the cue is drawn INSIDE the button's edge, and an
   inset cue carries no offset band. */
const GRADE_FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-900";

/* How the server says it read the search term, in words the operator used. */
const RESOLVED_BY: Record<string, string> = {
  lot_number: "lot number",
  asset_id: "asset id",
  serial: "serial number",
  lot_id: "lot id",
};

export default function LotWorkbench() {
  const [text, setText] = useState("");
  /* The submitted term, held apart from the box: changing the view re-runs the SAME search, and
     it must not re-run whatever is currently half-typed in the field. */
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("unfinished");
  const [list, setList] = useState<Worklist | null>(null);
  const [busy, setBusy] = useState(false);
  const [inFlight, setInFlight] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function load(term: string, nextScope: Scope) {
    setBusy(true);
    setErr("");
    try {
      const r = await apiFetch(
        `/staff/lots/worklist?q=${encodeURIComponent(term)}&scope=${nextScope}`);
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) {
        setList(null);
        setErr(typeof j.detail === "string" ? j.detail : "that search could not be read");
        return;
      }
      setList(j as Worklist);
      setSubmitted(term);
      setMsg("");
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  /* Re-reads the same search after a change, so the queue and every counter come back from the
     server rather than from this component's own arithmetic. */
  function reload(nextScope: Scope = scope) {
    if (submitted) return load(submitted, nextScope);
    return Promise.resolve();
  }

  async function quickGrade(unit: WorkUnit, grade: string | null) {
    if (inFlight !== null) return;
    setInFlight(unit.id);
    setErr("");
    setMsg("");
    try {
      /* test_first walks the one rung the ladder requires for a unit that has not been tested;
         the server records that step separately. `grade: null` is an explicit take-back. */
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
      setMsg(
        grade === null
          ? `${unit.serial_number ?? "unit " + unit.id} has no grade again - it is back in the unfinished queue.`
          : `${unit.serial_number ?? "unit " + unit.id} graded ${grade}.`,
      );
      await reload();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setInFlight(null);
    }
  }

  async function saveNotes(unit: WorkUnit) {
    if (inFlight !== null) return;
    setInFlight(unit.id);
    setErr("");
    setMsg("");
    try {
      const r = await apiFetch(`/staff/assets/${unit.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: draft }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(typeof j.detail === "string" ? j.detail : "that description was refused");
        return;
      }
      setEditing(null);
      setMsg(`Description saved for ${unit.serial_number ?? "unit " + unit.id}.`);
      await reload();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setInFlight(null);
    }
  }

  const progress = list?.progress ?? null;
  const total = progress?.total_units ?? 0;
  const graded = progress?.graded_units ?? 0;
  const pct = total > 0 ? Math.round((graded / total) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* THE HERO. This is the view the page opens on and the one a grader lives in, so it is
          first, widest and the only thing above the fold that asks for input. Stage 1 on this page
          is Import, but Import is the occasional job - grading is the daily one. */}
      <Card className="p-6 shadow-glow-sm ring-brand-100">
        <Heading level="h3" as="h2">Find a lot, asset or serial</Heading>
        <p className="mt-1 pb-4 text-sm text-ink-500">
          Type a lot number to open its grading queue, or an asset id or serial number to jump
          straight to one unit inside its lot.
        </p>
        <div className="flex flex-wrap gap-3">
          <div className="min-w-[16rem] flex-1">
            <Input
              placeholder="LOT-2026-00050, 14543, or a serial number"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); if (text.trim()) load(text.trim(), scope); }
              }}
              aria-label="Lot number, asset id or serial number"
            />
          </div>
          <Button size="lg" onClick={() => load(text.trim(), scope)} disabled={busy || !text.trim()}>
            {busy ? "Searching..." : "Open"}
          </Button>
        </div>

        {list && (
          <p className="mt-3 text-xs text-ink-500">
            Matched on{" "}
            <span className="font-semibold text-ink-600">
              {RESOLVED_BY[list.match.resolved_by] ?? list.match.resolved_by}
            </span>
            {list.match.term ? <> - <span className="font-mono">{list.match.term}</span></> : null}
            {list.match.kind === "asset" ? ", showing that unit." : `, showing lot ${list.lot.lot_number}.`}
          </p>
        )}
      </Card>

      {msg && <p className="text-brand-300 text-sm">{msg}</p>}
      {err && <p className="text-danger-600 text-sm">{err}</p>}

      {list && progress && (
        <>
          <Card className="p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Heading level="h3" as="h2">Processing Lot #{list.lot.lot_number}</Heading>
              <p className="text-sm text-ink-500">
                {progress.awaiting_grade_units} still to grade
                {list.lot.warehouse ? ` - ${list.lot.warehouse}` : ""}
              </p>
            </div>

            <p className="mt-3 text-sm font-semibold text-ink-700">
              {graded} of {total} units graded
            </p>
            {/* A progress bar needs all three of its values, and its label has to survive being
                read aloud on its own - the heading above is a separate element. */}
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

            {/* The split the brief asks for, plus the flag the pricing stage will read. Each is a
                server field; none of them is derived here. */}
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className={kickerClass}>Received</dt>
                <dd className="mt-1 text-lg font-semibold text-ink-900">{progress.received_units}</dd>
              </div>
              <div>
                <dt className={kickerClass}>Graded</dt>
                <dd className="mt-1 text-lg font-semibold text-ink-900">{progress.graded_units}</dd>
              </div>
              <div>
                <dt className={kickerClass}>Awaiting a grade</dt>
                <dd className="mt-1 text-lg font-semibold text-ink-900">{progress.awaiting_grade_units}</dd>
              </div>
              <div>
                <dt className={kickerClass}>Ready for pricing</dt>
                <dd className="mt-1 text-lg font-semibold text-ink-900">{progress.ready_for_pricing_units}</dd>
              </div>
            </dl>
          </Card>

          <Card className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Heading level="h3" as="h2">
                {list.match.kind === "asset" ? "The matching unit" : "Grading queue"}
              </Heading>
              {/* A segmented control, not a tablist: both options show the same table under one
                  heading, and there are no panels to wire. */}
              <div className="inline-flex gap-1 rounded-control bg-surface-sunken p-1 ring-1 ring-line">
                {([["unfinished", "Show Only Unfinished"], ["all", "Show All in Lot"]] as [Scope, string][]).map(
                  ([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={scope === id}
                      onClick={() => { setScope(id); reload(id); }}
                      className={cn(
                        "rounded-control px-3 py-1.5 text-xs font-semibold",
                        "transition-colors duration-fast ease-out motion-reduce:transition-none",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2",
                        scope === id ? "bg-brand-700 text-white" : "text-ink-600 hover:bg-surface",
                      )}
                    >
                      {label}
                    </button>
                  ),
                )}
              </div>
            </div>

            {list.assets.length === 0 ? (
              <p className="mt-2 text-sm text-ink-500">
                {list.match.kind === "asset"
                  ? "That unit was not found in this view."
                  : "Every unit in this lot has a grade. Switch to Show All in Lot to correct one."}
              </p>
            ) : (
              <>
                <p className="mt-1 pb-3 text-xs text-ink-500">
                  One press grades one unit and it leaves this list immediately, ready for the
                  store manager to price. Pressing a different letter replaces a grade the unit
                  already has. A unit that has not been tested is marked tested on the way through -
                  the database will not let a unit skip that step, and both steps are written to the
                  audit trail.
                </p>
                <Table label={`Units in lot ${list.lot.lot_number}`}>
                  <THead>
                    <TH>Serial</TH>
                    <TH>Model</TH>
                    <TH>Status</TH>
                    <TH>Grade</TH>
                    <TH>Description</TH>
                  </THead>
                  <TBody>
                    {list.assets.map((u) => (
                      <TR key={u.id} className={inFlight === u.id ? "opacity-50" : undefined}>
                        <TD className="font-mono text-xs">
                          {u.serial_number ?? "-"}
                          {u.ready_for_pricing && (
                            <div className="mt-1">
                              <Badge colorClass="bg-brand-50 text-brand-300">Ready for pricing</Badge>
                            </div>
                          )}
                        </TD>
                        {/* The model, falling back to the product's title: an imported product is
                            created with both set to the sheet's Model column, so one of them is
                            always there for a unit that has a product at all. */}
                        <TD className="text-ink-600">{u.product_model ?? u.product_title ?? "-"}</TD>
                        <TD><Badge colorClass={statusTone(u.status)}>{u.status}</Badge></TD>
                        <TD>
                          {u.gradable ? (
                            <div className="flex items-center gap-1">
                              {GRADES.map((g) => (
                                <button
                                  key={g}
                                  type="button"
                                  disabled={inFlight !== null}
                                  onClick={() => quickGrade(u, g)}
                                  aria-label={`Grade ${u.serial_number ?? "unit " + u.id} as ${g}`}
                                  aria-pressed={u.grade === g}
                                  className={cn(
                                    "h-7 w-7 rounded-control text-xs font-semibold",
                                    "transition-colors duration-fast ease-out motion-reduce:transition-none",
                                    "hover:opacity-80 disabled:opacity-40 disabled:pointer-events-none",
                                    GRADE_FOCUS,
                                    gradeTone(g),
                                    u.grade === g ? "ring-2 ring-inset ring-brand-900" : "",
                                  )}
                                >
                                  {g}
                                </button>
                              ))}
                              {u.grade && (
                                <button
                                  type="button"
                                  disabled={inFlight !== null}
                                  onClick={() => quickGrade(u, null)}
                                  aria-label={`Remove the grade from ${u.serial_number ?? "unit " + u.id}`}
                                  className={cn(
                                    "h-7 rounded-control px-2 text-xs font-semibold text-ink-600",
                                    "ring-1 ring-line hover:bg-surface-sunken",
                                    "transition-colors duration-fast ease-out motion-reduce:transition-none",
                                    "disabled:opacity-40 disabled:pointer-events-none",
                                    GRADE_FOCUS,
                                  )}
                                >
                                  Clear
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-ink-500">
                              {u.grade ?? "no grade"} - not gradable at {u.status}
                            </span>
                          )}
                        </TD>
                        <TD className="max-w-[18rem]">
                          {editing === u.id ? (
                            <div className="space-y-2">
                              <textarea
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                rows={3}
                                aria-label={`Description for ${u.serial_number ?? "unit " + u.id}`}
                                className={cn(
                                  "w-full rounded-control bg-surface px-3 py-2 text-xs text-ink-700",
                                  "ring-1 ring-line-strong outline-none focus-visible:ring-2 focus-visible:ring-brand-700",
                                )}
                              />
                              <div className="flex gap-2">
                                <Button size="sm" disabled={inFlight !== null} onClick={() => saveNotes(u)}>
                                  Save
                                </Button>
                                <Button size="sm" variant="muted" onClick={() => setEditing(null)}>
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-start gap-2">
                              {/* The description is whitespace-pre-line because the import writes
                                  one labelled line per source column; collapsing them would hide
                                  which column said what. */}
                              <p className="whitespace-pre-line text-xs text-ink-600">
                                {u.notes ?? <span className="text-ink-500">no description</span>}
                              </p>
                              <button
                                type="button"
                                onClick={() => { setEditing(u.id); setDraft(u.notes ?? ""); }}
                                aria-label={`Edit the description for ${u.serial_number ?? "unit " + u.id}`}
                                className={cn(
                                  "shrink-0 rounded-control p-1 text-ink-500 hover:text-brand-300",
                                  "transition-colors duration-fast ease-out motion-reduce:transition-none",
                                  GRADE_FOCUS,
                                )}
                              >
                                {/* A pencil, drawn inline: this repo has no icon package and the
                                    chrome's glyphs are all hand-rolled SVG. */}
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                     stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                                     strokeLinejoin="round" aria-hidden="true">
                                  <path d="M12 20h9" />
                                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                                </svg>
                              </button>
                            </div>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                {list.truncated && (
                  <p className="mt-3 text-xs text-ink-500">
                    Showing the first {list.limit} units. Narrow the search to see the rest.
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
