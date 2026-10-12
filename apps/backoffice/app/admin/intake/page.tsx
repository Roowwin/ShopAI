"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { Badge, Button, Card, Heading, Input, Select, Table, TBody, TD, TH, THead, TR } from "@/app/components/ui";
import { statusTone } from "@/lib/ui";
import ValidationStream, { type Level, type StreamEvent } from "./ValidationStream";
import AiReview, { type Draft, type Photo, type RawField } from "./AiReview";
import DropZone from "./DropZone";
import LotWorkbench from "./LotWorkbench";
import ProductImportPanel from "@/app/admin/product-import/ProductImportPanel";

/* The intake screen.

   This job RESTYLES this surface and keeps every flow on it exactly as it was. The three calls
   below are the ones that were already here, with the same bodies, the same field names and the
   same endpoints:

     POST /staff/lots                - create a lot, then select it for scanning
     POST /staff/assets/scan-in      - one serial into one lot
     POST /staff/ai/intake-draft     - one photo read by the model, returning a draft

   What is new is around them: a drop target that drives the photo call, a record of the calls the
   page actually makes, and a review panel that puts the raw input beside the draft. No call was
   added, no parameter was invented, and nothing on this page writes anywhere the old page did
   not. A draft still touches no stock, and every write is still the operator's own press.

   HONESTY. Every line of the record and every value in the review comes from a request or from
   state the operator typed. Where the brief asks for something this build cannot supply - a
   spreadsheet reader, a live progress percentage - the panel says so in words instead of drawing
   a shape that would be read as data. */

type Lot = { id: number; lot_number: string; status: string; warehouse: string | null; asset_count: number };

/* The record cap. Without one a long session would let the record run on without a limit; the
   newest lines are the ones a reader acts on, so the oldest are dropped and the panel keeps its
   answer. */
const EVENT_CAP = 200;

/* A lot row is reachable by keyboard, so the row that carries the press has to carry a cue too.
   The cue is drawn INSIDE the row's edge because this row lives in the lots list's horizontal
   scroll box, and a scroll box trims anything painted outside its own box - the workbench's row
   list carries the same pair.

   The workbench's pair also carries a focus WASH, and it is deliberately NOT copied here: on the
   workbench a row opens a panel, but on THIS screen the row IS the selector, so a wash would
   paint over the chosen lot's own fill exactly while the operator is on the row they are choosing
   - the one moment the cue matters. The inset cue is the whole focus signal instead, and the audit
   measured it clear of the non-text bar on both grounds it can sit on. */
const ROW_FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500";

function sizeText(bytes: number): string {
  return bytes < 1024 ? bytes + " B" : Math.round(bytes / 1024) + " KB";
}

/* THE PIPELINE, in the order stock moves through it: a unit is brought in, graded, priced, then
   listed. The page is that funnel read downwards.

   `built` is not decoration. Price and List are stages this build does NOT have, and the strip
   says so in words on the stage itself rather than drawing an empty box that a reader would take
   for a feature. A stage that shows a spinner or a zero is a stage someone will wait on. */
const STAGES = [
  { n: 1, title: "Import", built: true },
  { n: 2, title: "Process", built: true },
  { n: 3, title: "Price", built: false },
  { n: 4, title: "List", built: false },
];

/* The funnel at a glance, above the stages themselves. An ordered list because the order is the
   information - these are steps, not options. */
function StageStrip() {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs">
      {STAGES.map((s, i) => (
        <li key={s.title} className="flex items-center gap-2">
          {i > 0 && <span aria-hidden="true" className="text-ink-500">&rarr;</span>}
          <span
            className={
              "rounded-full px-3 py-1 font-semibold ring-1 " +
              (s.built
                ? "bg-brand-50 text-brand-300 ring-brand-100"
                : "bg-surface-sunken text-ink-500 ring-line")
            }
          >
            {s.n}. {s.title}
            {!s.built && <span className="font-normal"> &ndash; not built</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/* One stage of the pipeline. It carries NO number: this page is ordered by who is doing the work
   and how often, not by the pipeline's sequence, so a big "1" on the second block down would be
   the page arguing with itself. The sequence lives on the strip above, which is the one place it
   is stated. */
function Stage({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-baseline gap-3 border-b border-line pb-3">
        <Heading level="h2" as="h2">{title}</Heading>
        {note && <p className="text-xs text-ink-500">{note}</p>}
      </div>
      {children}
    </section>
  );
}

export default function IntakePage() {
  const [lots, setLots] = useState<Lot[]>([]);
  const [warehouse, setWarehouse] = useState("WH-A");
  const [notes, setNotes] = useState("");
  const [serial, setSerial] = useState("");
  const [lotId, setLotId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [pending, setPending] = useState<string | null>(null);

  const seq = useRef(0);
  const photoUrl = useRef<string | null>(null);
  /* The draft call's ticket. `draftLive` is the door - 0 means nothing is out, and a second photo
     is refused rather than allowed to race the first. `draftSeq` is the identity of the newest
     call, so a response that is no longer the newest can write nothing at all. */
  const draftSeq = useRef(0);
  const draftLive = useRef(0);

  /* The record is appended to, never rewritten. The stamp is the real clock time at the moment
     the event was recorded, which is why it is taken here and not derived later. */
  const log = useCallback((level: Level, text: string) => {
    seq.current += 1;
    const at = new Date().toLocaleTimeString("en-AU", { hour12: false });
    const e: StreamEvent = { seq: seq.current, at, level, text };
    setEvents((v) => {
      const next = v.concat(e);
      return next.length > EVENT_CAP ? next.slice(next.length - EVENT_CAP) : next;
    });
  }, []);

  /* The preview address is made from the operator's own File and released when it is replaced or
     when the page goes away - an object address held past its use is a leak, and one released
     early would blank the photo still on screen. */
  useEffect(() => () => { if (photoUrl.current) { URL.revokeObjectURL(photoUrl.current); } }, []);

  function keepPhoto(file: File) {
    if (photoUrl.current) { URL.revokeObjectURL(photoUrl.current); }
    const url = URL.createObjectURL(file);
    photoUrl.current = url;
    setPhoto({ url, name: file.name, size: sizeText(file.size) });
  }

  const load = useCallback(async () => {
    const r = await apiFetch("/staff/lots?limit=50");
    if (r.ok) { const j: Lot[] = await r.json(); setLots(j); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function createLot() {
    setErr(""); setMsg("");
    setPending("/staff/lots");
    log("INFO", "POST /staff/lots - warehouse " + (warehouse.trim() || "none") + ", notes "
      + (notes.trim() ? "set" : "none") + ".");
    const r = await apiFetch("/staff/lots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ warehouse: warehouse || null, notes: notes || null }) });
    const j: any = await r.json().catch(() => ({}));
    setPending(null);
    if (r.status === 201) {
      setMsg("Created lot " + j.lot_number);
      setLotId(j.id);
      log("INFO", "Created lot " + j.lot_number + " (" + j.status + ") and selected it for scanning.");
      await load();
    } else {
      setErr(j.detail ?? "create failed");
      log("WARN", "Lot create refused (" + r.status + "): " + (j.detail ?? "no detail returned") + ".");
    }
  }

  async function scanIn() {
    setErr(""); setMsg("");
    if (lotId == null) { setErr("create or select a lot below first"); log("WARN", "Scan refused: no lot is selected."); return; }
    if (!serial.trim()) { setErr("serial required"); log("WARN", "Scan refused: a serial is required."); return; }
    const target = lots.find((l) => l.id === lotId);
    setPending("/staff/assets/scan-in");
    log("INFO", "POST /staff/assets/scan-in - lot " + (target ? target.lot_number : "#" + lotId)
      + ", serial " + serial.trim() + ".");
    const r = await apiFetch("/staff/assets/scan-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lot_id: lotId, serial_number: serial.trim() }) });
    const j: any = await r.json().catch(() => ({}));
    setPending(null);
    if (r.status === 201) {
      setMsg("Scanned " + j.serial_number);
      log("INFO", "Scanned " + j.serial_number + " into " + j.lot_number + " - it is "
        + j.status + ".");
      setSerial("");
      await load();
    } else {
      setErr(j.detail ?? "scan failed");
      log("WARN", "Scan refused (" + r.status + "): " + (j.detail ?? "no detail returned") + ".");
    }
  }

  async function aiDraft(file: File) {
    /* Re-entry is refused. Two calls in flight can answer out of order, and the review panel draws
       the photo and the draft as ONE record - a late answer would pair photo B with draft A's
       brand, model and serial, and the prefill would then copy A's serial into the field the
       operator is matching against B. The door is shut here as well as in the zone, because this
       is the function that owns the state, not the widget that calls it. */
    if (draftLive.current !== 0) { return; }
    const me = ++draftSeq.current;
    draftLive.current = me;
    setAiBusy(true); setErr(""); setDraft(null);
    keepPhoto(file);
    setPending("/staff/ai/intake-draft");
    log("AI", "POST /staff/ai/intake-draft - reading " + file.name + " (" + sizeText(file.size) + ").");
    const fd = new FormData();
    fd.append("image", file);
    /* EVERY exit from here leaves through the finally below, and that block is the only place the
       door is reopened and the two flags are cleared. Nothing between the try and the finally has
       to remember to do it, and a path added later cannot forget: the parse used to sit outside
       this block, so a 2xx whose body did not parse escaped with the door still shut and every
       later photo was dropped in silence. */
    try {
      /* The call itself is the base's own expression, unchanged. Only the way a REJECTED request is
         handled differs, and only so the door can reopen. */
      let r: Response | null = null;
      try {
        r = await apiFetch("/staff/ai/intake-draft", { method: "POST", body: fd });
      } catch {
        r = null;
      }
      /* Only the newest call may touch the panel. A response that has been superseded writes
         nothing - not the draft, not the waiting marker, not the busy flag. */
      if (draftLive.current !== me) { return; }
      if (r === null) {
        /* The request never landed - a transport failure, or the session gate tearing the page
           away. */
        setErr("the draft request could not be sent");
        log("WARN", "Draft not sent: the request could not be made.");
        return;
      }
      if (!r.ok) {
        const j: any = await r.json().catch(() => ({}));
        setErr(j.detail ?? "AI draft failed");
        log("WARN", "Draft refused (" + r.status + "): " + (j.detail ?? "no detail returned") + ".");
        return;
      }
      /* An answer that arrived but cannot be read is an exit of its own. The call is over, so the
         door reopens and the panel says the answer was unreadable rather than reporting a draft it
         never received. */
      const d: Draft | null = await r.json().catch(() => null);
      if (d === null) {
        setErr("the draft answer could not be read");
        log("WARN", "Draft unreadable: the answer arrived, but it could not be read.");
        return;
      }
      setDraft(d);
      log("AI", "Draft back: " + d.brand + " " + d.model + " - grade " + d.suggested_grade
        + ", confidence " + d.confidence + ".");
    } finally {
      /* The door closes on every path, a superseded one included - there the guard leaves the flags
         to the newer call that owns them, and that call's own exit through here clears them. */
      if (draftLive.current === me) {
        draftLive.current = 0;
        setPending(null);
        setAiBusy(false);
      }
    }
  }

  /* A file arrived and this build cannot read it. The zone says what it established - a sheet or
     merely "not a photo" - and the record repeats the same distinction rather than calling every
     non-image a spreadsheet. Nothing was sent either way. */
  function onRefuse(name: string, sheet: boolean) {
    log("WARN", (sheet
      ? "Spreadsheet refused: " + name + " - this build has no spreadsheet reader"
      : "File refused: " + name + " - it is not a photo")
      + ", so nothing was read and nothing was sent. A photo can be scanned instead.");
  }

  function prefill() {
    if (!draft) return;
    if (draft.serial_visible) setSerial(draft.serial_visible.trim());
    setNotes("AI draft: " + draft.brand + " " + draft.model + " - " + draft.condition_notes + " (suggest grade " + draft.suggested_grade + ")");
    log("INFO", "Prefilled the scan-in fields from the draft"
      + (draft.serial_visible ? " - serial " + draft.serial_visible.trim() + "." : " - the photo showed no serial."));
  }

  const selected = lots.find((l) => l.id === lotId) ?? null;
  const raw: RawField[] = [
    { label: "Lot", value: selected ? selected.lot_number : "none selected" },
    { label: "Warehouse", value: warehouse.trim() || "not set" },
    { label: "Serial", value: serial.trim() || "not entered" },
    { label: "Lot notes", value: notes.trim() ? notes.trim() : "not entered" },
  ];

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 pt-8 pb-16">
      <div>
        <Heading level="h1">Lot Process</Heading>
        <p className="mt-1 text-sm text-ink-500">
          Grade a lot's units - search for the lot and work down the queue. Bringing stock in,
          pricing and listing are the stages around it. Everything is confirmed by you.
        </p>
      </div>

      <StageStrip />

      <Stage title="Grading queue" note="Stage 2. The daily work - grade what came in.">
        <LotWorkbench />
      </Stage>

      <Stage title="Import" note="Stage 1. The occasional job, so it sits under the queue.">
      <details className="rounded-card bg-surface ring-1 ring-line">
        <summary className="cursor-pointer rounded-card px-6 py-4 text-sm font-semibold text-ink-600 transition-colors duration-fast ease-out motion-reduce:transition-none hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700">
          Open the intake tools &ndash; product sheet, photo &amp; scan
        </summary>
        <div className="space-y-6 border-t border-line p-6">
      <ProductImportPanel />

      <div className="border-t border-line pt-6">
        <Heading level="h3" as="h2" className="!text-eyebrow uppercase text-ink-500">
          Photo &amp; scan
        </Heading>
        <p className="mt-1 text-xs text-ink-500">
          The other way in: read one unit from a photo, create a lot, scan serials into it.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <Heading level="h3" as="h2">Photo intake</Heading>
          <p className="mt-1 pb-4 text-xs text-ink-500">
            The model only reads the photo - you confirm everything. Drafts never touch stock.
          </p>
          <DropZone onPhoto={aiDraft} onRefuse={onRefuse} busy={aiBusy} />
        </Card>

        <Card className="p-6">
          <ValidationStream
            events={events}
            pending={pending}
            idle="No intake call has been made yet - waiting."
          />
        </Card>
      </div>

      <Card className="p-6">
        <AiReview photo={photo} raw={raw} draft={draft} reading={aiBusy} onPrefill={prefill} />
      </Card>

      <Card className="p-6 space-y-6">
        <Heading level="h3" as="h2">Capture</Heading>

        <section>
          {/* A real heading, not a styled paragraph: these two label sections of the page, and the
              heading structure a screen reader announces had lost them. They carry the kicker's
              size, tracking, case and ink - and the primitive's weight, so they are semibold where
              a kicker label is regular. That is deliberate rather than missed: the page's other two
              headings under this one are the same primitive at the same weight, so the heading set
              now agrees with itself, and a weight reset would need a second important utility to
              beat the primitive's deterministically. The one important utility here is what keeps
              the kicker size, which the built sheet would otherwise decide - it emits the
              primitive's size class later than the kicker's. */}
          <Heading level="h3" as="h2" className="!text-eyebrow uppercase text-ink-500">New lot</Heading>
          <div className="mt-2 flex flex-wrap gap-3">
            <div className="w-40">
              <Input placeholder="warehouse" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} />
            </div>
            {/* The width goes on a wrapper, never on the field: Input carries its own full width in
                the base and this app has no merge step, so a width passed alongside it would be
                decided by stylesheet order rather than by intent. */}
            <div className="min-w-[12rem] flex-1">
              <Input placeholder="notes / supplier ref" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <Button onClick={createLot}>Create lot</Button>
          </div>
        </section>

        <section className="border-t border-line pt-6">
          <Heading level="h3" as="h2" className="!text-eyebrow uppercase text-ink-500">Scan in</Heading>
          <div className="mt-2 flex flex-wrap gap-3">
            <Select value={lotId ?? ""} onChange={(e) => setLotId(e.target.value ? parseInt(e.target.value) : null)} aria-label="Lot to scan into">
              <option value="">select lot...</option>
              {lots.map((l) => <option key={l.id} value={l.id}>{l.lot_number} ({l.status}, {l.asset_count} units)</option>)}
            </Select>
            <div className="min-w-[12rem] flex-1">
              <Input placeholder="serial number" value={serial} onChange={(e) => setSerial(e.target.value)} aria-label="Serial number" />
            </div>
            <Button onClick={scanIn}>Scan</Button>
          </div>
          <p className="mt-2 text-xs text-ink-500">
            One serial per press, into the lot chosen above. The serial field is the one a draft
            prefills.
          </p>
        </section>
      </Card>

      <Card className="p-6">
        <Heading level="h3" as="h2">Lots</Heading>
        <p className="mt-1 pb-2 text-xs text-ink-500">Pick a row to choose the lot the scan-in will use.</p>
        <Table label="Lots">
          <THead>
            <TH>Lot</TH><TH>Status</TH><TH>WH</TH><TH>Units</TH>
          </THead>
          <TBody>
            {lots.map((l) => (
              <TR
                key={l.id}
                tabIndex={0}
                aria-current={lotId === l.id ? "true" : undefined}
                className={"cursor-pointer " + ROW_FOCUS + " " + (lotId === l.id ? "bg-brand-50" : "hover:bg-surface-muted")}
                onClick={(e) => { e.currentTarget.focus(); setLotId(l.id); }}
                onKeyDown={(e) => {
                  /* Only the row itself. A descendant owns its own Space and Enter, so a rule that
                     fired on the bubbled event would swallow the control the reader was on. */
                  if (e.target !== e.currentTarget) { return; }
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setLotId(l.id); }
                }}
              >
                <TD className="font-mono">{l.lot_number}</TD>
                <TD><Badge colorClass={statusTone(l.status)}>{l.status}</Badge></TD>
                <TD>{l.warehouse}</TD>
                <TD>{l.asset_count}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      {msg && <p className="text-brand-300 text-sm">{msg}</p>}
      {err && <p className="text-danger-600 text-sm">{err}</p>}
        </div>
      </details>
      </Stage>

      <Stage title="Price" note="Stage 3. Not built yet.">
        <Card className="p-6">
          <p className="text-sm text-ink-500">
            The store manager's half of the pipeline: the grading queue takes a unit
            received &rarr; graded, and this stage takes it graded &rarr; priced &rarr; listed. It
            is not built, so it draws nothing rather than an empty box - nothing on this page sets a
            price and no placeholder price is invented for one. Units are priced from the Asset
            Workbench until this stage exists. Every unit the grading queue marks{" "}
            <span className="font-semibold text-ink-600">Ready for pricing</span> is what this stage
            will read when it is written.
          </p>
        </Card>
      </Stage>

      <Stage title="List" note="Stage 4. Not built yet.">
        <Card className="p-6">
          <p className="text-sm text-ink-500">
            Listing is not a pipeline stage yet. A unit reaches the shop today by being listed from
            the Asset Workbench, which needs a grade and a price first; this stage is where that
            moves once pricing exists.
          </p>
        </Card>
      </Stage>
    </main>
  );
}
