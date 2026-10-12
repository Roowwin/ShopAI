"use client";

import { useState, type DragEvent } from "react";
import { cn } from "@/app/components/ui";

/* The intake drop target.

   WHAT IT ACTUALLY DOES. A dropped or chosen PHOTO runs the same call this page's file field has
   always run: the same multipart body, the same field name, the same endpoint. That is the whole
   of the zone's real work, and the field itself is still the browser's own - kept as the real
   element so keyboard focus, the native picker and the existing change handler are exactly what
   they were, with only its paint changed.

   ONE PHOTO AT A TIME. While a draft call is out the door is shut: the field is disabled and a
   drop is refused before it can start a second call. Two calls in flight could answer out of
   order, and because this panel draws the photo and the draft as the two sides of ONE record, a
   late answer would pair the wrong photo with the wrong brand, model and serial - the operator
   would then be prefilling a real scan-in from the wrong record. The page guards its own entry
   as well; this is the same rule at the door the operator actually touches.

   WHAT IT DOES NOT DO. There is no spreadsheet reader in this repo - no parser dependency, no
   service that takes a sheet - so the brief's "drop a CSV and watch rows appear" has no code
   behind it. The zone therefore REFUSES a sheet out loud, names the way forward, and sends
   nothing, rather than swallowing the file. A file that is neither a photo nor a sheet is told
   exactly that: the copy never claims a kind the zone did not establish. It never draws rows it
   did not read either: a plausible row list built from a file nothing parsed is the one outcome
   worse than saying so.

   The surface around the field is painted and inert. Dragging over it only changes the paint; the
   drop itself hands the file to the page, which owns every call and every line of the record. */

const SHEET = /\.(csv|xlsx|xls|tsv)$/i;

type Refused = { name: string; sheet: boolean };

export default function DropZone({ onPhoto, onRefuse, busy }: {
  /** a real image File, straight from the picker or the drop */
  onPhoto: (file: File) => void;
  /** a file the zone would not send, and whether it was recognised as a sheet */
  onRefuse: (name: string, sheet: boolean) => void;
  /** true while a draft call is out - the door is shut for the whole of it */
  busy: boolean;
}) {
  const [over, setOver] = useState(false);
  const [refused, setRefused] = useState<Refused | null>(null);

  /* Recognised as a sheet by its own extension or by the type the browser supplied - a browser
     that knows the file sends the sheet's MIME, and one that does not still leaves the suffix. */
  function looksLikeSheet(f: File): boolean {
    return SHEET.test(f.name) || f.type === "text/csv" || f.type.includes("spreadsheet");
  }

  /* The one door. Everything the zone hands on has passed through here, so `busy` is checked once
     and a second photo cannot start a call while the first is still out. */
  function take(f: File | null | undefined) {
    if (!f || busy) { return; }
    if (f.type.startsWith("image/")) { setRefused(null); onPhoto(f); return; }
    const sheet = looksLikeSheet(f);
    setRefused({ name: f.name, sheet });
    onRefuse(f.name, sheet);
  }

  /* The browser only fires a drop where the drag was allowed to land, so the over events have to
     answer before the drop can arrive at all. While a call is out the zone does not light up:
     a surface that invites a drop it will refuse is worse than one that stays quiet. */
  function onOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!busy && !over) { setOver(true); }
  }
  function onLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
  }
  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer?.files?.[0]);
  }

  return (
    <div>
      <div
        onDragOver={onOver}
        onDragLeave={onLeave}
        onDrop={onDrop}
        className={cn(
          "rounded-card px-6 py-8 text-center",
          "border border-dashed transition-colors duration-150 ease-out motion-reduce:transition-none",
          over ? "border-brand-500 bg-brand-50" : "border-line-strong bg-surface-muted hover:border-brand-500",
        )}
      >
        <p className={cn("text-base font-semibold", over ? "text-ink-600" : "text-ink-900")}>
          {busy ? "Reading the photo..." : over ? "Release to scan this photo" : "Drop a product photo here"}
        </p>
        <p className={cn("mx-auto mt-1 max-w-md text-sm", over ? "text-ink-600" : "text-ink-500")}>
          The model reads the photo and drafts the card - you confirm everything, and a draft never
          touches stock.
        </p>

        {/* The real control, restyled. Focus lands on the input itself, so the cue is drawn where
            the keyboard actually is rather than on a wrapper that only looks pressed. It carries
            the same disabled treatment as the app's own Button, so a reader can see the door is
            shut rather than press a control that does nothing. */}
        <input
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ""; take(f); }}
          aria-label="Choose a product photo"
          className={cn(
            "mx-auto mt-5 block w-full max-w-sm text-sm text-ink-500",
            "file:mr-3 file:rounded-control file:border-0 file:bg-brand-700 file:px-4 file:py-2",
            "file:text-sm file:font-semibold file:text-ink-900",
            "disabled:opacity-50 disabled:pointer-events-none",
            "outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2",
          )}
        />

        <p className="mt-3 text-xs text-ink-500">
          Photos only. Spreadsheet import (CSV or XLSX) is not wired yet.
        </p>
      </div>

      {refused && (
        <p className="mt-3 rounded-control bg-accent-50 px-3 py-2 text-sm text-accent-700 ring-1 ring-accent-400">
          {refused.sheet
            ? <>Spreadsheet parsing is not wired yet - <span className="font-mono">{refused.name}</span> was
                not read and nothing was sent. Drop a photo to scan instead.</>
            : <><span className="font-mono">{refused.name}</span> is not a photo - it was not read and
                nothing was sent. Drop a product photo to scan instead.</>}
        </p>
      )}
    </div>
  );
}
