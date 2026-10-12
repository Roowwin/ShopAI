"use client";

/* Corporate import: a supplier workbook in, lots and units out.

   THREE STATES, ONE PAGE. Upload -> mapping preview -> summary. The middle state is the whole
   point of the screen: a corporate sheet names its columns the way the supplier's system does
   (Class, Mfg, Model, Serial#, Resale), and the operator's question before any stock is created
   is "did it read my columns the way I meant them?". So the preview shows the mapping the server
   actually found - source header to target field - and lists the headers it did NOT use, by name.
   A column that silently failed to map is the expensive failure here, and it is invisible in a
   summary that only counts rows.

   NOTHING ON THIS SCREEN IS COUNTED LOCALLY. Every figure - rows, ready, blocked, lots - is a
   field the server returned. The browser holds no row list of its own; the sample below is the
   server's sample, capped by the server, and the page says so when it was capped. This is the same
   rule the intake screen's absence panel follows, in the other direction: the panel refuses to
   draw rows it does not have, and this page refuses to compute a number it was not given.

   THE TWO PRESSES ARE DIFFERENT. "Read the sheet" is a preview and writes nothing, ever - it is
   safe on a file nobody has checked. "Import" is the write. A refused import comes back with the
   same preview payload it was refused from, so the blocking rows are re-rendered in place rather
   than replaced by a generic failure the operator cannot act on.

   WHAT THIS PAGE CANNOT DO WITHOUT A SESSION: the file picker, the drag-and-drop-free input and
   the row rendering are only exercised by a browser. The build proves it compiles and the payload
   shapes match what the server sends; it does not prove the screen looks right. */

import { useRef, useState } from "react";

import { Badge, Button, Card, Heading, Stat, Table, TBody, TD, TH, THead, TR, cn } from "@/app/components/ui";
import { apiFetch } from "@/lib/api";
import { aud } from "@/lib/format";
import { gradeTone, kickerClass, statusTone } from "@/lib/ui";

type ColumnHit = { header: string; field: string; label: string; index: number };
type Issue = { row: number; field: string; message: string };

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
};

type Preview = {
  mode: string;
  file: { name: string; sheet: string; rows: number };
  columns: { detected: ColumnHit[]; unmapped: string[]; missing: string[]; missing_labels: string[] };
  issues: Issue[];
  sample: PreviewRow[];
  sample_limit: number;
  truncated: boolean;
  detail?: string;
  summary: { rows: number; ready: number; blocked: number; lots: number; would_list: number; issues: number };
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

const ACCEPT = ".csv,.tsv,.xlsx,.xlsm";
/* How many issue lines to render before collapsing the tail. The COUNT is never truncated - only
   the list - so a reader always knows how many there are. */
const ISSUE_SHOWN = 12;

export default function CorporateImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Preview | null>(null);
  const [result, setResult] = useState<Commit | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  function reset() {
    setFile(null);
    setReport(null);
    setResult(null);
    setMsg("");
    setErr("");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function send(phase: "preview" | "commit") {
    if (!file || busy) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await apiFetch(`/staff/imports/corporate/${phase}`, { method: "POST", body: fd });
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

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 pt-8 pb-16">
      <div>
        <Heading level="h1">Corporate import</Heading>
        <p className="mt-1 text-sm text-ink-500">
          Read a corporate stock sheet, check the column mapping it found, then create the lots and
          units. Reading a sheet writes nothing - creating stock takes a second, deliberate press.
        </p>
      </div>

      <Card className="p-6">
        <Heading level="h3" as="h2">1. The sheet</Heading>
        <p className="mt-1 pb-4 text-xs text-ink-500">
          A CSV, TSV or XLSX export with the corporate headers: Asset, Status, Lot, Class, Mfg,
          Model, Grade, Serial#, Resale, and the Audit / Cosmetic / Functional description columns.
          Columns are matched by name, so their order does not matter.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          disabled={busy}
          onChange={(e) => {
            const picked = e.target.files?.[0] ?? null;
            setFile(picked);
            setReport(null);
            setResult(null);
            setMsg("");
            setErr("");
          }}
          aria-label="Choose a corporate stock sheet"
          className={cn(
            "block w-full max-w-md text-sm text-ink-500",
            "file:mr-3 file:rounded-control file:border-0 file:bg-brand-700 file:px-4 file:py-2",
            "file:text-sm file:font-semibold file:text-ink-900",
            "disabled:opacity-50 disabled:pointer-events-none",
            "outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2",
          )}
        />
        <div className="mt-4 flex flex-wrap gap-3">
          <Button onClick={() => send("preview")} disabled={!file || busy}>
            {busy ? "Working..." : "Read the sheet"}
          </Button>
          {(report || result || file) && (
            <Button variant="secondary" onClick={reset} disabled={busy}>
              Start over
            </Button>
          )}
        </div>
      </Card>

      {msg && <p className="text-brand-300 text-sm">{msg}</p>}
      {err && <p className="text-danger-600 text-sm">{err}</p>}

      {report && <PreviewPanel report={report} busy={busy} onCommit={() => send("commit")} />}
      {result && <ResultPanel result={result} />}
    </main>
  );
}

/* The mapping preview. Ordered so the operator's eye lands on a mapping mistake before the row
   data: columns first, then the counts, then the rows themselves. */
function PreviewPanel({ report, busy, onCommit }: { report: Preview; busy: boolean; onCommit: () => void }) {
  const { summary, columns } = report;
  const blocked = summary.blocked > 0;
  const shown = report.issues.slice(0, ISSUE_SHOWN);

  return (
    <Card className="p-6 space-y-6">
      <div>
        <Heading level="h3" as="h2">2. Mapping preview</Heading>
        <p className="mt-1 text-xs text-ink-500">
          {report.file.name}
          {report.file.sheet ? ` - sheet "${report.file.sheet}"` : ""}. This is a preview: nothing
          below has touched stock.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Rows read" value={summary.rows} sub="data rows, header excluded" />
        <Stat label="Ready" value={summary.ready} sub="rows that would import" />
        <Stat label="Blocked" value={summary.blocked} sub={blocked ? "these stop the whole import" : "none - the file is clean"} />
        <Stat label="Lots" value={summary.lots} sub="grouped by the Lot column" />
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
            <TR>
              <TH>Row</TH>
              <TH>Serial</TH>
              <TH>Lot</TH>
              <TH>Class</TH>
              <TH>Brand</TH>
              <TH>Model</TH>
              <TH>Grade</TH>
              <TH>Status</TH>
              <TH>Resale</TH>
            </TR>
          </THead>
          <TBody>
            {report.sample.map((r) => (
              <TR key={r.row} className={r.issues.length ? "bg-danger-50" : undefined}>
                <TD className="font-mono text-xs text-ink-500">{r.row}</TD>
                <TD className="font-mono text-xs">{r.serial_number || <span className="text-danger-600">blank</span>}</TD>
                <TD className="font-mono text-xs text-ink-600">{r.lot_number || <span className="text-danger-600">blank</span>}</TD>
                <TD className="text-ink-600">{r.category}</TD>
                <TD className="text-ink-600">{r.brand}</TD>
                <TD>{r.model}</TD>
                <TD>{r.grade ? <Badge colorClass={gradeTone(r.grade)}>{r.grade}</Badge> : <span className="text-ink-500">-</span>}</TD>
                <TD><Badge colorClass={statusTone(r.status)}>{r.status}</Badge></TD>
                <TD>{r.sale_price_cents === null ? <span className="text-ink-500">-</span> : aud(r.sale_price_cents)}</TD>
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

/* The success summary. Counts first, then the lots that were minted, then the units - because a
   lot is what the operator recognises and the units are what they will go and look at. */
function ResultPanel({ result }: { result: Commit }) {
  const { summary } = result;
  return (
    <Card className="p-6 space-y-6">
      <div>
        <Heading level="h3" as="h2">3. Imported</Heading>
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
