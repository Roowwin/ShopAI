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

   THE BROWSER'S OWN CONTROLS, as `product-import/SheetDrop.tsx` puts it: a real `<input>` inside the
   zone, so keyboard focus and the native picker keep working, and a drop simply hands the same
   Files to the same handler. `webkitdirectory` is what turns that picker into a folder picker; it
   is non-standard, so it is spread rather than written as a JSX attribute React has no type for.

   THE FOLDER IS SENT IN CHUNKS, and the sizes below are not arbitrary. nginx caps a request at
   25 MB on both vhosts, so a 300 MB folder posted in one go comes back as a 413 from the proxy
   before the API sees it - an error the operator can do nothing about. The client flushes a batch
   before it reaches the ceiling, which keeps every request inside the limit and lets the screen
   show how far along it is. */

const IMAGE = /\.(jpe?g|png|webp|gif|bmp|heic|tiff?)$/i;
const MAX_BATCH_BYTES = 15 * 1024 * 1024;
const MAX_BATCH_FILES = 40;

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
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [refused, setRefused] = useState<{ name: string; reason: string }[]>([]);
  const [pool, setPool] = useState<PoolItem[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
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
    if (busy || files.length === 0) return;
    setErr(""); setRefused([]); setBusy(true);
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
    const files = list ? Array.from(list) : [];
    void send(files);
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
        onDragOver={(e) => { e.preventDefault(); if (!busy && !over) setOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); setOver(false); }}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) take(e.dataTransfer?.files); }}
        className={cn(
          "mt-3 rounded-card px-4 py-5 text-center border border-dashed",
          "transition-colors duration-fast ease-out motion-reduce:transition-none",
          over ? "border-brand-700 bg-surface-pressed" : "border-line-strong bg-surface-sunken",
        )}
      >
        <p className="text-sm font-semibold text-ink-900">
          {busy
            ? `Uploading ${progress?.done ?? 0} of ${progress?.total ?? 0}…`
            : over ? "Release to upload these photographs" : "Drop a folder of photographs here"}
        </p>
        <p className="mx-auto mt-1 max-w-md text-xs text-ink-500">
          JPEG, PNG, WebP or GIF, up to 5 MB each. Nothing is attached to a product yet - each group
          offers the photo whose filename matches it.
        </p>

        <input
          ref={folderRef}
          type="file"
          multiple
          disabled={busy}
          accept="image/png,image/jpeg,image/webp,image/gif"
          // Non-standard, and the only thing that makes this a FOLDER picker. React has no type for
          // it, so it is spread rather than written as a JSX attribute.
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          onChange={(e) => { take(e.target.files); e.target.value = ""; }}
          aria-label="Choose a folder of product photographs"
          className={cn(
            "mx-auto mt-4 block w-full max-w-sm text-xs text-ink-500",
            "file:mr-3 file:rounded-control file:border-0 file:bg-brand-700 file:px-3 file:py-2",
            "file:text-xs file:font-semibold file:text-ink-900",
            "disabled:opacity-50 disabled:pointer-events-none",
            "outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2",
          )}
        />
      </div>

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
