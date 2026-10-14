"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Badge, Button, Input, cn } from "@/app/components/ui";
import { aud, when } from "@/lib/format";
import { gradeTone, kickerClass, linkClass, statusTone } from "@/lib/ui";

/* THE DETAIL BENCH - the right-hand pane of the processing centre, opened from a row.

   It shows the record the row summarises - serial, status, grade and lot come straight off the
   master line, and the rest (identity, storage, money, movement history) comes from the single
   unit endpoint the read-only detail route already uses. Same payload, one fetch, so this bench
   and /admin/assets/[id] cannot disagree about a unit.

   THE PER-UNIT WRITES LIVE HERE rather than on the read-only detail route, which states in its own
   header that the writes which move a unit belong to the workbench. They are the same calls the
   workbench's own card made, moved rather than reinvented: the status door, the grade
   door, the price door, the move door and the upgrade-description door, each with the body its
   handler's own schema declares.

   THIS IS A PANE, NOT A DIALOG, and the difference is the whole of the shell. It used to open over
   the page as a modal: a scrim, `role="dialog"`, `aria-modal="true"`, a focus trap that wrapped Tab
   inside it, and a document listener that closed it on any press outside. In a SPLIT VIEW every one
   of those is wrong. The queue is still on screen and still interactive - pressing another row must
   select it, not dismiss the pane - so a scrim would cover the very control the user is aiming at, a
   focus trap would make the queue unreachable by keyboard, and "press outside closes" would fire on
   the first click of every attempt to move down the list. So the modal machinery is gone and what
   remains is a plain `<section>` in the page's own tab order. Escape still clears the selection,
   which is the one piece of the old behaviour that a pane can honestly keep.

   The entrance is still a slide, and it is now also the reason `key={assetId}` matters at the call
   site: a new unit remounts the pane, so the slide plays and the fields below start clean rather
   than carrying the previous unit's half-typed price.

   `model` arrives as a PROP from the selected row rather than from this fetch. The unit payload
   carries the supplier's own `model_number`, not the catalogue model, and the queue has the
   catalogue's one already - asking the detail endpoint for a second copy would be a second read for
   a string the page is holding. */

type Asset = { id: number; public_id: string; product_id: number | null; serial_number: string | null;
               imei: string | null; status: string; grade: string | null; cost_cents: number | null;
               sale_price_cents: number | null; intake_at: string; location: string | null;
               notes: string | null; lot_id: number; updated_at: string;
               /* The supplier workbook's per-unit columns. The endpoint has always returned them -
                * the type here simply did not name them, so the bench could not draw them. */
               asset: string | null; model_number: string | null; upgrade: string | null;
               upgrade_desc: string | null; channel: string | null; on_shelf: boolean | null;
               pallet: string | null; sku: string | null };
type Lot = { id: number; lot_number: string; status: string; warehouse: string | null;
             received_at: string; zone: string | null } | null;
type Movement = { id: number; moved_at: string; qty: number; reason: string; actor_staff_id: number | null };
type Detail = { asset: Asset; lot: Lot; movements: Movement[] };

const GRADES = ["A", "B", "C", "D"];

/* The endpoint caps movements at 50 and hands back no total to compare against, so the note fires
   at the cap - the only case in which the list may have been cut short. A shorter list is complete
   by construction, which is why the plain count it prints then is the whole truth. */
const MOVEMENT_CAP = 50;
const MOVEMENT_SHOWN = 5;

/* One line of the record: a dim term and its value. It carries a hover wash because the pane's
   own ground is a raised fill and a line on it is then a ground of its own - the wash is what tells
   a reader which line the pointer is on. */
const LINE = "flex items-baseline justify-between gap-4 rounded-control px-3 py-1.5 transition-colors duration-150 ease-out hover:bg-surface-sunken motion-reduce:transition-none";

/* The one focus cue this file owns. The chrome's own icon control uses the brighter emerald step
   for the same reason: the darker one sits at 3.30:1 against a card and only 2.76:1 against the
   soft emerald wash these lines take on hover. */
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";

/* A cent field the API will accept: a whole, non-negative number. Checked here so a mistyped field
   is answered before a request is sent rather than after the service rejects it. */
function centsGuard(v: string): boolean {
  return v.trim() !== "" && Number.isInteger(Number(v)) && Number(v) >= 0;
}

/* `revision` is how a batch that finished behind an open bench gets reflected in it: the parent
   bumps it after a run, and the fetch below reads the unit again. Passing it as a dependency rather
   than as a remount key keeps the pane's slide and its fields where they are. */
export default function AssetPanel({ assetId, revision = 0, model, onClose, onGraded }: {
  assetId: number; revision?: number; model?: string | null; onClose: () => void;
  /** Called with the unit and its new grade after a grade write succeeds, so the queue can update
      its own badge without refetching the list. */
  onGraded?: (id: number, grade: string) => void;
}) {
  const panel = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);
  const [data, setData] = useState<Detail | null>(null);
  const [note, setNote] = useState("");
  const [actMsg, setActMsg] = useState("");
  const [actErr, setActErr] = useState("");
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");
  const [location, setLocation] = useState("");
  const [upgrade, setUpgrade] = useState<string | null>(null);

  /* The slide waits one frame so the browser has a starting position to travel from. No focus is
     taken: the pane is not modal, the row the user pressed keeps focus (so the next Tab walks on
     through the page, and a keyboard user can press Enter on another row without first escaping a
     trap), and there is therefore nothing to hand back on close. */
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  /* Escape clears the selection. Kept from the modal shell because it is the one dismissal a pane
     can honestly offer - it does not fight the queue, which has no Escape of its own. */
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const load = useCallback(async () => {
    const r = await apiFetch("/staff/assets/" + assetId);
    if (!r.ok) {
      setNote(r.status === 403 ? "This role cannot read the unit record."
                                : r.status === 404 ? "No unit with that id."
                                : "The unit record could not be loaded.");
      return;
    }
    setNote("");
    const j: Detail = await r.json().catch(() => null as any);
    setData(j);
    /* The upgrade field seeds from the record once per read, and only while the user has not typed:
       `null` means "untouched", so a background revision cannot overwrite a half-written sentence
       with the value the database still holds. */
    setUpgrade((v) => (v === null ? (j?.asset?.upgrade_desc ?? "") : v));
  }, [assetId, revision]);

  useEffect(() => { void load(); }, [load]);

  async function act(fn: () => Promise<Response>, label: string) {
    setActErr(""); setActMsg("");
    try {
      const r = await fn();
      if (r.status === 200 || r.status === 201) { setActMsg(label + " done"); await load(); return; }
      const j: any = await r.json().catch(() => ({}));
      setActErr(typeof j?.detail === "string" ? j.detail : label + " refused (" + r.status + ")");
    } catch {
      setActErr(label + " could not be sent");
    }
  }

  const a = data?.asset;
  const cut = data ? data.movements.length >= MOVEMENT_CAP : false;

  /* Grading is ONE PRESS ON THE GRADE ITSELF - the button the operator presses is the grade they
     mean, which is the same shape the Lot Process workbench's grade row uses. The cost field below
     rides along only when it has something in it, exactly as it did when this was a select plus a
     button. */
  async function gradeAs(g: string) {
    if (!a) { return; }
    if (cost.trim() !== "" && !centsGuard(cost)) {
      setActMsg(""); setActErr("The cost has to be a whole number of cents, zero or more."); return;
    }
    setActErr(""); setActMsg("");
    try {
      const r = await post(a.id, "grade", { grade: g, ...(cost.trim() !== "" ? { cost_cents: Number(cost) } : {}) });
      if (r.status === 200 || r.status === 201) {
        setActMsg("Graded " + g + " done");
        /* The queue is told DIRECTLY rather than being asked to refetch: the write succeeded, the
           new grade is known, and a round trip for one character is what makes a list feel slow.
           A refusal falls through to the reload below, so the badge cannot disagree with the
           database for longer than it takes this fetch to land. */
        onGraded?.(a.id, g);
        await load();
        return;
      }
      const j: any = await r.json().catch(() => ({}));
      setActErr(typeof j?.detail === "string" ? j.detail : "Graded refused (" + r.status + ")");
    } catch {
      setActErr("Graded could not be sent");
    }
  }
  function doPrice(id: number) {
    if (!centsGuard(price)) { setActMsg(""); setActErr("The sale price has to be a whole number of cents, zero or more."); return; }
    void act(() => post(id, "price", { sale_price_cents: Number(price) }), "Priced");
  }
  function doMove(id: number) {
    if (location.trim() === "") { setActMsg(""); setActErr("A storage location is required."); return; }
    void act(() => post(id, "move", { location }), "Moved");
  }
  function doUpgrade(id: number) {
    void act(() => post(id, "upgrade", { upgrade_desc: upgrade ?? "" }), "Upgrade description");
  }

  /* A logistics cell: a dim label over a value that may be absent. An absent value prints as a
     dash rather than a blank, so "the workbook does not track this" is legible as a fact instead of
     looking like a cell that failed to load. */
  const cell = (label: string, value: string | null | undefined) => (
    <div className="rounded-control bg-surface-sunken px-3 py-2 ring-1 ring-line">
      <p className={kickerClass}>{label}</p>
      <p className="mt-1 truncate font-mono text-sm text-ink-900">{value ?? "-"}</p>
    </div>
  );

  return (
    <section
      ref={panel}
      aria-label="Unit detail"
      className={cn(
        "flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-card",
        "bg-surface-glass/90 ring-1 ring-line",
        "transition-transform duration-150 ease-out motion-reduce:transition-none",
        shown ? "translate-x-0" : "translate-x-6",
      )}
    >
      <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <p className={kickerClass}>Unit</p>
          {/* The identity block: the serial at the display step in the mono face - an ID is read
              character by character - and the model under it in the display face, which is the
              contrast the brief asks for. Both truncate rather than wrap, so a long serial cannot
              push the actions down the pane. */}
          <p id="unit-panel-title" className="truncate font-mono text-xl text-ink-900">
            {a?.serial_number ?? "#" + assetId}
          </p>
          <p className="mt-0.5 truncate font-display text-sm text-ink-600">
            {model || a?.model_number || "No model on this unit"}
          </p>
          {a && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge colorClass={statusTone(a.status)}>{a.status}</Badge>
              {a.grade
                ? <Badge colorClass={gradeTone(a.grade)}>{a.grade}</Badge>
                : <span className="text-xs text-ink-500">not graded</span>}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Clear the selected unit"
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-ink-400 ring-1 ring-line",
            "transition-colors duration-150 ease-out hover:text-ink-600 hover:ring-line-strong motion-reduce:transition-none",
            FOCUS,
          )}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
        {note && <p className="text-sm text-danger-600">{note}</p>}
        {!data && !note && <p className="text-sm text-ink-500">Reading the unit...</p>}

        {a && data && (
          <>
            {/* LOGISTICS. Warehouse and zone belong to the lot and the pallet to the unit, which is
                why they are three different reads on the payload - the grid is where that stops
                mattering to the person who has to walk to the shelf. */}
            <section>
              <p className={kickerClass}>Logistics</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {cell("Warehouse", data.lot?.warehouse)}
                {cell("Zone", data.lot?.zone)}
                {cell("Pallet", a.pallet)}
              </div>
              <p className="mt-2 text-xs text-ink-500">
                Lot <span className="font-mono text-ink-600">{data.lot?.lot_number ?? "-"}</span>
                {a.location ? <> &middot; location <span className="font-mono text-ink-600">{a.location}</span></> : null}
              </p>
            </section>

            {/* THE ACTION ZONE. The grade buttons are the point of the bench: four tactile targets
                at the minimum touch size, each one press away from grading the unit it names. */}
            <section className="space-y-3">
              <p className={kickerClass}>Action</p>

              <div role="group" aria-label="Set the grade">
                <div className="grid grid-cols-4 gap-2">
                  {GRADES.map((g) => {
                    const active = a.grade === g;
                    return (
                      <button
                        key={g}
                        type="button"
                        aria-pressed={active}
                        onClick={() => void gradeAs(g)}
                        className={cn(
                          "min-h-[52px] rounded-control font-display text-xl font-semibold ring-1",
                          "transition-colors duration-150 ease-out motion-reduce:transition-none",
                          FOCUS,
                          active
                            ? "bg-brand-700 text-white ring-brand-700"
                            : "bg-surface-sunken text-ink-700 ring-line hover:ring-line-strong",
                        )}
                      >
                        {g}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-ink-500">
                  One press grades the unit {a.grade ? "again" : ""} and updates its row in the queue.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="w-32">
                  <Input placeholder="cost cents" value={cost} onChange={(e) => setCost(e.target.value)}
                         aria-label="Cost in cents, applied with the next grade" />
                </div>
                <span className="text-xs text-ink-500">optional, rides with the next grade</span>
              </div>

              <div>
                <label htmlFor="bench-upgrade" className={cn(kickerClass, "block")}>
                  Upgrade description
                </label>
                <textarea
                  id="bench-upgrade"
                  rows={2}
                  value={upgrade ?? ""}
                  onChange={(e) => setUpgrade(e.target.value)}
                  placeholder="What was fitted or replaced"
                  className="mt-1 w-full rounded-control bg-surface-sunken px-3 py-2 text-sm text-ink-900 ring-1 ring-line outline-none placeholder:text-ink-500 focus:ring-2 focus:ring-brand-300"
                />
                <div className="mt-2 flex items-center gap-3">
                  <Button size="sm" onClick={() => doUpgrade(a.id)}>Save</Button>
                  <span className="text-xs text-ink-500">Blank clears it.</span>
                </div>
              </div>

              {actMsg && <p className="text-sm text-brand-300">{actMsg}</p>}
              {actErr && <p className="text-sm text-danger-600">{actErr}</p>}
            </section>

            <section>
              <p className={kickerClass}>Record</p>
              <dl className="mt-2 text-sm">
                <div className={LINE}><dt className="text-ink-500">Public id</dt><dd className="font-mono text-xs text-ink-700">{a.public_id}</dd></div>
                <div className={LINE}><dt className="text-ink-500">IMEI</dt><dd className="font-mono text-xs text-ink-700">{a.imei ?? "-"}</dd></div>
                <div className={LINE}><dt className="text-ink-500">Location</dt><dd className="text-ink-700">{a.location ?? "-"}</dd></div>
                <div className={LINE}><dt className="text-ink-500">Product</dt><dd className="text-ink-700">{a.product_id ?? "-"}</dd></div>
                <div className={LINE}><dt className="text-ink-500">Cost</dt><dd className="text-ink-700">{aud(a.cost_cents, "AUD")}</dd></div>
                <div className={LINE}><dt className="text-ink-500">Sale price</dt><dd className="text-ink-700">{aud(a.sale_price_cents, "AUD")}</dd></div>
                <div className={LINE}><dt className="text-ink-500">Intake</dt><dd className="text-ink-700">{when(a.intake_at)}</dd></div>
                <div className={LINE}><dt className="text-ink-500">Last change</dt><dd className="text-ink-700">{when(a.updated_at)}</dd></div>
                {a.notes && <div className={LINE}><dt className="text-ink-500">Notes</dt><dd className="text-right text-ink-700">{a.notes}</dd></div>}
              </dl>
            </section>

            <section>
              <p className={kickerClass}>Lot</p>
              {data.lot ? (
                <p className="mt-2 text-sm text-ink-600">
                  <span className="font-mono text-ink-900">{data.lot.lot_number}</span>
                  {" "}<Badge className="ml-1" colorClass={statusTone(data.lot.status)}>{data.lot.status}</Badge>
                  <span> &middot; received {when(data.lot.received_at)}</span>
                </p>
              ) : (
                <p className="mt-2 text-sm text-ink-500">The lot this unit belongs to is missing.</p>
              )}
            </section>

            <section>
              <p className={kickerClass}>Movements</p>
              {data.movements.length === 0 ? (
                <p className="mt-2 text-sm text-ink-500">No movement recorded for this unit.</p>
              ) : (
                <>
                  <ul className="mt-2 text-sm">
                    {data.movements.slice(0, MOVEMENT_SHOWN).map((m) => (
                      <li key={m.id} className={LINE}>
                        <span className="shrink-0 text-ink-500">{when(m.moved_at)}</span>
                        <span className="min-w-0 flex-1 truncate text-ink-700">{m.reason}</span>
                        <span className="tabular-nums text-ink-700">{m.qty}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="pt-1 text-xs text-ink-500">
                    {cut
                      ? "Showing " + MOVEMENT_SHOWN + " of the 50 most recent; the record may hold more."
                      : "Showing " + data.movements.length + " of " + data.movements.length + " recorded."}
                  </p>
                </>
              )}
            </section>

            <section className="space-y-3">
              <p className={kickerClass}>Lifecycle</p>
              <p className="text-xs text-ink-500">The database trigger refuses an illegal step, so a refusal here is the lifecycle talking.</p>

              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => act(() => post(a.id, "status", { status: "tested" }), "Tested")}>tested</Button>
                <Button variant="secondary" size="sm" onClick={() => act(() => post(a.id, "status", { status: "listed" }), "Listed")}>list for sale</Button>
                <Button variant="secondary" size="sm" onClick={() => act(() => post(a.id, "status", { status: "in_repair" }), "In repair")}>in repair</Button>
                <Button variant="secondary" size="sm" onClick={() => act(() => post(a.id, "status", { status: "sold" }), "Sold")}>mark sold</Button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="w-28">
                  <Input placeholder="price cents" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Sale price in cents" />
                </div>
                <Button size="sm" onClick={() => doPrice(a.id)}>price</Button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="w-36">
                  <Input placeholder="location" value={location} onChange={(e) => setLocation(e.target.value)} aria-label="Storage location" />
                </div>
                <Button size="sm" onClick={() => doMove(a.id)}>move</Button>
              </div>
            </section>
          </>
        )}
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
        <a href={"/admin/assets/" + assetId} className={cn("text-sm", linkClass, FOCUS)}>Open the full record</a>
        <span className="text-xs text-ink-500">history and reservations</span>
      </footer>
    </section>
  );
}

/* The five write doors, named once. The status door takes the target state in its body; the others
   take their own payload. Nothing here invents a parameter - each body is exactly what the
   handler's own schema declares. */
function post(id: number, door: "status" | "grade" | "price" | "move" | "upgrade", body: unknown): Promise<Response> {
  return apiFetch("/staff/assets/" + id + "/" + door, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
