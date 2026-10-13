"use client";

import { useEffect, useState } from "react";

import { Button, Input, cn } from "@/app/components/ui";
import { apiFetch } from "@/lib/api";
import { kickerClass } from "@/lib/ui";
import Photo from "./Photo";

/* THE PHOTO PICKER. What replaced the "Image URL" text box.

   An operator setting a model's photo should be looking at photographs, not pasting a string they
   had to find somewhere else and hope was right. Every photo the catalogue already holds is here -
   `product_media` is a real table that 0014 made live - so the choice is a picture and a click.

   IT OPENS IN PLACE, UNDER THE ROW IT BELONGS TO, rather than in a modal. A modal would have to trap
   focus, close on Escape and put focus back where it came from, and this app has no dialog primitive
   to build that on; a panel that pushes the list down needs none of it and keeps the row - the
   model's name, its units, its switch - on screen while the choice is made. The one thing it does
   need is to be reachable and dismissible by keyboard, which the button that opens it and the Close
   button here both are.

   THE SEARCH IS THE SERVER'S. `q` goes to the gallery door, debounced, so a catalogue with more
   photos than one page holds can still be searched - filtering a fetched page client-side would
   quietly stop finding photos outside it. */
export type GalleryItem = {
  media_row_id: number;
  product_id: number;
  product_slug: string;
  product_title: string;
  storage_key: string | null;
  media_id: number | null;
  filename: string | null;
  content_type: string | null;
  byte_size: number | null;
  position: number;
  is_primary: boolean;
  alt_text: string | null;
  created_at: string;
  publishable: boolean;
  raw_path: string | null;
};

type State = { items: GalleryItem[]; total: number; shown: number };

type Props = {
  /** The address this model shows today, so the photo in use is marked rather than merely present. */
  current: string | null;
  busy: boolean;
  onPick: (item: GalleryItem) => void;
  onClear: () => void;
  onClose: () => void;
};

export default function MediaTray({ current, busy, onPick, onClear, onClose }: Props) {
  const [q, setQ] = useState("");
  const [state, setState] = useState<State | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    setErr("");
    /* No delay on the first read (the panel is already open and empty); a short one once typing
       starts, so a five-letter search is one request rather than five. */
    const t = setTimeout(async () => {
      try {
        const term = q.trim();
        const r = await apiFetch("/staff/cms/media?limit=72" + (term ? "&q=" + encodeURIComponent(term) : ""));
        if (!r.ok) { if (alive) { setErr("the gallery could not be read (" + r.status + ")"); } return; }
        const j = await r.json();
        if (!alive) { return; }
        setState({ items: j.items ?? [], total: j.total ?? 0, shown: j.shown ?? (j.items ?? []).length });
      } catch (e: any) {
        if (alive) { setErr(String(e?.message ?? e)); }
      }
    }, q ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  const items = state?.items ?? [];

  return (
    <div className="mt-3 rounded-control bg-surface-sunken p-3 ring-1 ring-line">
      <div className="flex flex-wrap items-end gap-2 pb-3">
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="cms-photo-q" className={cn(kickerClass, "block pb-1")}>Find a photo</label>
          <Input id="cms-photo-q" placeholder="product name, file name or address" value={q}
                 onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>

      {err && <p className="pb-3 text-sm text-danger-600">{err}</p>}

      {state === null && !err && <p className="text-sm text-ink-500">Reading the gallery...</p>}

      {state !== null && items.length === 0 && (
        <p className="text-sm text-ink-500">
          {q.trim() ? "No photo in the catalogue matches that."
                     : "The catalogue has no stock photos yet."}
        </p>
      )}

      {items.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((it) => {
            const inUse = Boolean(it.storage_key) && it.storage_key === current;
            const name = it.alt_text || it.filename || it.product_title;
            return (
              <li key={it.media_row_id}>
                <button
                  type="button"
                  disabled={busy || !it.publishable}
                  aria-pressed={inUse}
                  aria-label={it.publishable
                    ? `Use ${name} from ${it.product_title} for this model`
                    : `${name} is stored behind the staff door and cannot be published`}
                  title={it.publishable ? undefined
                    : "Stored in the staff vault - it has no public address the storefront could render"}
                  onClick={() => onPick(it)}
                  className={cn(
                    "block w-full overflow-hidden rounded-control text-left ring-1 transition",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    inUse ? "ring-2 ring-brand-500" : "ring-line hover:ring-brand-300",
                  )}
                >
                  <Photo
                    address={it.storage_key}
                    rawPath={it.raw_path}
                    alt={it.publishable ? name : ""}
                    className="h-24 w-full object-cover"
                    fallback={<span className="block h-24 w-full bg-surface" aria-hidden="true" />}
                  />
                  <span className="block px-2 py-1.5">
                    <span className="block truncate text-xs text-ink-600" title={it.product_title}>
                      {it.product_title}
                    </span>
                    <span className="block truncate text-[11px] text-ink-500">
                      {inUse ? "in use"
                             : it.publishable ? (it.filename || "catalogue photo")
                             : "not publishable"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {state !== null && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3">
          <p className="text-xs text-ink-500">
            {state.shown < state.total
              ? `Showing ${state.shown} of ${state.total} catalogue photos${q.trim() ? "" : " - narrow it down with a search"}.`
              : `${state.total} catalogue photo${state.total === 1 ? "" : "s"}.`}
          </p>
          {current && (
            <Button variant="muted" size="sm" disabled={busy} onClick={onClear}>
              Remove this model&rsquo;s photo
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
