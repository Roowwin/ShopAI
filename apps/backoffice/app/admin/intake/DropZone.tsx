"use client";

import { useState, type DragEvent } from "react";
import { cn } from "@/app/components/ui";

/* The intake drop target.

   WHAT IT ACTUALLY DOES. A dropped or chosen PHOTO runs the same call this page's file field has
   always run: the same multipart body, the same field name, the same endpoint. That is the whole
   of the zone's real work, and the field itself is still the browser's own - kept as the real
   element so keyboard focus, the native picker and the existing change handler are exactly what
   they were, with only its paint changed.

   WHAT IT DOES NOT DO. There is no spreadsheet reader in this repo - no parser dependency, no
   service that takes a sheet - so the brief's "drop a CSV and watch rows appear" has no code
   behind it. The zone therefore REFUSES a sheet out loud, names the way forward, and sends
   nothing, rather than swallowing the file. It never draws rows it did not read: a plausible row
   list built from a file nothing parsed is the one outcome worse than saying so.

   The surface around the field is painted and inert. Dragging over it only changes the paint; the
   drop itself hands the file to the page, which owns every call and every line of the record. */

const SHEET = /\.(csv|xlsx|xls|tsv)$/i;

export default function DropZone({ onPhoto, onSheet, busy }: {
  /** a real image File, straight from the picker or the drop */
  onPhoto: (file: File) => void;
  /** the name of a spreadsheet that arrived and cannot be read by this build */
  onSheet: (name: string) => void;
  busy: boolean;
}) {
  const [over, setOver] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  function take(f: File | null | undefined) {
    if (!f) { return; }
    if (f.type.startsWith("image/")) { setRefused(null); onPhoto(f); return; }
    setRefused(f.name);
    onSheet(f.name);
  }

  /* The browser only fires a drop where the drag was allowed to land, so the over events have to
     answer before the drop can arrive at all. */
  function onOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!over) { setOver(true); }
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
            the keyboard actually is rather than on a wrapper that only looks pressed. */}
        <input
          type="file"
          accept="image/*"
          onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ""; take(f); }}
          aria-label="Choose a product photo"
          className={cn(
            "mx-auto mt-5 block w-full max-w-sm cursor-pointer text-sm text-ink-500",
            "file:mr-3 file:rounded-control file:border-0 file:bg-brand-700 file:px-4 file:py-2",
            "file:text-sm file:font-semibold file:text-ink-900",
            "outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2",
          )}
        />

        <p className="mt-3 text-xs text-ink-500">
          Photos only. Spreadsheet import (CSV or XLSX) is not wired yet.
        </p>
      </div>

      {refused && (
        <p className="mt-3 rounded-control bg-accent-50 px-3 py-2 text-sm text-accent-700 ring-1 ring-accent-400">
          Spreadsheet parsing is not wired yet - <span className="font-mono">{refused}</span> was not
          read and nothing was sent. Drop a photo to scan instead.
        </p>
      )}
    </div>
  );
}
