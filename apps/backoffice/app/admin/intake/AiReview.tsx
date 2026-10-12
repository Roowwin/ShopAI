"use client";

import { useEffect, useState } from "react";
import { Badge, Button, cn } from "@/app/components/ui";
import { gradeTone, kickerClass } from "@/lib/ui";

/* The review: the raw input on the left, the card the model produced on the right.

   BOTH SIDES ARE THE RECORD ITSELF. The left column shows the photo that was actually handed to
   the model and the raw fields the operator has actually entered - the same values the scan-in
   body will carry. The right column shows the draft the call actually returned, field for field,
   including the serial the model claims to have read and the confidence it declared about its own
   answer.

   The briefed "raw spreadsheet rows" column has NO data behind it - nothing in this build parses
   a sheet - so it renders as a labelled, explicit absence rather than a row list. The same is
   true of an empty draft: the panel names what has not happened instead of drawing a shape.

   ONE RECORD AT A TIME. The two sides are only one record if they come from one call, so a new
   photo cannot start while a draft is being read (the zone shuts its door and the page refuses
   re-entry), and a response that is no longer the newest cannot write here at all. While a call
   is out the right column says so rather than claiming the model has not read anything.

   The prefill control is the page's existing one, moved here unchanged: it writes the scan-in
   fields and nothing else. No control on this panel writes to the API; the review is read-only
   until the operator chooses to carry a value across. */

export type Draft = {
  brand: string;
  model: string;
  serial_visible: string;
  condition_notes: string;
  suggested_grade: string;
  confidence: string;
};

export type Photo = { url: string; name: string; size: string };

/** The raw field pair: a label and the value the operator has actually entered. */
export type RawField = { label: string; value: string };

/* A column ground. It is a step of its own inside the panel, so each side reads as a document
   rather than as two paragraphs; the fill is opaque, which is what makes the computed pairs
   inside each column the ones that apply to it. */
const COLUMN = "rounded-card bg-surface-muted p-4 ring-1 ring-line";

export default function AiReview({ photo, raw, draft, reading, onPrefill }: {
  photo: Photo | null;
  raw: RawField[];
  draft: Draft | null;
  /** a draft call is out right now - the card is not empty, it is pending */
  reading: boolean;
  onPrefill: () => void;
}) {
  /* The right column arrives rather than appearing: the draft is a result, and a result that
     simply blinks into place is easy to miss. One opacity fade, run through the app's own timing
     classes, with the reduced-motion pair beside it - those readers get the finished state at
     once instead of a travel they asked not to see. */
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!draft) { setShown(false); return; }
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, [draft]);

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className={kickerClass}>AI review</p>
        <p className="text-xs text-ink-500">Nothing here is written until you press a control.</p>
      </div>

      <div className="mt-2 grid gap-4 lg:grid-cols-2">
        {/* ------------------------------------------------ the raw side */}
        <div className={COLUMN}>
          <p className="text-sm font-semibold text-ink-900">Raw input</p>

          {photo ? (
            <figure className="mt-3">
              {/* The operator's own file, shown from an object address made from that File - not
                  a stand-in. It is the exact bytes the model was given. */}
              <img
                src={photo.url}
                alt={"The photo submitted for review: " + photo.name}
                className="max-h-56 w-full rounded-control object-cover ring-1 ring-line"
              />
              <figcaption className="mt-2 flex flex-wrap items-baseline justify-between gap-2 text-xs">
                <span className="font-mono text-ink-700">{photo.name}</span>
                <span className="text-ink-500">{photo.size}</span>
              </figcaption>
            </figure>
          ) : (
            <p className="mt-3 rounded-control bg-surface-sunken px-3 py-2 text-sm text-ink-400 ring-1 ring-line">
              No photo yet - drop one in the zone above, or choose one there.
            </p>
          )}

          <dl className="mt-3 space-y-1 text-sm">
            {raw.map((f) => (
              <div key={f.label} className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-500">{f.label}</dt>
                <dd className="min-w-0 truncate font-mono text-ink-700">{f.value}</dd>
              </div>
            ))}
          </dl>

          {/* The briefed sheet column, and the honest statement that it has no data behind it. */}
          <div className="mt-4 border-t border-line pt-3">
            <p className="text-xs font-semibold text-ink-500">Spreadsheet rows</p>
            <p className="mt-1 text-sm text-ink-400">
              Not available - this build has no spreadsheet reader, so there are no rows to show
              here and none have been invented.
            </p>
          </div>
        </div>

        {/* ------------------------------------------------ the model's side */}
        <div
          className={cn(
            COLUMN,
            "transition-opacity duration-150 ease-out motion-reduce:transition-none",
            draft && !shown ? "opacity-0" : "opacity-100",
          )}
        >
          <p className="text-sm font-semibold text-ink-900">AI card</p>

          {draft ? (
            <div className="mt-3 space-y-2 rounded-control bg-surface p-4 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink-900">
                  {draft.brand} {draft.model}
                </span>
                <Badge colorClass={gradeTone(draft.suggested_grade)}>
                  grade {draft.suggested_grade}
                </Badge>
                <span className="text-xs text-ink-500">confidence {draft.confidence}</span>
              </p>
              {draft.serial_visible && (
                <p className="font-mono text-xs text-ink-700">serial seen: {draft.serial_visible}</p>
              )}
              <p className="text-ink-700">{draft.condition_notes}</p>
              <p className="text-xs text-ink-500">
                The model read the photo only. This draft is a proposal - it has not touched stock.
              </p>
              <Button size="sm" onClick={onPrefill}>Prefill scan-in</Button>
            </div>
          ) : reading ? (
            <p className="mt-3 rounded-control bg-surface-sunken px-3 py-2 text-sm text-ink-400 ring-1 ring-line">
              Reading the photo now - this card fills in when the call answers.
            </p>
          ) : (
            <p className="mt-3 rounded-control bg-surface-sunken px-3 py-2 text-sm text-ink-400 ring-1 ring-line">
              No draft yet - the model has not read a photo in this session.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
