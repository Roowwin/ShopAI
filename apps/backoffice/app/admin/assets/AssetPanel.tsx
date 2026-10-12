"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { apiFetch } from "@/lib/api";
import { Badge, Button, Input, Select, cn } from "@/app/components/ui";
import { aud, when } from "@/lib/format";
import { gradeTone, kickerClass, linkClass, statusTone } from "@/lib/ui";

/* The workbench's right-hand record panel, opened from a row.

   It shows the record the row summarises - serial, status, grade and lot come straight off the
   master line, and the rest (identity, storage, money, movement history) comes from the single
   unit endpoint the read-only detail route already uses. Same payload, one fetch, so this panel
   and /admin/assets/[id] cannot disagree about a unit.

   The per-unit writes live HERE rather than on the read-only detail route, which states in its own
   header that the writes which move a unit belong to the workbench. They are the same calls the
   workbench's own card made, moved rather than reinvented: the status door, the grade
   door, the price door and the move door, each with the body its handler's own schema declares.

   FOCUS. Opening remembers the element that opened it and closing hands focus back to it, which is
   the pattern the command palette set for the chrome: a panel that drops focus on the document
   strands anyone who opened it from the middle of the table. Tab is kept inside the panel while it
   is open, so the claim this element makes to assistive technology is true.

   MOTION. One slide, run through the app's own timing classes, with the reduced-motion pair
   alongside it so the panel arrives without travelling. No animation library. */

type Asset = { id: number; public_id: string; product_id: number | null; serial_number: string | null;
               imei: string | null; status: string; grade: string | null; cost_cents: number | null;
               sale_price_cents: number | null; intake_at: string; location: string | null;
               notes: string | null; lot_id: number; updated_at: string };
type Lot = { id: number; lot_number: string; status: string; warehouse: string | null; received_at: string } | null;
type Movement = { id: number; moved_at: string; qty: number; reason: string; actor_staff_id: number | null };
type Detail = { asset: Asset; lot: Lot; movements: Movement[] };

const GRADES = ["A", "B", "C", "D"];

/* The endpoint caps movements at 50 and hands back no total to compare against, so the note fires
   at the cap - the only case in which the list may have been cut short. A shorter list is complete
   by construction, which is why the plain count it prints then is the whole truth. */
const MOVEMENT_CAP = 50;
const MOVEMENT_SHOWN = 5;

/* One line of the record: a dim term and its value. It carries a hover wash because the panel's
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

/* `revision` is how a batch that finished behind an open panel gets reflected in it: the parent
   bumps it after a run, and the fetch below reads the unit again. Passing it as a dependency rather
   than as a remount key keeps the panel's focus and its slide where they are. */
export default function AssetPanel({ assetId, revision = 0, onClose }: { assetId: number; revision?: number; onClose: () => void }) {
  const panel = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);
  const [data, setData] = useState<Detail | null>(null);
  const [note, setNote] = useState("");
  const [actMsg, setActMsg] = useState("");
  const [actErr, setActErr] = useState("");
  const [grade, setGrade] = useState("A");
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");
  const [location, setLocation] = useState("");

  /* Focus goes in on open and comes back on close. The element that had it is captured before the
     panel takes over; the slide waits one frame so the browser has a starting position to travel
     from. */
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => setShown(true));
    panel.current?.focus();
    return () => {
      cancelAnimationFrame(frame);
      back?.focus?.();
    };
  }, []);

  /* Escape and the pointer exit. The outside press is watched on the document rather than bound to
     the scrim, exactly as the command palette does it: the scrim then stays a plain painted layer
     with no behaviour of its own, and a press anywhere outside the panel closes it. */
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { onClose(); } };
    const onDown = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) { onClose(); }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
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
    setData(await r.json().catch(() => null));
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

  /* Tab stays with the panel while it is open: the last control wraps to the first and the first
     wraps back to the last, in both directions. */
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") { return; }
    const root = panel.current;
    if (!root) { return; }
    const stops = root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (stops.length === 0) { e.preventDefault(); return; }
    const first = stops[0];
    const last = stops[stops.length - 1];
    /* The panel's own body is where focus lands on open, and it is not one of the stops - so going
       backwards from it has to wrap like going backwards from the first stop would, or the panel
       would leak focus into the page behind it on the very first key press. */
    const atStart = document.activeElement === first || document.activeElement === root;
    if (e.shiftKey && atStart) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  const a = data?.asset;
  const cut = data ? data.movements.length >= MOVEMENT_CAP : false;

  function doGrade(id: number) {
    if (cost.trim() !== "" && !centsGuard(cost)) { setActMsg(""); setActErr("The cost has to be a whole number of cents, zero or more."); return; }
    void act(() => post(id, "grade", { grade, ...(cost.trim() !== "" ? { cost_cents: Number(cost) } : {}) }), "Graded");
  }
  function doPrice(id: number) {
    if (!centsGuard(price)) { setActMsg(""); setActErr("The sale price has to be a whole number of cents, zero or more."); return; }
    void act(() => post(id, "price", { sale_price_cents: Number(price) }), "Priced");
  }
  function doMove(id: number) {
    if (location.trim() === "") { setActMsg(""); setActErr("A storage location is required."); return; }
    void act(() => post(id, "move", { location }), "Moved");
  }

  return (
    <>
      {/* The scrim is the palette's own step, reused rather than re-derived. It is painted below the
          panel, and the outside press that dismisses it is watched on the document - so a press on
          the panel itself is never mistaken for one outside it. */}
      <div className="fixed inset-0 z-40 bg-surface-muted/70 backdrop-blur-sm" aria-hidden="true" />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unit-panel-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col outline-none",
          "bg-surface-glass/90 ring-1 ring-line shadow-glow backdrop-blur-md",
          "transition-transform duration-150 ease-out motion-reduce:transition-none",
          shown ? "translate-x-0" : "translate-x-full",
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <p className={kickerClass}>Unit</p>
            <p id="unit-panel-title" className="truncate font-mono text-lg text-ink-900">
              {a?.serial_number ?? "#" + assetId}
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
            aria-label="Close the unit panel"
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
                    {data.lot.warehouse ? <span> &middot; {data.lot.warehouse}</span> : null}
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
                <p className={kickerClass}>Writes</p>
                <p className="text-xs text-ink-500">The database trigger refuses an illegal step, so a refusal here is the lifecycle talking.</p>

                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => act(() => post(a.id, "status", { status: "tested" }), "Tested")}>tested</Button>
                  <Button variant="secondary" size="sm" onClick={() => act(() => post(a.id, "status", { status: "listed" }), "Listed")}>list for sale</Button>
                  <Button variant="secondary" size="sm" onClick={() => act(() => post(a.id, "status", { status: "in_repair" }), "In repair")}>in repair</Button>
                  <Button variant="secondary" size="sm" onClick={() => act(() => post(a.id, "status", { status: "sold" }), "Sold")}>mark sold</Button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Select className="w-20" value={grade} onChange={(e) => setGrade(e.target.value)} aria-label="Grade">
                    {GRADES.map((g) => <option key={g}>{g}</option>)}
                  </Select>
                  <div className="w-28">
                    <Input placeholder="cost cents" value={cost} onChange={(e) => setCost(e.target.value)} aria-label="Cost in cents" />
                  </div>
                  <Button size="sm" onClick={() => doGrade(a.id)}>grade</Button>
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

                {actMsg && <p className="text-sm text-brand-300">{actMsg}</p>}
                {actErr && <p className="text-sm text-danger-600">{actErr}</p>}
              </section>
            </>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
          <a href={"/admin/assets/" + assetId} className={cn("text-sm", linkClass, FOCUS)}>Open the full record</a>
          <span className="text-xs text-ink-500">history and reservations</span>
        </footer>
      </div>
    </>
  );
}

/* The four write doors, named once. The status door takes the target state in its body; the other
   three take their own payload. Nothing here invents a parameter - each body is exactly what the
   handler's own schema declares. */
function post(id: number, door: "status" | "grade" | "price" | "move", body: unknown): Promise<Response> {
  return apiFetch("/staff/assets/" + id + "/" + door, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
