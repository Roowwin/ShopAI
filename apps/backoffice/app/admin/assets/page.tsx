"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Badge, Card, Input, PageHeader, Select, Table, TBody, TD, TH, THead, TR } from "@/app/components/ui";
import { gradeTone } from "@/lib/ui";
import AssetPanel from "./AssetPanel";
import BulkBar from "./BulkBar";

/* The assets workbench: master-detail over the stock the shop actually holds.

   WHAT THE MASTER IS, AND WHY IT IS NOT A LOT. This screen's queue is a queue of UNITS, not of
   lots. What the endpoint behind it hands back per row is one asset - its serial, its lifecycle
   state, its grade, and the number of the lot it arrived in - and the three batch actions this
   panel offers are all per-unit doors. A lot is a real thing on this API, but the list of them is
   drawn on the intake screen, and a lot payload carries a count rather than the units themselves,
   so a lot-opening-its-units queue here would have had to carry a second list to fill its own
   panel. The detail opened from a row is therefore that row's unit, read from the same endpoint
   /admin/assets/[id] reads.

   (Written without naming a utility in prose. The stylesheet is produced by scanning this text, so
   an English word that happens to match a utility name ships a real rule - this app's phase has
   already paid for that three times, and it cost two more words here before the closing test
   caught them.)

   THE SPLIT VIEW. The queue and the unit's bench now stand SIDE BY SIDE rather than one over the
   other: the record used to open as a modal drawer across the right of the screen, which hid the
   queue it was opened from. A processing centre is worked by scanning the queue and acting on the
   bench without losing your place, so the pane is beside the queue and both stay live - see the
   header of AssetPanel for what that cost (the modal machinery, which cannot honestly survive).

   THE SELECTED ROW'S INDICATOR IS brand-500, NOT brand-700, and that is a measurement rather than a
   preference. The brief for this pass asked for `border-l-4 border-brand-700` on a `bg-brand-50`
   row, which are LIGHT-GROUND values: on this app's charcoal card the fill measures 1.16:1 and the
   bar 2.26:1 - both under the 3:1 this repo holds a non-text indicator to, and the fill is close to
   invisible. `brand-500` is the same ladder one step up, at 6.96:1, and it is the step this repo
   already moved its own focus ring to for exactly this reason (see the note on the ring in
   globals.css, where `ring-brand-700` at 2.3:1 became `ring-brand-500`). The bar and the fill are
   the brief's, the step is the one that reads. The row also carries `aria-current`, so the
   selection is never colour-alone.

   THE QUEUE CARRIES THREE THINGS: serial, model and grade. Status left it, because status is what
   the control above the queue selects on - reading one value down a column you have just filtered
   to is the redundancy the brief asks to strip. The badge is still drawn, at the top of the bench,
   where the unit being acted on is described.

   THE ROW IS THE ONE WAY IN. A press anywhere on it selects that unit for the bench. The serial
   keeps its own link to the full record and stops the press from reaching the row underneath it. */
type Asset = { id: number; public_id: string; serial_number: string | null; status: string;
               grade: string | null; lot_number: string; model: string | null; title: string | null;
               /* `brand` rides with the model because the bulk-image guard compares the same pair the
                  door behind it matches on - see the note on the endpoint's query. */
               brand: string | null };

const STATUSES = ["received", "tested", "in_repair", "graded", "listed", "reserved", "sold", "shipped", "returned", "scrapped"];

/* The tick that puts a row into a batch. The control is the browser's own checkbox, painted with the
   accent the token layer declares; the label around it is the 36px hit target the whole app uses for
   a pointer-first control, so the mark itself stays small while the thing you aim at does not.
   The focus cue is the brighter emerald step, which clears 3:1 where the darker one would not. */
const TICK = "inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-control";
const TICK_BOX = "h-4 w-4 accent-brand-500";
const ROW_FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-300";

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [status, setStatus] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const all = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (lotNumber) p.set("lot_number", lotNumber);
    p.set("limit", "50");
    const r = await apiFetch("/staff/assets?" + p.toString());
    if (r.ok) { const j: Asset[] = await r.json(); setAssets(j); }
  }, [status, lotNumber]);
  useEffect(() => { load(); }, [load]);

  /* THE QUERY IS ADDRESSABLE. The dashboard's alerts link straight at the work they are about - the
     stale-stock row opens the listed stock - and until this effect existed that landed on the whole
     inventory: both controls start empty and nothing read the query string, so the href was a
     narrowing that silently did nothing, which is worse than a plain link because it reads as though
     it worked.

     Read once, on mount, through the browser's own parser rather than `useSearchParams`, which would
     put this whole page behind a Suspense boundary for a value that cannot change after load. It is
     an effect and not a lazy `useState` initialiser because the first render happens on the server,
     where there is no query string: reading it there would leave the server's markup and the
     client's disagreeing. The cost is one un-narrowed read that the narrowed read immediately
     follows.

     A status the endpoint would not accept is dropped rather than sent, so a hand-edited URL cannot
     turn into a request the API answers with a 422 - the control falls back to "any status" and the
     queue stays readable. */
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const s = p.get("status") ?? "";
    const l = p.get("lot_number") ?? "";
    if (STATUSES.includes(s)) { setStatus(s); }
    if (l) { setLotNumber(l); }
  }, []);

  /* THE SEARCH IS LOCAL, AND THAT IS A REAL LIMIT. It narrows the rows already on the bench - the
     50 most recent for the current controls - matching a serial or a model. The endpoint has no text
     term (it takes status, lot and product), so a search that reached the whole database would be a
     new API parameter rather than a keystroke handler; saying so here is better than a box that
     looks like it searched everything and did not. It runs on every keystroke because it is a
     filter over an array already in memory, so there is nothing to debounce. */
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t === "") { return assets; }
    return assets.filter((a) =>
      (a.serial_number ?? "").toLowerCase().includes(t) ||
      (a.model ?? "").toLowerCase().includes(t) ||
      (a.title ?? "").toLowerCase().includes(t));
  }, [assets, q]);

  /* The rows a batch would write: the ticks, narrowed to what is actually on screen. `shown` rather
     than `assets`, so a unit the search has hidden cannot be carried into a run by a tick that was
     placed before the term was typed - the same rule the original comment set for a reload. */
  const targets = shown.filter((a) => picked.includes(a.id));

  /* A partly ticked page is not a ticked page. The browser draws that middle state from a property
     rather than from markup, so it is set here. */
  useEffect(() => {
    if (all.current) { all.current.indeterminate = targets.length > 0 && targets.length < shown.length; }
  }, [targets.length, shown.length]);

  const closePanel = useCallback(() => setOpenId(null), []);
  const afterRun = useCallback(async () => { await load(); setRevision((v) => v + 1); }, [load]);

  /* THE QUEUE UPDATES THE ROW THE BENCH JUST WROTE. The grade POST has succeeded and the value is
     known, so the row is patched in place rather than the whole queue being refetched: one char
     against a round trip, and the badge changes in the same frame as the press. */
  const afterGrade = useCallback((id: number, grade: string) => {
    setAssets((rows) => rows.map((a) => (a.id === id ? { ...a, grade } : a)));
  }, []);

  function toggle(id: number, on: boolean) {
    setPicked((v) => (on ? (v.includes(id) ? v : [...v, id]) : v.filter((x) => x !== id)));
  }
  function toggleAll(on: boolean) {
    setPicked(on ? shown.map((a) => a.id) : []);
  }

  const selected = openId === null ? null : assets.find((a) => a.id === openId) ?? null;

  return (
    <main className="mx-auto max-w-7xl px-4 pb-32 pt-8 space-y-6">
      <PageHeader
        title={<>Assets workbench</>}
        description={
          <>
            Scan the queue, open a unit on the bench, and write to it. Tick several to act on them
            together.
          </>
        }
      />

      <div className="flex flex-wrap gap-3">
        <div className="w-64">
          <Input
            placeholder="search serial or model"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search the queue by serial or model"
            type="search"
          />
        </div>
        <Select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPicked([]); }}
          aria-label="Filter by status"
        >
          <option value="">any status</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </Select>
        <div className="w-56">
          <Input
            placeholder="lot number"
            value={lotNumber}
            onChange={(e) => { setLotNumber(e.target.value); setPicked([]); }}
            aria-label="Filter by lot number"
          />
        </div>
      </div>

      {/* The two panes. The bench is a fixed column from lg up and takes the full width under it,
          where there is no room to stand beside anything; it sticks so a long queue scrolls under
          it rather than carrying it off the top of the screen. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <Card className="p-4">
          <Table label="Assets">
            <THead>
              <TH>
                <input
                  ref={all}
                  type="checkbox"
                  className={TICK_BOX}
                  checked={shown.length > 0 && targets.length === shown.length}
                  onChange={(e) => toggleAll(e.target.checked)}
                  aria-label="Select every unit on this page"
                />
              </TH>
              <TH>Serial</TH><TH>Model</TH><TH>Grade</TH>
            </THead>
            <TBody>
              {shown.map((a) => {
                const on = picked.includes(a.id);
                const open = a.id === openId;
                return (
                  <TR
                    key={a.id}
                    tabIndex={0}
                    aria-current={open ? "true" : undefined}
                    className={"cursor-pointer border-l-4 " + ROW_FOCUS + " " +
                      (open
                        ? "border-brand-500 bg-brand-500/15"
                        : "border-transparent " + (on ? "bg-brand-50" : "hover:bg-surface-muted"))}
                    onClick={(e) => { e.currentTarget.focus(); setOpenId(a.id); }}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) { return; }   // only the row itself - a descendant owns its own Space/Enter
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenId(a.id); }
                    }}
                  >
                    {/* The cell swallows the press so a tick never also selects the row - one press,
                        one effect. It covers both the label and the box inside it. */}
                    <TD onClick={(e) => e.stopPropagation()}>
                      <label className={TICK}>
                        <input
                          type="checkbox"
                          className={TICK_BOX}
                          checked={on}
                          onChange={(e) => toggle(a.id, e.target.checked)}
                          aria-label={"Select " + (a.serial_number ?? "#" + a.id)}
                        />
                      </label>
                    </TD>
                    <TD className="font-mono">
                      <a href={"/admin/assets/" + a.id} onClick={(e) => e.stopPropagation()}
                         className="text-brand-300 hover:underline">{a.serial_number ?? "#" + a.id}</a>
                    </TD>
                    <TD className="truncate font-display">{a.model ?? a.title ?? "-"}</TD>
                    <TD>{a.grade ? <Badge colorClass={gradeTone(a.grade)}>{a.grade}</Badge> : null}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          {shown.length === 0 && (
            <p className="pt-2 text-sm text-ink-500">
              {assets.length === 0 ? "no assets match" : "no unit on this page matches the search"}
            </p>
          )}
        </Card>

        <div className="lg:sticky lg:top-6">
          {openId !== null ? (
            <AssetPanel key={openId} assetId={openId} revision={revision}
                        model={selected?.model ?? selected?.title ?? null}
                        onClose={closePanel} onGraded={afterGrade} />
          ) : (
            <Card className="p-6">
              <p className="text-sm text-ink-600">No unit selected.</p>
              <p className="mt-1 text-xs text-ink-500">
                Press a row to open its bench - the serial, where it is stored, and the controls that
                grade and describe it.
              </p>
            </Card>
          )}
        </div>
      </div>

      {/* Rendered only while something is ticked. */}
      {targets.length > 0 && (
        <BulkBar targets={targets} onDone={afterRun} onClear={() => setPicked([])} />
      )}
    </main>
  );
}
