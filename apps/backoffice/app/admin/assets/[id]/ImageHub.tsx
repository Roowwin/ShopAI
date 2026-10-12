"use client";

/* THE IMAGE HUB. One unit's photographs, and the two things a lot's worth of them needs.

   UPLOAD. One file at a time, through the multipart door. The size and type rules live in the API
   (a 422 or a 413 with a sentence); this form only refuses the obvious case of no file chosen, so
   there is one authority on what an image is.

   APPLY TO ALL MODEL. A grader photographs one unit and the whole box is the same phone - so the
   shot is applied to every unit OF THE SAME BRAND AND MODEL IN THE SAME LOT. The match is the
   server's (it is the half that can see the other rows); this button reports what came back,
   including how many units already had it, because "applied to 0" and "applied to 0, they all had
   it already" are different answers to the same press.

   GRADE TEMPLATE. Per image, four buttons: which grade THIS LOT says this photo is the example of.
   A press sets it, and a press on the grade this image already templates CLEARS it - which is why
   the control is four toggles and not a menu. The grades arrive as a map with nulls for the unset
   ones, so a control can say "no template" rather than showing nothing at all.

   THUMBNAILS ARE FETCHED, NOT LINKED. The staff token is a bearer header and no `<img src>` can
   carry one, so every picture here is read through the same authenticated door as the page and
   shown from a blob URL. That is what keeps a unit's photograph off the public internet instead of
   behind a guessable path. Each blob URL is revoked when its picture goes or the row changes:
   without that, a page that uploads twenty shots holds twenty decoded images alive. */

import { useEffect, useRef, useState } from "react";

import { Badge, Button, Card, Heading, cn } from "@/app/components/ui";
import { apiFetch } from "@/lib/api";
import { when } from "@/lib/format";
import { kickerClass } from "@/lib/ui";

export type HubImage = {
  id: number;
  media_id: number;
  filename: string;
  content_type: string;
  byte_size: number;
  applied_at: string;
  applied_by: number | null;
  applied_by_bulk: boolean;
};

const GRADES = ["A", "B", "C", "D"] as const;

function kb(bytes: number): string {
  return bytes >= 1024 * 1024 ? (bytes / (1024 * 1024)).toFixed(1) + " MB"
                              : Math.max(1, Math.round(bytes / 1024)) + " KB";
}

/* One picture, read through the door and held as a blob URL for as long as it is on screen. */
function Thumb({ assetId, imageId, alt }: { assetId: number; imageId: number; alt: string }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let made = "";
    apiFetch(`/staff/assets/${assetId}/images/${imageId}/raw`)
      .then(async (r) => {
        if (!r.ok) { if (alive) setFailed(true); return; }
        const blob = await r.blob();
        if (!alive) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [assetId, imageId]);

  if (failed) {
    return (
      <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-control bg-surface-sunken ring-1 ring-line">
        <span className="px-2 text-center text-[10px] text-ink-500">picture unavailable</span>
      </div>
    );
  }
  if (!url) {
    return <div className="h-24 w-24 shrink-0 rounded-control bg-surface-sunken ring-1 ring-line"
                aria-hidden="true" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a blob: URL, not a remote asset
    <img src={url} alt={alt} className="h-24 w-24 shrink-0 rounded-control object-cover ring-1 ring-line" />
  );
}

type Props = {
  assetId: number;
  lotId: number | null;
  images: HubImage[];
  templates: Record<string, number | null>;
  canManage: boolean;
  onChanged: () => void;
};

export default function ImageHub({ assetId, lotId, images, templates, canManage, onChanged }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function call(path: string, init?: RequestInit, ok?: string) {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const r = await apiFetch(path, init);
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(typeof j.detail === "string" ? j.detail : "that request was refused (" + r.status + ")");
        return null;
      }
      if (ok) setMsg(ok);
      onChanged();
      return j;
    } catch (e: any) {
      setErr(String(e?.message ?? e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setMsg(""); setErr("Choose a file first."); return; }
    const form = new FormData();
    form.append("file", file);
    // No Content-Type header: the browser has to set it, boundary and all.
    const j = await call(`/staff/assets/${assetId}/images`, { method: "POST", body: form },
                         "Image attached to this unit.");
    if (j && fileRef.current) fileRef.current.value = "";
  }

  async function applyToModel(img: HubImage) {
    const j = await call(`/staff/assets/${assetId}/images/${img.id}/apply-to-model`, { method: "POST" });
    if (!j) return;
    setMsg(j.matched_other_units === 0
      ? "No other unit in this lot is the same brand and model."
      : `Applied to ${j.applied} more unit${j.applied === 1 ? "" : "s"} of this model in the lot` +
        (j.already_had_it > 0 ? ` (${j.already_had_it} already had it).` : "."));
  }

  /* Both sides of this comparison are MEDIA ids - what a grade points at, and what this row's file
     is. The buttons are keyed by assignment id, which is a third thing again, and mixing the two
     is how a toggle ends up clearing the wrong image. */
  function templatesGrade(img: HubImage, grade: string): boolean {
    const media = templates[grade];
    return media !== null && media !== undefined && media === img.media_id;
  }

  async function setTemplate(img: HubImage, grade: string) {
    // A press on the grade this image already holds clears it. The server contract is the same
    // field either way: an explicit null clears, a missing field is refused.
    const clear = templatesGrade(img, grade);
    await call(`/staff/lots/${lotId}/grade-templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grade, image_id: clear ? null : img.id }),
    }, clear ? `Grade ${grade} template cleared.` : `Grade ${grade} template set to ${img.filename}.`);
  }

  const anyTemplate = GRADES.some((g) => templates[g] !== null && templates[g] !== undefined);

  return (
    <Card className="p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <Heading level="h2">Images</Heading>
        <span className="text-xs text-ink-500">JPEG, PNG, WebP or GIF &middot; up to 5 MB</span>
      </div>

      {canManage ? (
        <div className="flex flex-wrap items-end gap-3 pb-4">
          <div className="min-w-[14rem] flex-1">
            <label htmlFor="hub-file" className={cn(kickerClass, "block pb-1")}>Attach a photo</label>
            <input
              id="hub-file"
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              disabled={busy}
              className={cn(
                "block w-full rounded-control bg-surface px-3 py-2 text-xs text-ink-600",
                "ring-1 ring-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700",
                "file:mr-3 file:rounded-control file:border-0",
                "file:bg-brand-700 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white",
                "disabled:opacity-50",
              )}
            />
          </div>
          <Button onClick={upload} disabled={busy}>{busy ? "Working..." : "Upload"}</Button>
        </div>
      ) : (
        <p className="pb-4 text-sm text-ink-500">
          Attaching and applying images needs the store manager role.
        </p>
      )}

      {msg && <p className="pb-3 text-sm text-brand-300">{msg}</p>}
      {err && <p className="pb-3 text-sm text-danger-600">{err}</p>}

      {images.length === 0 ? (
        <p className="text-sm text-ink-500">No images on this unit yet.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {images.map((img) => (
            <li key={img.id} className="flex gap-3">
              <Thumb assetId={assetId} imageId={img.id} alt={img.filename} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink-900" title={img.filename}>{img.filename}</p>
                <p className="flex flex-wrap items-center gap-1 text-xs text-ink-500">
                  <span>{kb(img.byte_size)} &middot; added {when(img.applied_at)}</span>
                  {img.applied_by_bulk && (
                    <Badge colorClass="bg-surface-sunken text-ink-600">applied to model</Badge>
                  )}
                </p>

                {canManage && (
                  <>
                    <div className="mt-2">
                      <Button size="sm" variant="secondary" disabled={busy || lotId === null}
                              onClick={() => applyToModel(img)}>
                        Apply to all model
                      </Button>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <span className={cn(kickerClass, "pr-1")}>Template for</span>
                      {GRADES.map((g) => {
                        const isSet = templatesGrade(img, g);
                        const takenByOther = !isSet && templates[g] !== null && templates[g] !== undefined;
                        return (
                          <button
                            key={g}
                            type="button"
                            disabled={busy || lotId === null}
                            onClick={() => setTemplate(img, g)}
                            aria-pressed={isSet}
                            aria-label={`${isSet ? "Clear" : "Set"} the grade ${g} template to ${img.filename}`}
                            title={takenByOther ? `Grade ${g} already has a template - this replaces it` : undefined}
                            className={cn(
                              "h-7 min-w-[1.75rem] rounded-control px-2 text-xs font-semibold",
                              "transition duration-fast ease-out motion-reduce:transition-none",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-900",
                              "disabled:opacity-40 disabled:pointer-events-none",
                              isSet ? "bg-brand-500 text-ink-inverse ring-1 ring-brand-500 shadow-glow-sm"
                                    : "bg-surface-sunken text-ink-500 ring-1 ring-line hover:bg-brand-700 hover:text-white",
                              takenByOther ? "opacity-70" : "",
                            )}
                          >
                            {g}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {lotId !== null && images.length > 0 && (
        <p className="pt-4 text-xs text-ink-500">
          A template is this lot&rsquo;s own answer to &ldquo;what does a grade look like from
          here&rdquo;: one image per grade, and setting a second one for a grade replaces the
          first.{anyTemplate ? "" : " No grade has a template yet."}
        </p>
      )}
    </Card>
  );
}
