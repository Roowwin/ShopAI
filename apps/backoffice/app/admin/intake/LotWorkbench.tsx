"use client";

/* THE GRADING WORKSTATION. A queue of remaining lots, a search box over it, and one table.

   THIS FILE OPENS ON THE WORK, NOT ON AN EMPTY BOX. It used to be a search field over nothing, which
   is a lookup rather than a queue: an operator arriving at the start of a shift does not know which
   lot number to type. So the default view is `PendingLots` - every lot still holding an ungraded
   unit, oldest first - and the search box sits above it for the times somebody does know the
   handle. Pressing a card resolves that lot exactly as typing it would, because both paths call the
   same `load`; a card is a shortcut, not a second way in.

   THE TABLE REPLACES THE QUEUE. The two are never on screen together: the table is six columns wide
   and would be crushed beside a column of cards. `backToQueue` is how the workbench is left.

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
   the row above it is a chip they cannot trust.

   THE BUTTONS ALSO CARRY THE GUIDE. "Which grade does this unit hold" was answered; "where is the
   line between a B and a C" was not, and that is the question a grader is holding in their head at
   the moment they press one. Each button opens the shop's published criterion for its own grade -
   see GradeTip.tsx, which owns both the panel and the reasoning about where it is allowed to be
   drawn. It opens for the pointer AND for the keyboard, because the keyboard is the workflow this
   table is built around and a hover-only guide would be missing for the operator it is written for.

   THE DESCRIPTION HAS PRESETS. An upgrade note is usually two or three findings out of a short
   vocabulary, so the cell carries them as buttons: press one and its words are appended and SAVED.
   Saved, not staged - the field saves on blur and a tag press never focuses the field, so a tag
   that only edited a draft would be a change with no blur coming to write it. The preset press
   keeps the caret where it was (the field's own press is cancelled) so the two never race.

   THE PAGE CAN BE ENTERED ON A UNIT. It takes `?q=` from the address, which is how the dashboard's
   Priority Queue card opens straight onto the oldest ungraded unit of the biggest lot, and it runs
   that search on the way in. Read off the location rather than through the framework's search-params
   hook: this screen reads the term exactly once, on arrival, and the hook would put a Suspense
   boundary in front of every render of the page to buy a subscription nothing here needs. */

import { useCallback, useEffect, useRef, useState } from "react";

import { Badge, Button, Card, Heading, Input, Table, TBody, TD, TH, THead, TR, cn } from "@/app/components/ui";
import { apiFetch } from "@/lib/api";
import { gradeHelpId } from "@/lib/grading";
import { kickerClass } from "@/lib/ui";
import { GRADE_TIP_HEIGHT, GRADE_TIP_WIDTH, GradeHelp, GradeTip } from "./GradeTip";
import PendingLots from "./PendingLots";

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
  /* Where the unit is. Warehouse and Zone come from the unit's LOT - every unit in one lot shares
     them - while Pallet and Location are the unit's own. They arrive on the row rather than only on
     the lot header because a grader working down the list is asking about THIS unit. All optional:
     a lot created by an older flow has no zone, and most of the catalogue has no pallet. */
  asset?: string | null;
  model_number?: string | null;
  location?: string | null;
  pallet?: string | null;
  sku?: string | null;
  channel?: string | null;
  on_shelf?: boolean | null;
  warehouse?: string | null;
  zone?: string | null;
  load_id?: string | null;
  account?: string | null;
};

type Worklist = {
  match: { kind: "lot" | "asset"; resolved_by: string; term: string | null };
  highlight_asset_id: number | null;
  lot: { id: number; lot_number: string; status: string; warehouse: string | null;
         received_at: string; load_id?: string | null; account?: string | null;
         zone?: string | null };
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

/* The findings a grader writes up most, in the shop's own vocabulary (see lib/grading.ts, which
   holds the A-D criteria in the same voice). Pressing one appends its words to the description -
   as a comma-list item, not a sentence: a unit normally carries two or three findings, and a
   grader composing one clause per finding would spend exactly the time the preset exists to save. */
const QUICK_TAGS = [
  "Surface Wear",
  "Screen Scratch",
  "Dented Frame",
  "Battery Health Low",
  "Camera Lens Scuffed",
  "Charging Port Worn",
] as const;

/* Every control that lives inside the table's scroll region - the grade buttons and the preset
   tags - takes this focus cue. The region trims anything its descendants paint outside its own
   box, so the cue is drawn INSIDE the control's edge; one constant rather than the same string
   written at two call sites, which is how two cues that were meant to agree stop agreeing. */
const CELL_FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-900";

/* The two states of a grade button, as classes rather than `gradeTone`: that helper paints ONE
   colour per grade for a chip that NAMES a grade, and it paints all four of these the same, which
   is precisely the state this control could not show.

   ACTIVE - a light neutral fill under the dark ink. This was `bg-brand-500` while brand-500 was
   the brand's saturated green; the Quiet Luxury pass repointed 500 to slate-400, because the brand
   is allowed on the primary action and nowhere else. `ink-inverse` is still the right ink for it -
   a light fill needs dark text - and it measures 7.87:1 on the new value, where white on the old
   green could not clear 4.5:1 at all (3.92:1). There WAS a brand halo behind it (`shadow-glow-sm`, a hairline
   plus bloom, drawn in light because a grey shadow is invisible against slate); it went with every
   other glow in that pass, so the fill and its 1px ring are the whole of the active state now.

   IDLE - the page ground, muted ink, one hairline, and a lift to the primary button's green on
   hover. Both states carry a 1px ring so only its COLOUR changes between them: the focus ring that
   arrives on a keypress is then the one thing widening the edge. */
const GRADE_ACTIVE = "bg-brand-500 text-ink-inverse ring-1 ring-brand-500";
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
  /* The grading guide: which grade's panel is open and where it sits, in viewport coordinates.
     Null is the closed state, so there is no "is it visible" flag to keep in step with the grade. */
  const [tip, setTip] = useState<{ grade: string; x: number; y: number; above: boolean } | null>(null);
  const gradeRefs = useRef(new Map<string, HTMLButtonElement | null>());

  const seed = useCallback((units: WorkUnit[]) => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const u of units) if (!(u.id in next)) next[u.id] = u.notes ?? "";
      return next;
    });
  }, []);

  /* Opened on a unit. The Priority Queue card on the dashboard links here as ?q=<asset id>, so the
     workstation can arrive ON the unit that needs grading rather than at an empty search box. Read
     once, on arrival: a later edit of the address is not a search, and re-reading it on every render
     would re-run the search under the operator's hands. */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q && q.trim()) {
      const term = q.trim();
      setText(term);
      void load(term);
    }
    // Mount only, on purpose - see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The guide cannot stay where it was put once the ground under it moves, and re-measuring on
     every scroll frame would cost more than the panel is worth - so a scroll or a resize simply
     closes it. The listener is capturing: the table's own scrolling region is a descendant, and a
     bubble-phase listener on the window never sees a scroll that happens inside it. */
  useEffect(() => {
    if (!tip) return;
    const close = () => setTip(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [tip]);

  /* Opens the guide on the control that assigns the grade. The centre is clamped against the
     window because the last grade button of a wide row sits close to the right edge, and the panel
     is drawn above the button only when there is room for it up there - the first row of a lot is
     exactly where "above" would push it off the top of the screen. */
  function openTip(grade: string, el: HTMLElement | null) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const half = GRADE_TIP_WIDTH / 2;
    const x = Math.max(half + 8, Math.min(window.innerWidth - half - 8, r.left + r.width / 2));
    const above = r.top > GRADE_TIP_HEIGHT + 16;
    setTip({ grade, x, y: above ? r.top - 8 : r.bottom + 8, above });
  }

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

  /* BACK TO THE QUEUE. The workbench is opened FROM the remaining-lots cards, so it has to be
     closable back to them without retyping a search - and the search text is cleared with the
     resolution, because the box is about to be filled by whichever card is pressed next, and a
     stale lot number sitting in it reads as the search that is currently in force. */
  function backToQueue() {
    setList(null); setSubmitted(null); setText(""); setMsg(""); setErr("");
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
    // The guide has been read by the time the grade is pressed; it would otherwise hang over the
    // row the operator has just moved on from.
    setTip(null);
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

  /* The one write the description makes, whichever control started it: the field leaving focus, or
     a preset tag being pressed. Both send the whole note, both take the server's answer as the
     field's new value, and both put the field back to what the server holds when the write is
     refused rather than leaving the screen disagreeing with the database. */
  async function writeNotes(unit: WorkUnit, next: string, done: string) {
    if (inFlight !== null) return;
    setInFlight(unit.id);
    setErr("");
    setMsg("");
    try {
      const r = await apiFetch(`/staff/assets/${unit.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: next }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(typeof j.detail === "string" ? j.detail : "that description was refused");
        // The field goes back to what the server holds, rather than showing a save that did not happen.
        setDrafts((prev) => ({ ...prev, [unit.id]: unit.notes ?? "" }));
        return;
      }
      setDrafts((prev) => ({ ...prev, [unit.id]: j.notes ?? "" }));
      setMsg(done);
      await reload();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
      setDrafts((prev) => ({ ...prev, [unit.id]: unit.notes ?? "" }));
    } finally {
      setInFlight(null);
    }
  }

  async function saveNotes(unit: WorkUnit) {
    const draft = drafts[unit.id] ?? "";
    if (draft === (unit.notes ?? "")) return;      // nothing changed: no request, no audit row
    await writeNotes(unit, draft, `Description saved for asset ${unit.id}.`);
  }

  /* A preset tag: the same write the field makes, only started from a button. It goes to the
     SERVER immediately rather than waiting for a blur - the field was never focused, so there is
     no blur coming, and a tag that edited a draft nobody would save is worse than no tag at all.
     A word already in the note is not added twice: the press is easy to repeat and the second one
     is nearly always a slip of the hand, not a second finding. */
  async function appendTag(unit: WorkUnit, tag: string) {
    const draft = drafts[unit.id] ?? "";
    if (draft.toLowerCase().includes(tag.toLowerCase())) {
      setErr("");
      setMsg(`"${tag}" is already written up on asset ${unit.id}.`);
      return;
    }
    const next = draft.trim() ? `${draft.trimEnd()}; ${tag}` : tag;
    setDrafts((prev) => ({ ...prev, [unit.id]: next }));
    await writeNotes(unit, next, `Added "${tag}" to asset ${unit.id}.`);
  }

  const progress = list?.progress ?? null;
  const total = progress?.total_units ?? 0;
  const graded = progress?.graded_units ?? 0;
  const pct = total > 0 ? Math.round((graded / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <Card className="p-6 ring-brand-100">
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

      {/* THE QUEUE IS THE DEFAULT VIEW, and the workbench REPLACES it rather than standing beside
          it. The brief allowed either; beside it is the one that cannot work here - the grading
          table is six columns wide, and a card column would take a third of the page away from the
          thing the operator is reading. Pressing a card is a mode change: the queue goes, the lot
          arrives, and the control below brings the queue back.

          It is hidden while a search is in flight (`busy`) so a card cannot be pressed twice over
          an answer that is already on its way. */}
      {!list && !busy && (
        <PendingLots onOpen={(lotNumber) => { setText(lotNumber); void load(lotNumber); }} />
      )}

      {list && progress && (
        <>
          <Card className="p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Heading level="h3" as="h2">Lot {list.lot.lot_number}</Heading>
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-ink-500">
                  {progress.awaiting_grade_units} still to grade
                  {list.lot.warehouse ? ` - ${list.lot.warehouse}` : ""}
                </p>
                {/* The way back. Named for the section it returns to, so the label and the heading
                    of the view it opens are the same words. */}
                <Button variant="secondary" size="sm" onClick={backToQueue}>Remaining lots</Button>
              </div>
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
              className="mt-2 h-3 w-full overflow-hidden rounded-control bg-surface-sunken ring-1 ring-line"
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
                  Hover a grade button, or land on it with the keyboard, for what that grade means.
                </p>
                {/* The four criteria, rendered once for the page and referenced by every row's
                    grade buttons - see GradeTip.tsx. */}
                <GradeHelp />
                <Table label={`Units in lot ${list.lot.lot_number}`}>
                  <THead>
                    <TH>Asset ID</TH>
                    <TH>Lot</TH>
                    <TH>Class</TH>
                    <TH>Model</TH>
                    {/* Where the unit is, beside what it is: a grader filling in a description is
                        also the person who has to put the unit back, and "which zone was this one
                        in" is a question about the row in front of them. Warehouse and Zone are the
                        LOT's; Pallet is the unit's own. */}
                    <TH>Warehouse</TH>
                    <TH>Zone</TH>
                    <TH>Pallet</TH>
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
                          <TD className="text-ink-600">{u.warehouse ?? list.lot.warehouse ?? "-"}</TD>
                          <TD className="text-ink-600">{u.zone ?? "-"}</TD>
                          <TD className="font-mono text-xs text-ink-600">{u.pallet ?? "-"}</TD>
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
                            {/* The presets. The press is cancelled so the field keeps the caret -
                                otherwise the field would blur first and save itself a moment before
                                the tag was appended to it. */}
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {QUICK_TAGS.map((tag) => (
                                <button
                                  key={tag}
                                  type="button"
                                  disabled={inFlight !== null}
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => appendTag(u, tag)}
                                  aria-label={`Add "${tag}" to the upgrade description for asset ${u.id}`}
                                  className={cn(
                                    "rounded-control bg-surface-sunken px-2 py-0.5 text-xs text-ink-500 ring-1 ring-line",
                                    "transition duration-fast ease-out motion-reduce:transition-none",
                                    "hover:bg-brand-700 hover:text-white",
                                    "disabled:opacity-40 disabled:pointer-events-none",
                                    CELL_FOCUS,
                                  )}
                                >
                                  {tag}
                                </button>
                              ))}
                            </div>
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
                                    onMouseEnter={(e) => openTip(g, e.currentTarget)}
                                    onMouseLeave={() => setTip(null)}
                                    onFocus={(e) => openTip(g, e.currentTarget)}
                                    onBlur={() => setTip(null)}
                                    onKeyDown={(e) => {
                                      if (e.key === "ArrowDown") { e.preventDefault(); moveFocus(u.id, g, 1); }
                                      if (e.key === "ArrowUp") { e.preventDefault(); moveFocus(u.id, g, -1); }
                                      if (e.key === "Escape") setTip(null);
                                    }}
                                    aria-label={`Grade asset ${u.id} as ${g}`}
                                    aria-pressed={u.grade === g}
                                    // The criteria belong to the grade, not to the row: every A
                                    // button on the page points at the one description of an A.
                                    aria-describedby={gradeHelpId(g)}
                                    className={cn(
                                      "h-7 w-7 rounded-control text-xs font-semibold",
                                      "transition duration-fast ease-out motion-reduce:transition-none",
                                      "disabled:opacity-40 disabled:pointer-events-none",
                                      CELL_FOCUS,
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

      {/* Outside every panel and every scrolling region, so nothing can trim it - see GradeTip.tsx. */}
      {tip && <GradeTip grade={tip.grade} x={tip.x} y={tip.y} above={tip.above} />}
    </div>
  );
}
