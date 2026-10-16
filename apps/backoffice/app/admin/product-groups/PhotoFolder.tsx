"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Button, Card, cn } from "@/app/components/ui";
import { kickerClass, linkClass } from "@/lib/ui";

/* THE PHOTO FOLDER: three hundred photographs across the wire once, so that attaching them later is
   three hundred small UPDATEs instead of three hundred file pickers.

   NOTHING IS MATCHED HERE. This component's whole job is to get bytes into the pool and say what
   arrived; which group each photograph belongs to is decided one press at a time in `GroupEditor`,
   by somebody looking at the picture. That split is the feature, not a missing step - see
   `app/services/group_image_match.py` for why this app does not guess about a shopper's product
   photo.

   TWO WAYS IN, EACH NAMED FOR THE PICKER IT OPENS. `webkitdirectory` is what makes the bulk route
   work, but the browser labels that control's button "Choose files" like any other file input
   while opening a dialog that lists folders and lets nothing in them be chosen - so the one control
   this zone had read as a file chooser and delivered nothing. The inputs are therefore hidden and
   driven by two buttons that say which dialog they open; keyboard focus lives on the buttons, and
   both inputs call the same handler. `webkitdirectory` is non-standard, so it is spread rather than
   written as a JSX attribute React has no type for.

   A DROPPED FOLDER IS READ, NOT LISTED. `dataTransfer.files` hands a dropped directory over as one
   entry carrying no bytes, so "drop a folder of photographs here" uploaded nothing and said
   nothing. The drop asks `dataTransfer.items` for its entries and walks the tree instead, which is
   what turns a folder into the same Files the picker hands over.

   THE FOLDER IS SENT IN CHUNKS, and the sizes below are not arbitrary. nginx caps a request at
   25 MB on both vhosts, so a 300 MB folder posted in one go comes back as a 413 from the proxy
   before the API sees it - an error the operator can do nothing about. The client flushes a batch
   before it reaches the ceiling, which keeps every request inside the limit and lets the screen
   show how far along it is. */

const IMAGE = /\.(jpe?g|png|webp|gif|bmp|heic|tiff?)$/i;
const ACCEPT_IMAGE = "image/png,image/jpeg,image/webp,image/gif";
const MAX_BATCH_BYTES = 15 * 1024 * 1024;
const MAX_BATCH_FILES = 40;

/* One directory's contents, in full. `readEntries` delivers at most a hundred entries per call and
   answers with an EMPTY batch at the end of the directory - so a single call is the first hundred
   files of a folder and not the folder, and stopping there is how a drop of three hundred
   photographs arrives as a hundred. */
function readDir(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const next = () => reader.readEntries((batch) => {
      if (batch.length === 0) { resolve(all); return; }
      all.push(...batch);
      next();
    }, reject);
    next();
  });
}

/* A dropped entry that cannot be read costs that entry and nothing else. Both failures are real -
   a file the browser will not hand over, a directory it will not list - and the walk is depth-first
   and sequential, so a throw here would take every entry after it and the whole drop with it. */
async function descend(entry: FileSystemEntry, into: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) =>
      (entry as FileSystemFileEntry).file(resolve, () => resolve(null)));
    if (file) into.push(file);
    return;
  }
  if (!entry.isDirectory) return;
  let children: FileSystemEntry[];
  try {
    children = await readDir((entry as FileSystemDirectoryEntry).createReader());
  } catch {
    return;
  }
  for (const child of children) await descend(child, into);
}

type PoolItem = {
  media_id: number; public_id: string; filename: string;
  content_type: string; byte_size: number; uploaded_at: string; raw_path: string;
};

function PoolThumb({ mediaId }: { mediaId: number }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let made = "";
    apiFetch(`/staff/product-groups/image-pool/${mediaId}/raw`)
      .then(async (r) => {
        if (!r.ok) { if (alive) setFailed(true); return; }
        const b = await r.blob();
        if (!alive) return;
        made = URL.createObjectURL(b);
        setUrl(made);
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [mediaId]);
  if (failed) return <span className="block h-16 w-16 rounded-control bg-surface-sunken" aria-hidden="true" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a blob: URL, not a remote asset
    <img src={url} alt="" className="h-16 w-16 rounded-control object-cover ring-1 ring-line" />
  );
}

export default function PhotoFolder({ onPoolChanged }: { onPoolChanged?: () => void }) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [refused, setRefused] = useState<{ name: string; reason: string }[]>([]);
  const [pool, setPool] = useState<PoolItem[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const filesRef = useRef<HTMLInputElement | null>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);

  const loadPool = useCallback(async () => {
    const r = await apiFetch("/staff/product-groups/image-pool?limit=200");
    if (!r.ok) { setErr("the photo pool could not be read"); return; }
    const j = await r.json();
    setPool(j.items ?? []);
    setTotal(j.total ?? 0);
  }, []);

  useEffect(() => { void loadPool(); }, [loadPool]);

  async function send(files: File[]) {
    if (busy || reading) return;
    setErr(""); setNote(""); setRefused([]);
    // An empty folder is a real answer to the operator's press and used to be an unanswered one:
    // the zone said nothing at all, which reads as a control that does not work.
    if (files.length === 0) { setNote("Nothing arrived in that selection - no files in it."); return; }
    setBusy(true);
    // Screened here as well as on the server, so the operator learns which file was skipped without
    // a round trip that ends in "an image was refused" and no name.
    const images = files.filter((f) => IMAGE.test(f.name));
    const skipped = files.filter((f) => !IMAGE.test(f.name))
      .map((f) => ({ name: f.name, reason: "not a JPEG, PNG, WebP, GIF, BMP or TIFF" }));
    if (skipped.length) setRefused(skipped);
    setProgress({ done: 0, total: images.length });

    let batch: File[] = [];
    let bytes = 0;
    let done = 0;
    const flush = async (): Promise<boolean> => {
      if (batch.length === 0) return true;
      const fd = new FormData();
      for (const f of batch) fd.append("files", f);
      batch = []; bytes = 0;
      const r = await apiFetch("/staff/product-groups/images", { method: "POST", body: fd });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(typeof j.detail === "string" ? j.detail : "that batch was refused (" + r.status + ")");
        return false;
      }
      if (Array.isArray(j.refused) && j.refused.length) {
        setRefused((prev) => [...prev, ...j.refused]);
      }
      done += (j.uploaded ?? []).length;
      setProgress({ done, total: images.length });
      return true;
    };

    for (const f of images) {
      if (batch.length >= MAX_BATCH_FILES || (bytes + f.size > MAX_BATCH_BYTES && batch.length > 0)) {
        if (!await flush()) { setBusy(false); return; }
      }
      batch.push(f); bytes += f.size;
    }
    if (!await flush()) { setBusy(false); return; }

    setBusy(false);
    setProgress(null);
    await loadPool();
    onPoolChanged?.();
  }

  function take(list: FileList | null | undefined) {
    void send(list ? Array.from(list) : []);
  }

  /* Entries are read HERE, while the drop is still being handled - the item list is emptied as soon
     as this returns, so an entry kept for later is an entry that reads as nothing. Where the entry
     API is missing (or the drop is not from the file system at all) the flat list is all there is,
     and that path can only ever deliver files. */
  function drop(dt: DataTransfer | null) {
    if (!dt || busy || reading) return;
    const entries = Array.from(dt.items ?? [])
      .filter((it) => it.kind === "file")
      .map((it) => (typeof it.webkitGetAsEntry === "function" ? it.webkitGetAsEntry() : null))
      .filter((e): e is FileSystemEntry => e !== null);
    if (entries.length === 0) { take(dt.files); return; }
    setReading(true);
    void (async () => {
      const files: File[] = [];
      try {
        for (const e of entries) await descend(e, files);
      } finally {
        setReading(false);
      }
      await send(files);
    })();
  }

  async function discard(mediaId: number) {
    setErr("");
    const r = await apiFetch(`/staff/product-groups/image-pool/${mediaId}`, { method: "DELETE" });
    if (!r.ok) {
      const j: any = await r.json().catch(() => ({}));
      setErr(typeof j.detail === "string" ? j.detail : "that image could not be removed");
      return;
    }
    await loadPool();
  }

  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between">
        <p className={kickerClass}>Photo folder</p>
        <span className="text-xs text-ink-500">
          {total === 0 ? "nothing waiting" : total + " image" + (total === 1 ? "" : "s") + " waiting to be matched"}
        </span>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); if (!busy && !reading && !over) setOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); setOver(false); }}
        onDrop={(e) => { e.preventDefault(); setOver(false); drop(e.dataTransfer); }}
        className={cn(
          "mt-3 rounded-card px-4 py-5 text-center border border-dashed",
          "transition-colors duration-fast ease-out motion-reduce:transition-none",
          over ? "border-brand-700 bg-surface-pressed" : "border-line-strong bg-surface-sunken",
        )}
      >
        <p className="text-sm font-semibold text-ink-900">
          {reading
            ? "Reading that folder…"
            : busy
              ? `Uploading ${progress?.done ?? 0} of ${progress?.total ?? 0}…`
              : over ? "Release to upload these photographs" : "Drop a folder of photographs here"}
        </p>
        <p className="mx-auto mt-1 max-w-md text-xs text-ink-500">
          JPEG, PNG, WebP or GIF, up to 5 MB each. Nothing is attached to a product yet - each group
          offers the photo whose filename matches it.
        </p>

        {/* Both inputs are `hidden` rather than styled, and both are driven by a button that names
            the dialog it opens: the browser calls a folder picker's button "Choose files" too, so a
            bare `webkitdirectory` input is a control that offers files and shows folders. */}
        <input
          ref={filesRef}
          type="file"
          multiple
          accept={ACCEPT_IMAGE}
          onChange={(e) => { take(e.target.files); e.target.value = ""; }}
          className="hidden"
        />
        <input
          ref={folderRef}
          type="file"
          multiple
          accept={ACCEPT_IMAGE}
          // Non-standard, and the only thing that makes this a FOLDER picker. React has no type for
          // it, so it is spread rather than written as a JSX attribute.
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          onChange={(e) => { take(e.target.files); e.target.value = ""; }}
          className="hidden"
        />
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <Button onClick={() => filesRef.current?.click()} disabled={busy || reading}>
            Choose photographs
          </Button>
          <Button variant="secondary" onClick={() => folderRef.current?.click()} disabled={busy || reading}>
            Choose a whole folder
          </Button>
        </div>
      </div>

      {note && <p className="mt-3 text-sm text-ink-500">{note}</p>}

      {refused.length > 0 && (
        <ul className="mt-3 space-y-1">
          {refused.slice(0, 8).map((r, i) => (
            <li key={i} className="rounded-control bg-accent-50 px-3 py-1.5 text-xs text-accent-700 ring-1 ring-accent-400">
              <span className="font-mono">{r.name}</span> was not uploaded - {r.reason}.
            </li>
          ))}
          {refused.length > 8 && (
            <li className="text-xs text-ink-500">and {refused.length - 8} more, all skipped the same way.</li>
          )}
        </ul>
      )}
      {err && <p className="mt-3 text-sm text-danger-600">{err}</p>}

      {total > 0 && (
        <div className="mt-4">
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
            className={cn("text-xs", linkClass)}>
            {open ? "Hide" : "Show"} the {total} unmatched photograph{total === 1 ? "" : "s"}
          </button>
          {open && (
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {pool.map((it) => (
                <li key={it.media_id} className="flex flex-col gap-1">
                  <PoolThumb mediaId={it.media_id} />
                  <span className="truncate text-[10px] text-ink-500" title={it.filename}>{it.filename}</span>
                  <button type="button" onClick={() => void discard(it.media_id)}
                    className={cn("self-start text-[10px]", linkClass)}>
                    Discard
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
