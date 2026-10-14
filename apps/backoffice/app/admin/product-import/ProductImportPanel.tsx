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

   PRICING IS SHOWN AND NEVER APPLIED. Every row arrives with a suggested price (from comparables,
   the sheet's FMV, or settlement plus a markup, moved by the condition phrases in its description
   columns) and a margin reading. Both are ADVISORY and are rendered in their own columns, ruled
   off from the sheet's twenty-six, plus a panel that prints the basis split and the thresholds
   behind them. Nothing here writes a price the sheet did not carry: the suggestion is recorded
   against the unit for the workbench to show later, and the shop is still priced by `Resale` alone.

   THE FLAGS REFUSE NOTHING. A thin margin is a commercial decision - a lot may be cleared at 8% on
   purpose - so the guard's findings sit in their OWN section with a caution tone and their own
   sentence saying they block nothing, deliberately unlike "Row problems", which is exactly what
   stops an import. Drawing the two in one list would teach the operator to fear a choice they are
   entitled to make.

   WHAT THIS PAGE CANNOT DO WITHOUT A SESSION: the file picker, the drag-and-drop-free input and
   the row rendering are only exercised by a browser. The build proves it compiles and the payload
   shapes match what the server sends; it does not prove the screen looks right. */

import { useState } from "react";

import { Badge, Button, Card, Heading, Select, Stat, Table, TBody, TD, TH, THead, TR, cn } from "@/app/components/ui";
import { apiFetch } from "@/lib/api";
import { aud } from "@/lib/format";
import { gradeTone, kickerClass, statusTone } from "@/lib/ui";

import SheetDrop from "./SheetDrop";

type ColumnHit = { header: string; field: string; label: string; index: number };
type Issue = { row: number; field: string; message: string };
type Translation = { field: string; from: string; to: string; rows: number };
type RowTranslation = { field: string; from: string; to: string };

/* Smart pricing. `basis` is WHICH evidence produced the suggested price and `basis_label` spells it
   out; `reasons` is the description trail. All of it comes from the server - the browser does no
   arithmetic on these numbers, the same rule the counts above follow. */
type PriceReason = { label: string; pct: number; phrase: string };
type RowPricing = {
  suggested_price_cents: number | null;
  basis: string;
  basis_label: string;
  base_cents: number | null;
  sample_size: number;
  adjustment_pct: number;
  reasons: PriceReason[];
  dismissed: string[];
  delta_vs_resale_cents?: number;
};
type RowMargin = {
  cost_cents: number | null;
  cost_source: string | null;
  price_cents: number | null;
  price_source: string | null;
  margin_pct: number | null;
  band: string;
};
/* A warning is NOT an issue: the server keeps them in separate lists and only `issues` can refuse
   the file. The page must not blur them either - a thin margin is a decision, not a defect. */
type Warning = { row: number; field: string; message: string };

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
  warnings: Warning[];
  translations: RowTranslation[];
  pricing: RowPricing;
  margin: RowMargin;
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
  warnings: Warning[];
  translations: Translation[];
  sample: PreviewRow[];
  sample_limit: number;
  truncated: boolean;
  detail?: string;
  /* How the suggested prices were reached, printed in the payload that carries them: the thresholds
     are the server's, and the page reads them rather than repeating them, so the screen cannot
     quote a guard level the guard is not using. */
  pricing: {
    low_margin_pct: number;
    target_markup_pct: number;
    adjustment_floor_pct: number;
    adjustment_ceiling_pct: number;
    bases: string[];
    note: string;
    suggested: number;
    low_margin: number;
    cost_unknown: number;
    by_basis: Record<string, number>;
    comparable_pairs: number;
  };
  /* Rows the database already holds, by serial. Shown at PREVIEW time as well as after the commit:
     "this file will write 12 of its 400 rows and skip the rest" is a thing an operator wants to know
     BEFORE pressing the button that writes, not after. */
  skipped: { row: number; serial: string; lot: string; model: string }[];
  summary: {
    rows: number; ready: number; blocked: number; lots: number; would_list: number;
    issues: number; translated: number; suggested: number; low_margin: number; cost_unknown: number;
    skipped_existing: number;
  };
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
    /* Rows the database already held. Not failures: a serial is a per-unit identity, so a serial
       already on the shelf names a unit this database already has, and the file is written around
       it. Reported on the commit reply as well as the preview because the number an operator
       checks against the sheet is the one that came back from the write. */
    skipped_existing: number;
    groups_new: number;
    /* Groups this sheet touched that are ALREADY in the storefront - image and price on file. These
       are what "Publish remaining lots" pushes out, because nothing about them has to be decided
       again. */
    groups_ready: number;
    groups_needing_setup: number;
  };
  lots_created: { lot_number: string; id: number }[];
  lots_reused: string[];
  products_created: { id: number; brand: string; category: string; model: string }[];
  groups_new: { id: number; brand: string; model: string; grade: string }[];
  groups_ready: { id: number; brand: string; model: string; grade: string }[];
  skipped: { row: number; serial: string; lot: string; model: string }[];
  assets: { row: number; asset_id: number; serial_number: string; lot_number: string; status: string; grade: string | null; sale_price_cents: number | null; suggested_price_cents?: number | null; suggested_price_basis?: string | null }[];
};

/* How many issue lines to render before collapsing the tail. The COUNT is never truncated - only
   the list - so a reader always knows how many there are. */
const ISSUE_SHOWN = 12;
/* The same rule for the low-margin list, which on a corporate lot can run to every row. */
const WARNING_SHOWN = 12;

/* The basis word -> the phrasing the row shows under the number. `market` is the strong one and the
   others are honest about being weaker, so the label says WHY rather than only what. */
const BASIS_SHORT: Record<string, string> = {
  market: "market",
  fmv: "sheet FMV",
  cost: "cost + markup",
  none: "no basis",
};

/* A low margin is a caution, not an error, so it takes the accent tone the backoffice already uses
   for "look at this" (Sample data, role notices) rather than the danger tone that means refused. */
const LOW_MARGIN_TONE = "bg-accent-100 text-accent-700";

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

/* The suggestion's working, as one line of prose for the row's tooltip. Built from the payload, not
   from the screen: every clause here is a field the server sent, so the tooltip cannot drift into
   explaining a number the server did not produce. */
function suggestedTitle(r: PreviewRow): string {
  const p = r.pricing;
  if (!p) return "No suggestion for this row.";
  if (p.suggested_price_cents === null || p.suggested_price_cents === undefined) {
    return `No suggestion: ${p.basis_label}.`;
  }
  const bits = [p.basis_label];
  if (p.basis === "market" && p.sample_size > 0) {
    bits.push(`${p.sample_size} comparable unit${p.sample_size === 1 ? "" : "s"}${p.base_cents !== null ? ` averaging ${aud(p.base_cents)}` : ""}`);
  }
  for (const reason of p.reasons) {
    bits.push(`${reason.phrase}: ${reason.pct > 0 ? "+" : ""}${reason.pct}%`);
  }
  if (p.dismissed.length > 0) {
    bits.push(`read as negated, so not scored: ${p.dismissed.join(", ")}`);
  }
  if (p.delta_vs_resale_cents !== undefined) {
    const d = p.delta_vs_resale_cents / 100;
    bits.push(`${d < 0 ? "" : "+"}$${d.toFixed(2)} against the sheet's Resale`);
  }
  return bits.join(". ") + ".";
}


/* Smart pricing, read back to the operator.

   THREE THINGS, in the order they matter: what the numbers were based on, what the margin guard
   found, and - only then - the rows themselves. The basis split is first because it qualifies
   everything below it: a file priced entirely off `cost + markup` had no market behind it at all,
   and that is a materially weaker suggestion than one drawn from units that actually sold, which
   the operator can only tell if the split is on screen.

   THE THRESHOLDS ARE THE SERVER'S. `low_margin_pct` and `target_markup_pct` are printed from the
   payload rather than written into this file, because a screen that quotes a guard level the guard
   is no longer using is worse than one that quotes none.

   THE FLAGS ARE NOT PROBLEMS. They live in their own section with their own tone and their own
   sentence saying so, deliberately apart from "Row problems": the server refuses a file on the
   latter and never on the former, and a page that drew both in the same list would teach the
   operator to fear a decision they are entitled to make. */
function PricingSection({ report }: { report: Preview }) {
  const { pricing, warnings } = report;
  const shown = warnings.slice(0, WARNING_SHOWN);
  const byBasis = pricing.by_basis ?? {};
  const parts = [
    byBasis.market ? `${byBasis.market} from units of the same model and grade that already sold` : "",
    byBasis.fmv ? `${byBasis.fmv} from the sheet's own FMV` : "",
    byBasis.cost ? `${byBasis.cost} from settlement plus a ${pricing.target_markup_pct}% markup` : "",
    byBasis.none ? `${byBasis.none} with nothing to price from` : "",
  ].filter(Boolean);

  return (
    <section className="border-t border-line pt-6">
      <Heading level="h3" as="h2" className="!text-eyebrow uppercase text-ink-500">
        Smart pricing
      </Heading>
      <p className="mt-2 text-xs text-ink-500">
        A suggested price is computed for every row from the best evidence that row and the
        catalogue can offer - in order: other units of the same model and grade that already carry
        a price, then the sheet's own FMV, then settlement cost plus a {pricing.target_markup_pct}%
        markup. The description columns then move it, between{" "}
        {pricing.adjustment_floor_pct}% and +{pricing.adjustment_ceiling_pct}%, by the condition
        phrases they contain. The suggestion is ADVISORY: it is recorded against each unit, and no
        price the sheet did not carry is ever written.
      </p>
      <p className="mt-2 text-sm text-ink-600">
        {parts.length > 0
          ? <>Priced from: {parts.join("; ")}.</>
          : <>No row had anything to price from.</>}
        {pricing.comparable_pairs === 0 && (
          <> No model in this sheet has priced comparables yet, so the market basis is not
            available to any of it.</>
        )}
      </p>

      <div className="mt-4">
        <p className="text-sm font-semibold text-ink-700">
          {warnings.length > 0
            ? `${warnings.length} row${warnings.length === 1 ? "" : "s"} below the ${pricing.low_margin_pct}% margin guard.`
            : `No row falls below the ${pricing.low_margin_pct}% margin guard.`}
        </p>
        <p className="mt-1 text-xs text-ink-500">
          {warnings.length > 0
            ? "These are warnings, not problems: they stop nothing. Every one of these rows still imports exactly as the sheet wrote it - a lot may be cleared thin on purpose."
            : "The margin compares each row's price against its cost (the Settlement column, or the unit's own cost where it has one)."}
          {report.summary.cost_unknown > 0 &&
            ` ${report.summary.cost_unknown} row${report.summary.cost_unknown === 1 ? "" : "s"} carr${report.summary.cost_unknown === 1 ? "ies" : "y"} no cost at all, so ${report.summary.cost_unknown === 1 ? "it" : "they"} could not be checked.`}
        </p>
        {shown.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {shown.map((w, idx) => (
              <li key={`${w.row}-${idx}`} className="text-ink-600">
                <span className="font-mono text-xs text-ink-500">row {w.row}</span>{" "}
                <span className={cn("rounded-control px-1.5 py-0.5 text-xs font-semibold", LOW_MARGIN_TONE)}>
                  low margin
                </span>{" "}
                {w.message}
              </li>
            ))}
          </ul>
        )}
        {warnings.length > shown.length && (
          <p className="mt-2 text-xs text-ink-500">
            and {warnings.length - shown.length} more - every one of them is counted, this is only
            the first {shown.length}.
          </p>
        )}
      </div>
    </section>
  );
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
              <TH>Column</TH>
              <TH>Your value</TH>
              <TH>Recorded as</TH>
              <TH>Rows</TH>
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
              <TH>Your column</TH>
              <TH>Becomes</TH>
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

  /* HOW MANY PREVIEW ROWS TO DRAW. The server sends up to `sample_limit` of them and this decides
     how many reach the screen, starting at ten: a two-thousand-row sheet drawn two hundred rows deep
     is a wall an operator scrolls past rather than reads, and the question this table answers ("did
     it read my columns, and will my rows go through?") is settled by the first handful. The rest are
     already in the payload the server sent, so changing this REDRAWS a table - it does not re-upload
     a sheet, and it does not ask the server for anything.

     The choices stop at what was actually sent, so "all" can never promise more than the cap allows. */
  const [showRows, setShowRows] = useState(10);
  const rowChoices = Array.from(new Set([10, 25, 50, 100, report.sample.length]))
    .filter((n) => n <= report.sample.length)
    .sort((a, b) => a - b);
  const drawnRows = Math.min(showRows, report.sample.length);

  return (
    <Card className="p-6 space-y-6">
      <div>
        <Heading level="h3" as="h2">3. {STAGES[2]}</Heading>
        <p className="mt-1 text-xs text-ink-500">
          {report.file.name} - what would happen to these rows. Nothing below has touched stock.
        </p>
      </div>

      {/* Six counts, because the sibling job's suggested price and margin guard are as much a part
          of "what would happen to these rows" as the row counts are - and they belong on THIS card
          rather than the mapping's, since they are claims about the rows and not about the sheet's
          shape. The grid widens on a roomy screen so six tiles do not wrap into two uneven rows. */}
      {/* FOUR ACROSS, not six: there are seven tiles now, and seven into six leaves one stranded on
          a row of its own. Four gives 4 + 3, which reads as two full rows at every width the admin
          is used at. */}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Rows read" value={summary.rows} sub="data rows, header excluded" />
        <Stat label="Ready" value={summary.ready} sub="rows that would import" />
        {/* Not "blocked" and not "ready" - already here. A row whose serial is on the shelf will be
            skipped by the write, so counting it as ready would promise stock the import will not
            create. */}
        <Stat label="Already on file" value={summary.skipped_existing}
          sub={summary.skipped_existing ? "serials the database already has - these are skipped" : "every serial is new"} />
        <Stat label="Blocked" value={summary.blocked} sub={blocked ? "these stop the whole import" : "none - the file is clean"} />
        <Stat label="Translated" value={summary.translated} sub={summary.translated ? "rows rewritten - see the mapping above" : "no supplier wording needed translating"} />
        <Stat label="Suggested" value={summary.suggested} sub={summary.suggested ? "rows with a price to consider" : "no row had anything to price from"} />
        <Stat label="Low margin" value={summary.low_margin} sub={summary.low_margin ? "flagged below - none of them blocked" : "every priced row clears the guard"} />
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

      <PricingSection report={report} />

      <section className="border-t border-line pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Heading level="h3" as="h2" className="!text-eyebrow uppercase text-ink-500">
            Rows
          </Heading>
          {/* The control is a VIEW choice, not a request: the file was parsed once and the sample is
              already in the payload, so changing this redraws a table instead of re-uploading a
              sheet. The server's cap is still the ceiling - the choices stop at what was sent. */}
          <label className="flex items-center gap-2 text-xs text-ink-500">
            Rows to show
            <Select
              value={String(showRows)}
              onChange={(e) => setShowRows(Number(e.target.value))}
              aria-label="How many preview rows to show"
            >
              {rowChoices.map((n) => (
                <option key={n} value={n}>{n === report.sample.length ? `all ${n}` : n}</option>
              ))}
            </Select>
          </label>
        </div>
        <p className="mt-2 mb-3 text-xs text-ink-500">
          Showing {drawnRows} of {report.sample.length} previewed rows
          {report.truncated
            ? ` - the preview stops at ${report.sample_limit}, of ${summary.rows.toLocaleString("en-AU")} in the file`
            : ""}.
        </p>
        <Table label="Rows as they would be imported">
          <THead>
          {/* The sheet's OWN header row, in its own order and spelling, with the parsed value
              underneath each name. The table used to show the nine columns the importer of the
              day understood, which meant an operator could not check the seventeen it did not -
              and "did it read my Model # " is not a question a preview should answer by
              omission. The wide columns truncate with the full text on hover, because twenty-six
              columns of prose would otherwise push the numbers off the screen. */}
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
            {/* The app's own two columns, appended AFTER the sheet's twenty-six and ruled off from
                them. The grid above is the operator's workbook spelled back to them; these two are
                the app's reading of it, and keeping the divide visible is what stops a suggestion
                being mistaken for a column the supplier sent. */}
            <TH className="border-l border-line">Suggested (app)</TH>
            <TH>Margin (app)</TH>
          </THead>
          <TBody>
            {report.sample.slice(0, drawnRows).map((r) => (
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
                {/* The whole trail is on the tooltip: which evidence, from how many units, and every
                    description phrase that moved the number, including the ones a negator turned off.
                    The cell is too narrow for that and a number nobody can interrogate is not a
                    suggestion - it is a number. */}
                <TD className="border-l border-line align-top" title={suggestedTitle(r)}>
                  {r.pricing?.suggested_price_cents === null || r.pricing?.suggested_price_cents === undefined ? (
                    <span className="text-ink-500">-</span>
                  ) : (
                    <span className="whitespace-nowrap">
                      {aud(r.pricing.suggested_price_cents)}
                      <span className="block text-[10px] uppercase tracking-wide text-ink-500">
                        {BASIS_SHORT[r.pricing.basis] ?? r.pricing.basis}
                      </span>
                    </span>
                  )}
                </TD>
                <TD className="align-top">
                  {r.margin?.band === "unknown" || r.margin?.margin_pct === null || r.margin?.margin_pct === undefined ? (
                    <span className="text-ink-500" title="No cost on this row, so no margin can be measured">
                      -
                    </span>
                  ) : r.margin.band === "low" ? (
                    <Badge colorClass={LOW_MARGIN_TONE}>{r.margin.margin_pct}%</Badge>
                  ) : (
                    <span className="text-ink-600">{r.margin.margin_pct}%</span>
                  )}
                </TD>
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
  /* THE ONE BUTTON THIS STEP NEEDS, for the case this importer is actually used for: a second sheet
     of a catalogue already on the shelf. The groups it mentions are already set up - each has its
     image and its price - so there is nothing to decide, only new units to put on the shop. The call
     names no ids and sends `only_published`, which the server reads as "the groups that already
     carry a storefront_id": the screen does not re-derive a fact the database owns. */
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<string>("");
  const [publishErr, setPublishErr] = useState("");

  async function publishRemaining() {
    setPublishing(true); setPublishErr(""); setPublished("");
    try {
      const r = await apiFetch("/staff/product-groups/publish", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ only_published: true }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) { setPublishErr(typeof j.detail === "string" ? j.detail : "that publish was refused"); return; }
      const t = j.totals ?? {};
      const held = (t.units_hidden_below_cost ?? 0) > 0
        ? ` ${t.units_hidden_below_cost} are priced below cost, so the shop will not show them.` : "";
      setPublished(`${t.units_listed ?? 0} units published across ${t.groups_published ?? 0} groups.${held}`);
    } catch {
      setPublishErr("that publish could not be sent");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <Card className="p-6 space-y-6">
      <div>
        <Heading level="h3" as="h2" className="!text-brand-300">4. {STAGES[3]}</Heading>
        <p className="mt-1 text-xs text-ink-500">
          {result.file.name} - {summary.rows} rows read, {summary.assets_created} units created
          {summary.skipped_existing > 0 ? `, ${summary.skipped_existing} already on file` : ""}.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-5">
        <Stat label="Units created" value={summary.assets_created} sub="one per serial" />
        {/* A THIRD OUTCOME, beside written and refused. A serial already on the shelf is not an
            error - it is what a second sheet of a familiar catalogue looks like - so it is counted
            here rather than shown as a problem, and never folded into "created". */}
        <Stat label="Already on file" value={summary.skipped_existing} sub="skipped, not rewritten" />
        <Stat label="Lots created" value={summary.lots_created} sub={summary.lots_reused ? `${summary.lots_reused} existing lots reused` : "none reused"} />
        <Stat label="Products created" value={summary.products_created} sub="new brand + model combinations" />
        <Stat label="Now listed" value={summary.listed} sub={summary.listed ? "visible in the shop" : "not visible in the shop"} />
      </div>

      {/* THE GROUPS THIS SHEET DECLARED. A group is the unit of decision - one image, one price - so
          an operator who has just imported needs to know how many decisions are waiting, and how
          many were already made on an earlier sheet. */}
      {(summary.groups_new > 0 || summary.groups_ready > 0) && (
        <section className="rounded-card bg-surface-muted p-4 ring-1 ring-line">
          <Heading level="h3" as="h2" className="!text-eyebrow uppercase text-ink-500">
            Model + grade groups
          </Heading>
          <p className="mt-2 text-sm text-ink-600">
            {summary.groups_new > 0
              ? `${summary.groups_new} group${summary.groups_new === 1 ? "" : "s"} on this sheet are new and need an image and a price. `
              : ""}
            {summary.groups_ready > 0
              ? `${summary.groups_ready} already have both, so nothing needs deciding for them - just publish their new units.`
              : ""}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" href="/admin/product-groups">
              Open product groups
            </Button>
            {summary.groups_ready > 0 && (
              <Button size="sm" disabled={publishing} onClick={() => void publishRemaining()}>
                {publishing ? "Publishing…" : "Publish remaining lots"}
              </Button>
            )}
          </div>
          {published && <p className="mt-2 text-sm text-brand-300">{published}</p>}
          {publishErr && <p className="mt-2 text-sm text-danger-600">{publishErr}</p>}
        </section>
      )}

      {/* The skipped rows, in full. "400 rows, 388 written" always has an answer on the same screen
          as the number, rather than in a log nobody opens. */}
      {result.skipped.length > 0 && (
        <section>
          <Heading level="h3" as="h2" className="!text-eyebrow uppercase text-ink-500">
            Already imported ({result.skipped.length})
          </Heading>
          <div className="mt-3">
            <Table label="Rows skipped because the serial is already on file">
              <THead>
                <TH>Row</TH>
                <TH>Serial</TH>
                <TH>Lot</TH>
              </THead>
              <TBody>
                {result.skipped.slice(0, ISSUE_SHOWN).map((s) => (
                  <TR key={s.row}>
                    <TD>{s.row}</TD>
                    <TD className="font-mono text-xs">{s.serial}</TD>
                    <TD className="font-mono text-xs text-ink-600">{s.lot}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          {result.skipped.length > ISSUE_SHOWN && (
            <p className="mt-2 text-xs text-ink-500">
              and {result.skipped.length - ISSUE_SHOWN} more, all skipped the same way.
            </p>
          )}
        </section>
      )}

      <section>
        <Heading level="h3" as="h2" className="!text-eyebrow uppercase text-ink-500">
          Lots
        </Heading>
        <div className="mt-3">
          <Table label="Lots touched by this import">
            <THead>
              <TH>Lot</TH>
              <TH>Units</TH>
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
              <TH>Serial</TH>
              <TH>Lot</TH>
              <TH>Grade</TH>
              <TH>Status</TH>
              <TH>Resale</TH>
              {/* What the import RECORDED beside each unit's price. It is on this screen because a
                  suggestion the operator cannot see after the fact would be a number computed for
                  nobody; the workbench reads the same column when the unit is actually priced. */}
              <TH className="border-l border-line">Suggested</TH>
            </THead>
            <TBody>
              {result.assets.map((a) => (
                <TR key={a.asset_id}>
                  <TD className="font-mono text-xs">{a.serial_number}</TD>
                  <TD className="font-mono text-xs text-ink-600">{a.lot_number}</TD>
                  <TD>{a.grade ? <Badge colorClass={gradeTone(a.grade)}>{a.grade}</Badge> : <span className="text-ink-500">-</span>}</TD>
                  <TD><Badge colorClass={statusTone(a.status)}>{a.status}</Badge></TD>
                  <TD>{a.sale_price_cents === null ? <span className="text-ink-500">-</span> : aud(a.sale_price_cents)}</TD>
                  <TD className="border-l border-line">
                    {a.suggested_price_cents === null || a.suggested_price_cents === undefined ? (
                      <span className="text-ink-500">-</span>
                    ) : (
                      <span className="whitespace-nowrap">
                        {aud(a.suggested_price_cents)}
                        <span className="block text-[10px] uppercase tracking-wide text-ink-500">
                          {BASIS_SHORT[a.suggested_price_basis ?? ""] ?? a.suggested_price_basis}
                        </span>
                      </span>
                    )}
                  </TD>
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
