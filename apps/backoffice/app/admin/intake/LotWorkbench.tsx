"use client";

/* THE GRADING WORKSTATION. One search box, one table, six columns, and nothing else.

   A SEARCH IS A DOOR INTO A LOT. Whichever handle the operator has - a lot number, an asset id, a
   serial - the answer is the WHOLE LOT that handle belongs to. Searching a serial and getting one
   row back hid the context a grader needs: a unit is almost never inspected alone, and the units
   around it are usually in the same box. So an asset-id or serial match resolves to its lot and
   comes back as the full list, with the unit that was actually named reported separately as
   `highlight_asset_id` - the table marks that row so the eye lands on it without hunting.

   THE TABLE IS THE BRIEF'S, in the brief's order: Asset ID, Lot, Class, Model, Upgrade
   Description, Grade. Nothing was added to it. Serial and status are not columns any more - the
   serial the operator typed is echoed in the banner above the table, and the status is not
   something the grader acts on.

   EVERY EDIT SAVES IMMEDIATELY, through the doors that already audit:

   * the grade through the grade handler (with `test_first`, so a unit that has not been tested is
     walked up the one rung the database requires, that step written to the trail as well);
   * the description through the notes handler, which keeps a before/after pair.

   There is no Save button because there is no state to forget to save: the description writes on
   blur or on Enter, the grade writes on the press. A failed write puts the row back the way the
   server has it rather than leaving the screen disagreeing with the database.

   KEYBOARD. A grader works down a list, so the keyboard does too: after a grade lands, focus moves
   to the SAME grade button on the next row, which makes a pass down a lot one keypress per unit.
   Up and Down arrows walk the same column between rows, and Tab reaches everything else.

   THE GRADE CONTROL SAYS WHICH GRADE THE UNIT HOLDS. Four buttons that all look alike answer "what
   grades exist", never "what is this unit", so the grade the row carries is drawn BRIGHT and the
   other three are dimmed - see GRADE_ACTIVE/GRADE_IDLE. The bright state moves on the press rather
   than on the round trip: the request is still the only thing that writes a grade, but the operator
   grading down a list reads that chip to know where they are, and a chip that lags a request behind
   the row above it is a chip they cannot trust. */

import { useCallback, useRef, useState } from "react";

import { Badge, Button, Card, Heading, Input, Table, TBody, TD, TH, THead, TR, cn } from "@/app/components/ui";
import { apiFetch } from "@/lib/api";
import { kickerClass } from "@/lib/ui";

type WorkUnit = {
  id: number;
  public_id: string;
  serial_number: string | null;
  status: string;
  grade: string | null;
  product_id: number | null;
  product_title: string | null;
  product_model: string | null;
  category: string | null;
  notes: string | null;
  gradable: boolean;
  ready_for_pricing: boolean;
};

type Worklist = {
  match: { kind: "lot" | "asset"; resolved_by: string; term: string | null };
  highlight_asset_id: number | null;
  lot: { id: number; lot_number: string; status: string; warehouse: string | null; received_at: string };
  progress: {
    total_units: number;
    received_units: number;
    graded_units: number;
    awaiting_grade_units: number;
    ready_for_pricing_units: number;
  };
  assets: WorkUnit[];
  truncated: boolean;
  limit: number;
};

const GRADES = ["A", "B", "C", "D"] as const;

/* The grade buttons sit inside the table's horizontal scroll region, which trims anything its
   descendants paint outside its own box - so the cue is drawn INSIDE the button's edge. */
const GRADE_FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-900";

/* The two states of a grade button, as classes rather than `gradeTone`: that helper paints ONE
   colour per grade for a chip that NAMES a grade, and it paints all four of these the same, which
   is precisely the state this control could not show.

   ACTIVE - the brand's saturated emerald, which is `emerald-500` by value, under the dark ink. White
   on that step measures 2.5:1 and is not text; `ink-inverse` is the token this palette keeps for
   exactly this pairing (Button's `accent` variant is the same shape in amber). `shadow-glow-sm` is
   the config's emerald hairline plus bloom, the halo a dark ground needs - a grey shadow is invisible
   against slate, so the glow is drawn in light.

   IDLE - the page ground, muted ink, one hairline, and a lift to the primary button's emerald on
   hover. Both states carry a 1px ring so only its COLOUR changes between them: the focus ring that
   arrives on a keypress is then the one thing widening the edge. */
const GRADE_ACTIVE = "bg-brand-500 text-ink-inverse ring-1 ring-brand-500 shadow-glow-sm";
const GRADE_IDLE = "bg-surface-sunken text-ink-500 ring-1 ring-line hover:bg-brand-700 hover:text-white";

/* How the server says it read the term, in the operator's own words. */
const RESOLVED_BY: Record<string, string> = {
  lot_number: "lot number",
  asset_id: "asset id",
  serial: "serial number",
  lot_id: "lot id",
};

export default function LotWorkbench() {
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [list, setList] = useState<Worklist | null>(null);
  const [busy, setBusy] = useState(false);
  const [inFlight, setInFlight] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  /* Description drafts, keyed by unit id, seeded from the payload the first time a row is seen and
     then owned by the field until it saves. Held across reloads on purpose: a save on one row must
     not throw away what is half-typed on another. */
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const gradeRefs = useRef(new Map<string, HTMLButtonElement | null>());

  const seed = useCallback((units: WorkUnit[]) => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const u of units) if (!(u.id in next)) next[u.id] = u.notes ?? "";
      return next;
    });
  }, []);

  async function load(term: string) {
    setBusy(true);
    setErr("");
    try {
      const r = await apiFetch(`/staff/lots/worklist?q=${encodeURIComponent(term)}`);
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) {
        setList(null);
        setErr(typeof j.detail === "string" ? j.detail : "that search could not be read");
        return;
      }
      setList(j as Worklist);
      setSubmitted(term);
      seed(j.assets as WorkUnit[]);
      setMsg("");
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  /* Re-reads the same search. Every counter and every row comes back from the server rather than
     from this component's arithmetic, so the bar can never disagree with the database. */
  async function reload() {
    if (submitted) await load(submitted);
  }

  /* Moves one row's grade chip without touching the list the server sent. Only the chip: every
     counter under the table still comes from the payload, so an optimistic row can never make the
     progress bar disagree with the database. */
  function setRowGrade(unitId: number, grade: string | null) {
    setList((cur) =>
      cur ? { ...cur, assets: cur.assets.map((a) => (a.id === unitId ? { ...a, grade } : a)) } : cur,
    );
  }

  function focusGrade(unitId: number, grade: string) {
    const el = gradeRefs.current.get(`${unitId}:${grade}`);
    if (el) el.focus();
  }

  /* Walks the same grade column between rows, so the arrow keys and the post-save focus move both
     land on a control that is there. */
  function moveFocus(unitId: number, grade: string, delta: number) {
    const order = (list?.assets ?? []).map((a) => a.id);
    const to = order.indexOf(unitId) + delta;
    if (to < 0 || to >= order.length) return;
    focusGrade(order[to], grade);
  }

  async function quickGrade(unit: WorkUnit, grade: string) {
    if (inFlight !== null) return;
    setInFlight(unit.id);
    setErr("");
    setMsg("");
    const order = (list?.assets ?? []).map((a) => a.id);
    const at = order.indexOf(unit.id);
    const nextId = at >= 0 && at + 1 < order.length ? order[at + 1] : null;
    // What the server holds for this row right now, so a refusal has something to put back.
    const held = unit.grade;
    setRowGrade(unit.id, grade);
    try {
      const r = await apiFetch(`/staff/assets/${unit.id}/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grade, test_first: true }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) {
        // The bright chip goes back to the grade the database still has, rather than showing a
        // grade that was refused.
        setRowGrade(unit.id, held);
        setErr(typeof j.detail === "string" ? j.detail : "that grade was refused");
        return;
      }
      setMsg(`Asset ${unit.id} graded ${grade}.`);
      // The read that follows is what makes the row true, not what makes it look true: it lands the
      // unit's status and the counters, and it is also what settles the chip if the server wrote
      // something other than what was pressed.
      await reload();
      // The next row, same grade button. One keypress per unit down the list.
      if (nextId !== null) setTimeout(() => focusGrade(nextId, grade), 0);
    } catch (e: any) {
      setRowGrade(unit.id, held);
      setErr(String(e?.message ?? e));
    } finally {
      setInFlight(null);
    }
  }

  async function saveNotes(unit: WorkUnit) {
    const draft = drafts[unit.id] ?? "";
    if (draft === (unit.notes ?? "")) return;      // nothing changed: no request, no audit row
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
        // The field goes back to what the server holds, rather than showing a save that did not happen.
        setDrafts((prev) => ({ ...prev, [unit.id]: unit.notes ?? "" }));
        return;
      }
      setDrafts((prev) => ({ ...prev, [unit.id]: j.notes ?? "" }));
      setMsg(`Description saved for asset ${unit.id}.`);
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
      <Card className="p-6 shadow-glow-sm ring-brand-100">
        <Heading level="h3" as="h2">Find a lot, asset or serial</Heading>
        <p className="mt-1 pb-4 text-sm text-ink-500">
          Any of the three opens the lot it belongs to, so the units you are working with stay
          together. The one you searched for is marked in the table.
        </p>
        <div className="flex flex-wrap gap-3">
          <div className="min-w-[16rem] flex-1">
            <Input
              placeholder="LOT-2026-00050, 14543, or a serial number"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); if (text.trim()) load(text.trim()); }
              }}
              aria-label="Lot number, asset id or serial number"
            />
          </div>
          <Button size="lg" onClick={() => load(text.trim())} disabled={busy || !text.trim()}>
            {busy ? "Searching..." : "Open"}
          </Button>
        </div>
      </Card>

      {msg && <p className="text-brand-300 text-sm">{msg}</p>}
      {err && <p className="text-danger-600 text-sm">{err}</p>}

      {list && progress && (
        <>
          <Card className="p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Heading level="h3" as="h2">Lot {list.lot.lot_number}</Heading>
              <p className="text-sm text-ink-500">
                {progress.awaiting_grade_units} still to grade
                {list.lot.warehouse ? ` - ${list.lot.warehouse}` : ""}
              </p>
            </div>

            <p className="mt-3 text-sm font-semibold text-ink-700">
              {graded} of {total} units graded
            </p>
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

            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className={kickerClass}>Received</dt>
                <dd className="mt-1 text-lg font-semibold text-ink-900">{progress.received_units}</dd>
              </div>
              <div>
                <dt className={kickerClass}>Graded</dt>
                <dd className="mt-1 text-lg font-semibold text-ink-900">{progress.graded_units}</dd>
              </div>
              <div>
                <dt className={kickerClass}>Ready for pricing</dt>
                <dd className="mt-1 text-lg font-semibold text-ink-900">{progress.ready_for_pricing_units}</dd>
              </div>
            </dl>

            {list.highlight_asset_id !== null && (
              <p className="mt-4 text-xs text-ink-500">
                Matched on{" "}
                <span className="font-semibold text-ink-600">
                  {RESOLVED_BY[list.match.resolved_by] ?? list.match.resolved_by}
                </span>
                {list.match.term ? <> - <span className="font-mono">{list.match.term}</span></> : null}
                {" "}- asset {list.highlight_asset_id} is marked below.
              </p>
            )}
          </Card>

          <Card className="p-6">
            <Heading level="h3" as="h2">Units</Heading>
            {list.assets.length === 0 ? (
              <p className="mt-2 text-sm text-ink-500">This lot has no units in it.</p>
            ) : (
              <>
                <p className="mt-1 pb-3 text-xs text-ink-500">
                  A grade saves on the press. A description saves when you leave the field or press
                  Enter. A unit that has not been tested is marked tested on the way through - the
                  database will not let a unit skip that step, and both steps reach the audit trail.
                </p>
                <Table label={`Units in lot ${list.lot.lot_number}`}>
                  <THead>
                    <TH>Asset ID</TH>
                    <TH>Lot</TH>
                    <TH>Class</TH>
                    <TH>Model</TH>
                    <TH>Upgrade Description</TH>
                    <TH>Grade</TH>
                  </THead>
                  <TBody>
                    {list.assets.map((u) => {
                      const matched = u.id === list.highlight_asset_id;
                      return (
                        <TR
                          key={u.id}
                          className={cn(
                            inFlight === u.id ? "opacity-60" : "",
                            matched ? "bg-brand-50 ring-2 ring-inset ring-brand-500" : "",
                          )}
                        >
                          <TD className="font-mono text-xs">
                            {u.id}
                            {matched && (
                              <div className="mt-1">
                                <Badge colorClass="bg-brand-700 text-white">matched</Badge>
                              </div>
                            )}
                          </TD>
                          <TD className="font-mono text-xs text-ink-600">{list.lot.lot_number}</TD>
                          <TD className="text-ink-600">{u.category ?? "-"}</TD>
                          <TD className="text-ink-600">{u.product_model ?? u.product_title ?? "-"}</TD>
                          <TD className="min-w-[16rem]">
                            {/* Always a field, never a read-mode text with an edit mode behind it:
                                the brief asks for an editable description, and a control that has
                                to be revealed first is a click the grader should not have to make. */}
                            <textarea
                              value={drafts[u.id] ?? ""}
                              rows={2}
                              disabled={inFlight !== null}
                              onChange={(e) => setDrafts((prev) => ({ ...prev, [u.id]: e.target.value }))}
                              onBlur={() => saveNotes(u)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); }
                              }}
                              placeholder="What did you find?"
                              aria-label={`Upgrade description for asset ${u.id}`}
                              className={cn(
                                "w-full rounded-control bg-surface px-3 py-2 text-xs text-ink-700",
                                "ring-1 ring-line outline-none focus-visible:ring-2 focus-visible:ring-brand-700",
                                "disabled:opacity-50",
                              )}
                            />
                          </TD>
                          <TD>
                            {u.gradable ? (
                              <div className="flex gap-1">
                                {GRADES.map((g) => (
                                  <button
                                    key={g}
                                    type="button"
                                    ref={(el) => { gradeRefs.current.set(`${u.id}:${g}`, el); }}
                                    disabled={inFlight !== null}
                                    onClick={() => quickGrade(u, g)}
                                    onKeyDown={(e) => {
                                      if (e.key === "ArrowDown") { e.preventDefault(); moveFocus(u.id, g, 1); }
                                      if (e.key === "ArrowUp") { e.preventDefault(); moveFocus(u.id, g, -1); }
                                    }}
                                    aria-label={`Grade asset ${u.id} as ${g}`}
                                    aria-pressed={u.grade === g}
                                    className={cn(
                                      "h-7 w-7 rounded-control text-xs font-semibold",
                                      "transition duration-fast ease-out motion-reduce:transition-none",
                                      "disabled:opacity-40 disabled:pointer-events-none",
                                      GRADE_FOCUS,
                                      u.grade === g ? GRADE_ACTIVE : GRADE_IDLE,
                                    )}
                                  >
                                    {g}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <span className="text-xs text-ink-500">
                                {u.grade ?? "no grade"} - not gradable at {u.status}
                              </span>
                            )}
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
                {list.truncated && (
                  <p className="mt-3 text-xs text-ink-500">
                    Showing the first {list.limit} units of this lot.
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
