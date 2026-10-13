"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";

import { cn } from "@/app/components/ui";

/* Step one of the import: a supplier workbook, dropped or chosen.

   THE REAL CONTROL STAYS REAL. The `<input type="file">` inside this zone is the browser's own
   element, so keyboard focus, the native picker and the change event are exactly what they were; a
   drop simply hands the same File to the same handler. Painting a div to look like a drop target and
   hiding the input behind it is how a picker stops being reachable by keyboard.

   THE ZONE ONLY ACCEPTS WHAT THE SERVER CAN READ, and says so when it gets something else. The
   importer reads CSV, TSV and XLSX (`staff_imports.read_table`; a legacy `.xls` is a 422), so a
   refused file is named here with the reason rather than posted and bounced - a round trip that
   ends in "the sheet could not be read" teaches the operator nothing about which files work. A file
   whose extension looks right but whose bytes are not is still the server's call; this only screens
   the obvious.

   NOTHING IS GUESSED FROM THE DROP. The zone reports a File and nothing else - no parse, no row
   count, no preview. Every figure on this page comes back from the server's own read of the sheet,
   and a client that invented one would be the second source of truth this flow is built to avoid. */

const SHEET = /\.(csv|tsv|xlsx|xlsm|txt)$/i;

export default function SheetDrop({ file, busy, onFile }: {
  /** the sheet currently chosen, or null - the panel owns it, this only draws and hands it over */
  file: File | null;
  /** true while a read or a commit is out; the door is shut for the whole of it */
  busy: boolean;
  onFile: (f: File | null) => void;
}) {
  const [over, setOver] = useState(false);
  const [refused, setRefused] = useState<{ name: string; reason: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /* The panel clears the sheet by setting `file` back to null (Reset, or a new drop). The input is
     the browser's, so its own value has to be cleared too - otherwise re-picking the same file fires
     no change event and the operator's second attempt does nothing. */
  useEffect(() => {
    if (file === null && inputRef.current) inputRef.current.value = "";
  }, [file]);

  function take(f: File | null | undefined) {
    if (!f || busy) return;
    if (SHEET.test(f.name)) { setRefused(null); onFile(f); return; }
    setRefused({
      name: f.name,
      reason: /\.xls$/i.test(f.name)
        ? "the legacy Excel format is not read - save it as .xlsx or .csv"
        : "not a stock sheet - .csv, .tsv or .xlsx",
    });
  }

  /* A drop only lands where the drag was allowed to, so the over events must answer before the drop
     can arrive at all. While a call is out the zone does not light up: a surface that invites a drop
     it will refuse is worse than one that stays quiet. */
  function onOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!busy && !over) setOver(true);
  }

  return (
    <div>
      <div
        onDragOver={onOver}
        onDragLeave={(e) => { e.preventDefault(); setOver(false); }}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer?.files?.[0]); }}
        className={cn(
          "rounded-card px-6 py-8 text-center",
          "border border-dashed transition-colors duration-150 ease-out motion-reduce:transition-none",
          over ? "border-brand-500 bg-brand-50" : "border-line-strong bg-surface-muted",
          !busy && !over && "hover:border-brand-500",
        )}
      >
        <p className={cn("text-base font-semibold", over ? "text-ink-600" : "text-ink-900")}>
          {busy ? "Working..." : over ? "Release to read this sheet" : "Drop the supplier sheet here"}
        </p>
        <p className={cn("mx-auto mt-1 max-w-md text-sm", over ? "text-ink-600" : "text-ink-500")}>
          CSV, TSV or XLSX. Columns are matched by name, so their order does not matter.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.xlsx,.xlsm"
          disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ""; take(f); }}
          aria-label="Choose a product stock sheet"
          className={cn(
            "mx-auto mt-5 block w-full max-w-sm text-sm text-ink-500",
            "file:mr-3 file:rounded-control file:border-0 file:bg-brand-700 file:px-4 file:py-2",
            "file:text-sm file:font-semibold file:text-ink-900",
            "disabled:opacity-50 disabled:pointer-events-none",
            "outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2",
          )}
        />

        {file && (
          <p className="mt-3 text-sm text-ink-600">
            Chosen: <span className="font-mono text-xs text-ink-900">{file.name}</span>
            <span className="text-ink-500"> - {(file.size / 1024).toFixed(0)} KB</span>
          </p>
        )}
      </div>

      {refused && (
        <p className="mt-3 rounded-control bg-accent-50 px-3 py-2 text-sm text-accent-700 ring-1 ring-accent-400">
          <span className="font-mono">{refused.name}</span> was not read - {refused.reason}. Nothing
          was sent.
        </p>
      )}
    </div>
  );
}
