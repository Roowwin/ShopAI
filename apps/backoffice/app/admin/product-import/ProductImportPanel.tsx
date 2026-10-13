"use client";

/* Product import: a supplier workbook in, lots and units out.

   FOUR STAGES, NAMED. Drop the sheet -> see the column mapping -> preview the rows -> read the
   result report. The rail at the top of the page names them and marks where the operator is, because
   the two middle stages used to share one card and the question they answer is not the same one: the
   mapping asks "did it read my columns the way I meant them?", and the preview asks "what will
   happen to my rows?". The first is about the SHAPE of the sheet and the second about its CONTENT,
   and an operator checking the first should not have to scroll past the second to find it.

   DROPPING THE SHEET READS IT, because reading writes nothing. The middle state is the whole point
   of the screen: a product sheet names its columns the way the supplier's system does (Class, Mfg,
   Model, Serial#, Resale), and the operator's question before any stock is created is the mapping
   the server actually found - source header to target field - plus the headers it did NOT use, by
   name. A column that silently failed to map is the expensive failure here, and it is invisible in a
   summary that only counts rows. So the drop goes straight to the read; the only press that writes
   is still the one on the mapping's own "Import" button.

   NOTHING ON THIS SCREEN IS COUNTED LOCALLY. Every figure - rows, ready, blocked, lots - is a
   field the server returned. The browser holds no row list of its own; the sample below is the
   server's sample, capped by the server, and the page says so when it was capped. This is the same
   rule the intake screen's absence panel follows, in the other direction: the panel refuses to
   draw rows it does not have, and this page refuses to compute a number it was not given.

   SUPPLIER WORDING IS TRANSLATED, AND THE TRANSLATION IS SHOWN. The sheet's own vocabulary does
   not always match the system's: the supplier's "Active" is this system's "received" (taken in,
   ready to be tested and graded), and "Unassessed" means there is no grade, which is a null rather
   than an error. The server rewrites those, and this page prints the distinct rewrites with a row
   count above the grid. A translation the operator cannot see would be a silent edit to their
   data, which is worse than the mismatch it fixes.

   THE TWO PRESSES ARE DIFFERENT. "Read the sheet" is a preview and writes nothing, ever - it is
   safe on a file nobody has checked. "Import" is the write. A refused import comes back with the
   same preview payload it was refused from, so the blocking rows are re-rendered in place rather
   than replaced by a generic failure the operator cannot act on.

   WHAT THIS PAGE CANNOT DO WITHOUT A SESSION: the file picker, the drag-and-drop-free input and
   the row rendering are only exercised by a browser. The build proves it compiles and the payload
   shapes match what the server sends; it does not prove the screen looks right. */

import { useState } from "react";

import { Badge, Button, Card, Heading, Stat, Table, TBody, TD, TH, THead, TR, cn } from "@/app/components/ui";
import { apiFetch } from "@/lib/api";
import { aud } from "@/lib/format";
import { gradeTone, kickerClass, statusTone } from "@/lib/ui";

import SheetDrop from "./SheetDrop";

type ColumnHit = { header: string; field: string; label: string; index: number };
type Issue = { row: number; field: string; message: string };
type Translation = { field: string; from: string; to: string; rows: number };
type RowTranslation = { field: string; from: string; to: string };

type PreviewRow = {
  row: number;
  serial_number: string;
  lot_number: string;
  grade: string | null;
  status: string;
  sale_price_cents: number | null;
  brand: string;
  category: string;
  model: string;
  asset_tag: string;
  technical_notes: string;
  issues: Issue[];
  translations: RowTranslation[];
  /* The rest of the supplier workbook. Every one is optional because the server sends whatever the
     sheet carried - a twelve-column sheet yields a row with these absent, and the preview must
     render that rather than claim the columns were empty. */
  class?: string;
  model_number?: string;
  upgrade?: string;
  upgrade_desc?: string;
  audit_desc?: string;
  cosmetics_desc?: string;
  functional_desc?: string;
  fmv_cents?: number | null;
  settlement_cents?: number | null;
  channel?: string;
  on_shelf?: boolean | null;
  pallet?: string;
  location?: string;
  sku?: string;
  lot_load_id?: string;
  lot_account?: string;
  lot_zone?: string;
  lot_warehouse?: string;
};

type Preview = {
  mode: string;
  file: { name: string; sheet: string; rows: number };
  columns: { detected: ColumnHit[]; unmapped: string[]; missing: string[]; missing_labels: string[] };
  issues: Issue[];
  translations: Translation[];
  sample: PreviewRow[];
  sample_limit: number;
  truncated: boolean;
  detail?: string;
  summary: { rows: number; ready: number; blocked: number; lots: number; would_list: number; issues: number; translated: number };
};

type Commit = {
  mode: string;
  file: { name: string; sheet?: string };
  summary: {
    rows: number;
    assets_created: number;
    lots_created: number;
    lots_reused: number;
    products_created: number;
    listed: number;
  };
  lots_created: { lot_number: string; id: number }[];
  lots_reused: string[];
  products_created: { id: number; brand: string; category: string; model: string }[];
  assets: { row: number; asset_id: number; serial_number: string; lot_number: string; status: string; grade: string | null; sale_price_cents: number | null }[];
};

/* How many issue lines to render before collapsing the tail. The COUNT is never truncated - only
   the list - so a reader always knows how many there are. */
const ISSUE_SHOWN = 12;

/* The four stages, in the order the operator walks them. One list, drawn twice: as the rail at the
   top of the page and as each card's own heading, so a stage cannot be renamed in one place and
   left behind in the other. `done` is what the rail dims - a stage the operator has already passed
   is not the one they are being asked about. */
const STAGES = ["Drop the sheet", "Column mapping", "Preview", "Result report"] as const;

export default function ProductImportPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Preview | null>(null);
  const [result, setResult] = useState<Commit | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  function reset() {
    setFile(null);
    setReport(null);
    setResult(null);
    setMsg("");
    setErr("");
  }

  /* A dropped or chosen sheet is read at once - the read writes nothing, so waiting for a second
     press would ask the operator to confirm something that has no consequence. `picked` is passed
     explicitly rather than read from state: `setFile` above has not landed yet in the same tick, and
     a read that posted the PREVIOUS file would be the worst kind of quiet bug. */
  function picked(f: File | null) {
    setFile(f);
    setReport(null);
    setResult(null);
    setMsg("");
    setErr("");
    if (f) void send("preview", f);
  }

  async function send(phase: "preview" | "commit", explicit?: File | null) {
    const sheet = explicit ?? file;
    if (!sheet || busy) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const fd = new FormData();
      fd.append("file", sheet);
      const r = await apiFetch(`/staff/imports/products/${phase}`, { method: "POST", body: fd });
      const j: any = await r.json().catch(() => ({}));
      if (phase === "preview") {
        if (!r.ok) {
          setErr(typeof j.detail === "string" ? j.detail : "the sheet could not be read");
          return;
        }
        setReport(j as Preview);
        setResult(null);
        setMsg(`Read ${j.file.rows} rows from ${j.file.name}. Nothing has been created yet.`);
        return;
      }
      if (r.status === 422 && j.detail && typeof j.detail === "object") {
        setReport(j.detail as Preview);
        setResult(null);
        setErr(String(j.detail.detail ?? "some rows cannot be imported - nothing was written"));
        return;
      }
      if (!r.ok) {
        setErr(typeof j.detail === "string" ? j.detail : "the import was refused");
        return;
      }
      setResult(j as Commit);
      setReport(null);
      setMsg(`Imported ${j.summary.assets_created} units from ${j.file.name}.`);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  /* Where the operator is, from what the page actually holds: a result means the last stage, a
     report means the preview, a chosen sheet means the read is out, and nothing means the drop. */
  const stage = result ? 3 : report ? 2 : 1;

  return (
    <div className="space-y-6">

      <StageRail current={stage} result={!!result} />

      <Card className="p-6">
        <Heading level="h3" as="h2" className={cn(!report && !result && "!text-brand-300")}>
          1. {STAGES[0]}
        </Heading>
        <p className="mt-1 pb-4 text-xs text-ink-500">
          A CSV, TSV or XLSX export with the product headers: Asset, Status, Lot, Class, Mfg,
          Model, Grade, Serial#, Resale, and the Audit / Cosmetic / Functional description columns.
          Columns are matched by name, so their order does not matter. Supplier wording is
          translated where it differs - "Active" is imported as received, "Unassessed" as no grade -
          and every translation is listed in the mapping before anything is created.
        </p>
        <SheetDrop file={file} busy={busy} onFile={picked} />
        <div className="mt-4 flex flex-wrap gap-3">
          {(report || result || file) && (
            <Button variant="secondary" onClick={reset} disabled={busy}>
              Start over
            </Button>
          )}
          {file && !busy && !report && (
            <Button variant="secondary" onClick={() => send("preview")}>Read it again</Button>
          )}
        </div>
      </Card>

      {msg && <p className="text-brand-300 text-sm">{msg}</p>}
      {err && <p className="text-danger-600 text-sm">{err}</p>}

      {report && <MappingPanel report={report} />}
      {report && <PreviewPanel report={report} busy={busy} onCommit={() => send("commit")} />}
      {result && <ResultPanel result={result} />}
    </div>
  );
}

/* The four stages, and which one the operator is on. It is aria-current, not a colour alone: the
   current stage is announced, so the rail is not a decoration only a sighted reader can use. */
function StageRail({ current, result }: { current: number; result: boolean }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" aria-label="Import stages">
      {STAGES.map((s, i) => {
        const here = i === current && !(result && i < 3);
        const done = i < current || (result && i < 3);
        return (
          <li key={s} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden="true" className="text-ink-400">/</span>}
            <span
              aria-current={here ? "step" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5",
                here ? "font-semibold text-brand-300" : done ? "text-ink-500" : "text-ink-400",
              )}
            >
              <span className={cn(
                "inline-flex h-5 w-5 items-center justify-center rounded-full text-xs",
                here ? "bg-brand-700 text-white" : done ? "bg-surface-sunken text-ink-600" : "bg-surface-sunken text-ink-400",
              )}>{i + 1}</span>
              {s}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* One optional text cell in the sample grid. A blank prints as a dash so a column the sheet did
   not carry is visibly empty rather than visually absent - with twenty-six columns on screen, a
   missing cell and a missing column look identical otherwise. */
function Cell({ v }: { v: string | null | undefined }) {
  return <>{v ? v : <span className="text-ink-500">-</span>}</>;
}

/* Stage two: the mapping the server found. It answers a question about the sheet's SHAPE, which is
   why it stands on its own card - an operator whose "Model #" column matched nothing is looking for
   that, not for a row count, and the two used to share a heading. */
function MappingPanel({ report }: { report: Preview }) {
  const { columns } = report;

  return (
    <Card className="p-6 space-y-6">
      <div>
        <Heading level="h3" as="h2">2. {STAGES[1]}</Heading>
        <p className="mt-1 text-xs text-ink-500">
          {report.file.name}
          {report.file.sheet ? ` - sheet "${report.file.sheet}"` : ""}. Did it read your columns the
          way you meant them? A header it did not use is named below rather than dropped quietly.
        </p>
      </div>

      {report.translations.length > 0 && (
        <section>
          <Heading level="h3" as="h2" className="!text-eyebrow uppercase text-ink-500">
            Translated values
          </Heading>
          <p className="mt-2 mb-3 text-xs text-ink-500">
            Your sheet says these; the system will record the right-hand value. The wording differs,
            the unit does not.
          </p>
          <Table label="Supplier wording translated by this import">
            <THead>
              <TR>
                <TH>Column</TH>
                <TH>Your value</TH>
                <TH>Recorded as</TH>
                <TH>Rows</TH>
              </TR>
            </THead>
            <TBody>
              {report.translations.map((t) => (
                <TR key={`${t.field}-${t.from}`}>
                  <TD className="text-ink-600">{t.field}</TD>
                  <TD className="font-mono text-xs">{t.from}</TD>
                  <TD className="font-mono text-xs text-brand-300">{t.to}</TD>
                  <TD>{t.rows}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </section>
      )}

      <section>
        <Heading level="h3" as="h2" className="!text-eyebrow uppercase text-ink-500">
          Columns matched
        </Heading>
        <div className="mt-3">
          <Table label="Column mapping found in the sheet">
            <THead>
              <TR>
                <TH>Your column</TH>
                <TH>Becomes</TH>
              </TR>
            </THead>
            <TBody>
              {columns.detected.map((c) => (
                <TR key={c.header + c.index}>
                  <TD className="font-mono text-xs text-ink-600">{c.header}</TD>
                  <TD>{c.label}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      </section>

      {(columns.unmapped.length > 0 || columns.missing.length > 0) && (
        <section className="border-t border-line pt-6">
          <Heading level="h3" as="h2" className="!text-eyebrow uppercase text-ink-500">
            Columns not used
          </Heading>
          {columns.unmapped.length > 0 ? (
            <p className="mt-2 text-sm text-ink-500">
              These headers were read but matched nothing, so nothing in them is imported:{" "}
              <span className="font-mono text-xs text-ink-600">{columns.unmapped.join(", ")}</span>
            </p>
          ) : (
            <p className="mt-2 text-sm text-ink-500">Every header in the sheet matched a field.</p>
          )}
          {columns.missing.length > 0 && (
            <p className="mt-2 text-sm text-danger-600">
              Required and absent:{" "}
              <span className="font-semibold">{columns.missing_labels.join(", ")}</span>. Every row is
              blocked until the sheet carries {columns.missing_labels.length === 1 ? "it" : "them"}.
            </p>
          )}
        </section>
      )}
    </Card>
  );
}

/* The row preview. Ordered so the operator's eye lands on a blocked row before the row data: the
   counts first, then the reason nothing would be written, then the rows themselves. */
function PreviewPanel({ report, busy, onCommit }: { report: Preview; busy: boolean; onCommit: () => void }) {
  const { summary } = report;
  const blocked = summary.blocked > 0;
  const shown = report.issues.slice(0, ISSUE_SHOWN);

  return (
    <Card className="p-6 space-y-6">
      <div>
        <Heading level="h3" as="h2">3. {STAGES[2]}</Heading>
        <p className="mt-1 text-xs text-ink-500">
          {report.file.name} - what would happen to these rows. Nothing below has touched stock.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Rows read" value={summary.rows} sub="data rows, header excluded" />
        <Stat label="Ready" value={summary.ready} sub="rows that would import" />
        <Stat label="Blocked" value={summary.blocked} sub={blocked ? "these stop the whole import" : "none - the file is clean"} />
        <Stat label="Translated" value={summary.translated} sub={summary.translated ? "rows rewritten - see the mapping above" : "no supplier wording needed translating"} />
      </div>

      {blocked && (
        <div className="rounded-card bg-danger-50 ring-1 ring-danger-200 p-4">
          <p className="text-sm font-semibold text-danger-600">
            {summary.blocked} of {summary.rows} rows cannot be imported.
          </p>
          <p className="mt-1 text-xs text-ink-500">
            An import is all or nothing, so pressing the button below would create nothing at all.
            Fix these rows in the sheet and read it again.
          </p>
        </div>
      )}

      {report.issues.length > 0 && (
        <section className="border-t border-line pt-6">
          <Heading level="h3" as="h2" className="!text-eyebrow uppercase text-ink-500">
            Row problems ({report.issues.length})
          </Heading>
          <ul className="mt-3 space-y-1 text-sm">
            {shown.map((i, idx) => (
              <li key={`${i.row}-${i.field}-${idx}`} className="text-ink-600">
                <span className="font-mono text-xs text-ink-500">row {i.row}</span>{" "}
                <span className="text-ink-500">{i.field}:</span> {i.message}
              </li>
            ))}
          </ul>
          {report.issues.length > shown.length && (
            <p className="mt-2 text-xs text-ink-500">
              and {report.issues.length - shown.length} more - every one of them is listed, this is
              only the first {shown.length}.
            </p>
          )}
        </section>
      )}

      <section className="border-t border-line pt-6">
        <Heading level="h3" as="h2" className="!text-eyebrow uppercase text-ink-500">
          Rows
        </Heading>
        <p className="mt-2 mb-3 text-xs text-ink-500">
          Showing {report.sample.length} of {summary.rows} rows
          {report.truncated ? ` - the preview stops at ${report.sample_limit}` : ""}.
        </p>
        <Table label="Rows as they would be imported">
          <THead>
            {/* The sheet's OWN header row, in its own order and spelling, with the parsed value
                underneath each name. The table used to show the nine columns the importer of the
                day understood, which meant an operator could not check the seventeen it did not -
                and "did it read my Model # " is not a question a preview should answer by
                omission. The wide columns truncate with the full text on hover, because twenty-six
                columns of prose would otherwise push the numbers off the screen. */}
            <TR>
              <TH>Row</TH>
              <TH>Asset</TH>
              <TH>Status</TH>
              <TH>Lot</TH>
              <TH>Class</TH>
              <TH>Account</TH>
              <TH>Mfg</TH>
              <TH>Model</TH>
              <TH>Model #</TH>
              <TH>Upgrade Description</TH>
              <TH>Audit Description</TH>
              <TH>Cosmetics Description</TH>
              <TH>Functional Description</TH>
              <TH>Upgrade</TH>
              <TH>FMV</TH>
              <TH>Resale</TH>
              <TH>Settlement</TH>
              <TH>Grade</TH>
              <TH>Channel</TH>
              <TH>Serial#</TH>
              <TH>Load ID</TH>
              <TH>On Shelf</TH>
              <TH>Pallet</TH>
              <TH>Location</TH>
              <TH>Warehouse</TH>
              <TH>SKU #</TH>
              <TH>Zone</TH>
            </TR>
          </THead>
          <TBody>
            {report.sample.map((r) => (
              <TR key={r.row} className={r.issues.length ? "bg-danger-50" : undefined}>
                <TD className="font-mono text-xs text-ink-500">{r.row}</TD>
                <TD className="font-mono text-xs text-ink-600"><Cell v={r.asset_tag} /></TD>
                <TD><Badge colorClass={statusTone(r.status)}>{r.status}</Badge></TD>
                <TD className="font-mono text-xs text-ink-600">
                  {r.lot_number || <span className="text-danger-600">blank</span>}
                </TD>
                <TD className="text-ink-600"><Cell v={r.class || r.category} /></TD>
                <TD className="text-ink-600"><Cell v={r.lot_account} /></TD>
                <TD className="text-ink-600"><Cell v={r.brand} /></TD>
                <TD><Cell v={r.model} /></TD>
                <TD className="font-mono text-xs text-ink-600"><Cell v={r.model_number} /></TD>
                <TD className="max-w-[12rem] truncate text-ink-600" title={r.upgrade_desc}>{r.upgrade_desc || "-"}</TD>
                <TD className="max-w-[12rem] truncate text-ink-600" title={r.audit_desc}>{r.audit_desc || "-"}</TD>
                <TD className="max-w-[12rem] truncate text-ink-600" title={r.cosmetics_desc}>{r.cosmetics_desc || "-"}</TD>
                <TD className="max-w-[12rem] truncate text-ink-600" title={r.functional_desc}>{r.functional_desc || "-"}</TD>
                <TD className="text-ink-600"><Cell v={r.upgrade} /></TD>
                <TD>{r.fmv_cents === null || r.fmv_cents === undefined ? <span className="text-ink-500">-</span> : aud(r.fmv_cents)}</TD>
                <TD>{r.sale_price_cents === null ? <span className="text-ink-500">-</span> : aud(r.sale_price_cents)}</TD>
                <TD>{r.settlement_cents === null || r.settlement_cents === undefined ? <span className="text-ink-500">-</span> : aud(r.settlement_cents)}</TD>
                <TD>{r.grade ? <Badge colorClass={gradeTone(r.grade)}>{r.grade}</Badge> : <span className="text-ink-500">-</span>}</TD>
                <TD className="text-ink-600"><Cell v={r.channel} /></TD>
                <TD className="font-mono text-xs">{r.serial_number || <span className="text-danger-600">blank</span>}</TD>
                <TD className="font-mono text-xs text-ink-600"><Cell v={r.lot_load_id} /></TD>
                {/* Three states, not two: a blank cell is the sheet not tracking shelf state,
                    which is not the same claim as "No" and must not render as one. */}
                <TD className="text-ink-600">
                  {r.on_shelf === null || r.on_shelf === undefined ? "-" : (r.on_shelf ? "Yes" : "No")}
                </TD>
                <TD className="font-mono text-xs text-ink-600"><Cell v={r.pallet} /></TD>
                <TD className="font-mono text-xs text-ink-600"><Cell v={r.location} /></TD>
                <TD className="text-ink-600"><Cell v={r.lot_warehouse} /></TD>
                <TD className="font-mono text-xs text-ink-600"><Cell v={r.sku} /></TD>
                <TD className="text-ink-600"><Cell v={r.lot_zone} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </section>

      {report.sample.some((r) => r.technical_notes) && (
        <section className="border-t border-line pt-6">
          <Heading level="h3" as="h2" className="!text-eyebrow uppercase text-ink-500">
            Technical notes
          </Heading>
          <p className="mt-2 text-xs text-ink-500">
            The Audit, Cosmetic and Functional columns are merged into one note per unit. Row{" "}
            {report.sample.find((r) => r.technical_notes)!.row} reads:
          </p>
          <pre className="mt-2 whitespace-pre-wrap rounded-card bg-surface-muted p-4 ring-1 ring-line text-xs text-ink-600">
            {report.sample.find((r) => r.technical_notes)!.technical_notes}
          </pre>
        </section>
      )}

      <section className="border-t border-line pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onCommit} disabled={busy || blocked || summary.ready === 0}>
            {busy ? "Working..." : `Import ${summary.ready} unit${summary.ready === 1 ? "" : "s"}`}
          </Button>
          <p className="text-xs text-ink-500">
            {blocked
              ? "Blocked until the rows above are fixed in the sheet."
              : summary.would_list > 0
                ? `${summary.would_list} of these units arrive already listed, so they become visible in the shop immediately.`
                : "These units arrive not listed, so nothing becomes visible in the shop yet."}
          </p>
        </div>
      </section>
    </Card>
  );
}

/* Stage four, the result report. Counts first, then the lots that were minted, then the units -
   because a lot is what the operator recognises and the units are what they will go and look at. */
function ResultPanel({ result }: { result: Commit }) {
  const { summary } = result;
  return (
    <Card className="p-6 space-y-6">
      <div>
        <Heading level="h3" as="h2" className="!text-brand-300">4. {STAGES[3]}</Heading>
        <p className="mt-1 text-xs text-ink-500">
          {result.file.name} - {summary.rows} rows read, {summary.assets_created} units created.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Units created" value={summary.assets_created} sub="one per serial" />
        <Stat label="Lots created" value={summary.lots_created} sub={summary.lots_reused ? `${summary.lots_reused} existing lots reused` : "none reused"} />
        <Stat label="Products created" value={summary.products_created} sub="new brand + model combinations" />
        <Stat label="Now listed" value={summary.listed} sub={summary.listed ? "visible in the shop" : "not visible in the shop"} />
      </div>

      <section>
        <Heading level="h3" as="h2" className="!text-eyebrow uppercase text-ink-500">
          Lots
        </Heading>
        <div className="mt-3">
          <Table label="Lots touched by this import">
            <THead>
              <TR>
                <TH>Lot</TH>
                <TH>Units</TH>
              </TR>
            </THead>
            <TBody>
              {result.lots_created.map((l) => (
                <TR key={l.lot_number}>
                  <TD className="font-mono text-xs">{l.lot_number}</TD>
                  <TD>{summary.assets_created ? countIn(result, l.lot_number) : 0}</TD>
                </TR>
              ))}
              {result.lots_reused.map((n) => (
                <TR key={n}>
                  <TD className="font-mono text-xs">
                    {n} <span className="text-ink-500">(existing)</span>
                  </TD>
                  <TD>{countIn(result, n)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      </section>

      <section className="border-t border-line pt-6">
        <Heading level="h3" as="h2" className="!text-eyebrow uppercase text-ink-500">
          Units
        </Heading>
        <div className="mt-3">
          <Table label="Units created by this import">
            <THead>
              <TR>
                <TH>Serial</TH>
                <TH>Lot</TH>
                <TH>Grade</TH>
                <TH>Status</TH>
                <TH>Resale</TH>
              </TR>
            </THead>
            <TBody>
              {result.assets.map((a) => (
                <TR key={a.asset_id}>
                  <TD className="font-mono text-xs">{a.serial_number}</TD>
                  <TD className="font-mono text-xs text-ink-600">{a.lot_number}</TD>
                  <TD>{a.grade ? <Badge colorClass={gradeTone(a.grade)}>{a.grade}</Badge> : <span className="text-ink-500">-</span>}</TD>
                  <TD><Badge colorClass={statusTone(a.status)}>{a.status}</Badge></TD>
                  <TD>{a.sale_price_cents === null ? <span className="text-ink-500">-</span> : aud(a.sale_price_cents)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
        <p className={cn("mt-3 text-xs text-ink-500")}>
          Each unit also wrote one movement to the stock ledger and one line to the audit trail.
        </p>
      </section>
    </Card>
  );
}

/* Counts the units in one lot from the payload's own asset list. The alternative - a per-lot
   count field - would be a second source of truth for a number that is already here. */
function countIn(result: Commit, lotNumber: string): number {
  return result.assets.filter((a) => a.lot_number === lotNumber).length;
}
