"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Badge, Card, Input, PageHeader, Select, Table, TBody, TD, TH, THead, TR } from "@/app/components/ui";
import { gradeTone, statusTone } from "@/lib/ui";
import AssetPanel from "./AssetPanel";
import BulkBar from "./BulkBar";

/* The assets workbench: master-detail over the stock the shop actually holds.

   WHAT THE MASTER IS, AND WHY IT IS NOT A LOT. This screen's table is a table of UNITS, not of
   lots. What the endpoint behind it hands back per row is one asset - its serial, its lifecycle
   state, its grade, and the number of the lot it arrived in - and the three batch actions this
   panel offers are all per-unit doors. A lot is a real thing on this API, but the list of them is
   drawn on the intake screen, and a lot payload carries a count rather than the units themselves,
   so a lot-opening-its-units table here would have had to carry a second list to fill its own
   panel. The detail opened from a row is therefore that row's unit, read from the same endpoint
   /admin/assets/[id] reads.

   (Written without naming a utility in prose. The stylesheet is produced by scanning this text, so
   an English word that happens to match a utility name ships a real rule - this app's phase has
   already paid for that three times, and it cost two more words here before the closing test
   caught them.)

   The row itself is the one way in. A press anywhere on it opens the panel; the serial keeps its
   own link to the full record and stops the press from reaching the row underneath it. */
type Asset = { id: number; public_id: string; serial_number: string | null; status: string; grade: string | null; lot_number: string };

const STATUSES = ["received", "tested", "in_repair", "graded", "listed", "reserved", "sold", "shipped", "returned", "scrapped"];

/* The tick that puts a row into a batch. The control is the browser's own checkbox, painted with the
   accent the token layer declares; the label around it is the 36px hit target the whole app uses for
   a pointer-first control, so the mark itself stays small while the thing you aim at does not.
   The focus cue is the brighter emerald step, which clears 3:1 where the darker one would not. */
const TICK = "inline-flex h-9 w-9 items-center justify-center";
const TICK_BOX =
  "h-4 w-4 rounded accent-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";

/* A focused row has to look focused - the table is reachable by keyboard, so the row that carries
   the press has to carry a cue too. The wash is the same step the hover uses, so a reader sees one
   treatment whether the row is under the pointer or under the keyboard. */
const ROW_FOCUS = "focus-visible:outline-none focus-visible:bg-surface-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500";

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [status, setStatus] = useState("");
  const [lotNumber, setLotNumber] = useState("");
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

  /* The rows a batch would write: the ticks, narrowed to what is actually on screen, so an id left
     behind by a reload or by a change to either query field cannot quietly join a run. */
  const targets = assets.filter((a) => picked.includes(a.id));

  /* A partly ticked page is not a ticked page. The browser draws that middle state from a property
     rather than from markup, so it is set here. */
  useEffect(() => {
    if (all.current) { all.current.indeterminate = targets.length > 0 && targets.length < assets.length; }
  }, [targets.length, assets.length]);

  const closePanel = useCallback(() => setOpenId(null), []);
  const afterRun = useCallback(async () => { await load(); setRevision((v) => v + 1); }, [load]);

  function toggle(id: number, on: boolean) {
    setPicked((v) => (on ? (v.includes(id) ? v : [...v, id]) : v.filter((x) => x !== id)));
  }
  function toggleAll(on: boolean) {
    setPicked(on ? assets.map((a) => a.id) : []);
  }

  return (
    <main className="max-w-4xl mx-auto pt-8 px-4 space-y-6 pb-32">
      <PageHeader
        title={<>Assets workbench</>}
        description={
          <>
            Open a unit to read its record and write to it, or tick several and act on them together.
          </>
        }
      />

      <div className="flex gap-3">
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

      <Card className="p-4">
        <Table label="Assets">
          <THead>
            <TH>
              <input
                ref={all}
                type="checkbox"
                className={TICK_BOX}
                checked={assets.length > 0 && targets.length === assets.length}
                onChange={(e) => toggleAll(e.target.checked)}
                aria-label="Select every unit on this page"
              />
            </TH>
            <TH>Serial</TH><TH>Status</TH><TH>Grade</TH><TH>Lot</TH>
          </THead>
          <TBody>
            {assets.map((a) => {
              const on = picked.includes(a.id);
              return (
                <TR
                  key={a.id}
                  tabIndex={0}
                  className={"cursor-pointer " + ROW_FOCUS + " " + (on ? "bg-brand-50" : "hover:bg-surface-muted")}
                  onClick={(e) => { e.currentTarget.focus(); setOpenId(a.id); }}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) { return; }   // only the row itself - a descendant owns its own Space/Enter
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenId(a.id); }
                  }}
                >
                  {/* The cell swallows the press so a tick never also opens the panel - one press,
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
                  <TD><Badge colorClass={statusTone(a.status)}>{a.status}</Badge></TD>
                  <TD>{a.grade ? <Badge colorClass={gradeTone(a.grade)}>{a.grade}</Badge> : null}</TD>
                  <TD className="font-mono">{a.lot_number}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        {assets.length === 0 && <p className="text-ink-500 text-sm pt-2">no assets match</p>}
      </Card>

      {openId !== null && (
        <AssetPanel key={openId} assetId={openId} revision={revision} onClose={closePanel} />
      )}

      {/* Rendered only while something is ticked, and painted in the layer below the panel: a batch
          cannot be fired at the page while the record panel is covering it. */}
      {targets.length > 0 && (
        <BulkBar targets={targets} onDone={afterRun} onClear={() => setPicked([])} />
      )}
    </main>
  );
}
