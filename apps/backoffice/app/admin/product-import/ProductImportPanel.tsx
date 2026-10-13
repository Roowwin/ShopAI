"use client";

/* Product import: a supplier workbook in, lots and units out.

   THREE STATES, ONE PAGE. Upload -> mapping preview -> summary. The middle state is the whole
   point of the screen: a product sheet names its columns the way the supplier's system does
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

import { useRef, useState } from "react";

import { Badge, Button, Card, Heading, Stat, Table, TBody, TD, TH, THead, TR, cn } from "@/app/components/ui";
import { apiFetch } from "@/lib/api";
import { aud } from "@/lib/format";
import { gradeTone, kickerClass, statusTone } from "@/lib/ui";

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
  summary: {
    rows: number; ready: number; blocked: number; lots: number; would_list: number;
    issues: number; translated: number; suggested: number; low_margin: number; cost_unknown: number;
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
  };
  lots_created: { lot_number: string; id: number }[];
  lots_reused: string[];
  products_created: { id: number; brand: string; category: string; model: string }[];
  assets: { row: number; asset_id: number; serial_number: string; lot_number: string; status: string; grade: string | null; sale_price_cents: number | null; suggested_price_cents?: number | null; suggested_price_basis?: string | null }[];
};

const ACCEPT = ".csv,.tsv,.xlsx,.xlsm";
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

export default function ProductImportPanel() {
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

  return (
    <div className="space-y-6">

      <Card className="p-6">
        <Heading level="h3" as="h2">1. The sheet</Heading>
        <p className="mt-1 pb-4 text-xs text-ink-500">
          A CSV, TSV or XLSX export with the product headers: Asset, Status, Lot, Class, Mfg,
          Model, Grade, Serial#, Resale, and the Audit / Cosmetic / Functional description columns.
          Columns are matched by name, so their order does not matter. Supplier wording is
          translated where it differs - "Active" is imported as received, "Unassessed" as no grade -
          and every translation is listed in the preview before anything is created.
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
          aria-label="Choose a product stock sheet"
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
    </div>
  );
}

/* The mapping preview. Ordered so the operator's eye lands on a mapping mistake before the row
   data: columns first, then the counts, then the rows themselves. */
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

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Rows read" value={summary.rows} sub="data rows, header excluded" />
        <Stat label="Ready" value={summary.ready} sub="rows that would import" />
        <Stat label="Blocked" value={summary.blocked} sub={blocked ? "these stop the whole import" : "none - the file is clean"} />
        <Stat label="Translated" value={summary.translated} sub={summary.translated ? "rows rewritten - see below" : "no supplier wording needed translating"} />
        <Stat label="Suggested" value={summary.suggested} sub={summary.suggested ? "rows with a price to consider" : "no row had anything to price from"} />
        <Stat label="Low margin" value={summary.low_margin} sub={summary.low_margin ? "flagged below - none of them blocked" : "every priced row clears the guard"} />
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

      <PricingSection report={report} />

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
              {/* The app's own two columns, appended AFTER the sheet's twenty-six and ruled off from
                  them. The grid above is the operator's workbook spelled back to them; these two are
                  the app's reading of it, and keeping the divide visible is what stops a suggestion
                  being mistaken for a column the supplier sent. */}
              <TH className="border-l border-line">Suggested (app)</TH>
              <TH>Margin (app)</TH>
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
                {/* What the import RECORDED beside each unit's price. It is on this screen because a
                    suggestion the operator cannot see after the fact would be a number computed for
                    nobody; the workbench reads the same column when the unit is actually priced. */}
                <TH className="border-l border-line">Suggested</TH>
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
