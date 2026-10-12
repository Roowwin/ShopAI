"use client";

import { Badge, Button, Heading, Input } from "@/app/components/ui";
import { kickerClass } from "@/lib/ui";
import { VIBES, type Vibe } from "./types";

/* The centre panel: the drafting controls, the editable copy, and the publish press.

   THE COPY HERE IS EDITABLE, and that is the one place this panel departs from the two read-only
   columns the page used to be. The publish call sends whatever is in these fields - not the draft
   the model returned - because the point of a human-approved listing is that the human may correct
   it. The title and description are the whole of what is written; keywords are not sent at all.

   THE VIBE SWITCHER IS WIRED, and it is wired to the one thing it can be: `tone` on the draft call.
   The endpoint takes a product id and an optional tone drawn from a closed set, so a chip cannot
   rewrite a draft in place - there is no rewrite door - but it CAN ask for a fresh draft under that
   vibe, which is what these do. Each press is a new request, so the text that lands is the model's
   answer to the selected tone rather than a client-side edit labelled as one.

   THE GENERATE PRESS SENDS NO TONE when none is chosen, which is the request this page has always
   made - the chips are additive, not a replacement for the plain press.

   PUBLISHING IS TWO WRITES, AND THE PANEL SAYS SO BEFORE IT IS PRESSED. The product's copy is
   replaced through the listing door, and the unit is walked to `listed` through the status door -
   two separate facts (the copy belongs to the product, the listing belongs to the unit) that this
   press performs together. It is deliberately not one button pretending to be one transaction: the
   two writes can succeed or fail independently, and the page reports each one's own answer rather
   than collapsing them into a single word. */

type Props = {
  /** the product the draft is asked about; null when the unit has no product linked */
  productId: number | null;
  title: string;
  description: string;
  keywords: string[];
  vibe: Vibe | null;
  generating: boolean;
  publishing: boolean;
  /** set once a draft has been asked for at least once - distinguishes "no draft yet" from "empty" */
  drafted: boolean;
  onTitle: (v: string) => void;
  onDescription: (v: string) => void;
  /** the page's own draft press; a vibe regenerates under that tone */
  onGenerate: (vibe: Vibe | null) => void;
  /** the page's own publish press */
  onPublish: () => void;
  /** the page's own result lines, printed verbatim */
  messages: string[];
};

const TEXTAREA =
  "w-full rounded-control bg-surface px-4 py-2 text-sm text-ink-900 ring-1 ring-line outline-none " +
  "transition focus:ring-2 focus:ring-brand-700 placeholder:text-ink-500";

export default function AiWorkspace({
  productId, title, description, keywords, vibe, generating, publishing, drafted,
  onTitle, onDescription, onGenerate, onPublish, messages,
}: Props) {
  const busy = generating || publishing;

  return (
    <section aria-label="AI workspace">
      <Heading level="h3" as="h2">AI workspace</Heading>
      <p className="mt-1 pb-3 text-xs text-ink-500">
        Draft from the facts on the left, steer the tone, then edit the copy by hand.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => onGenerate(vibe)} disabled={busy || productId == null}>
          {generating ? "Writing..." : drafted ? "Generate again" : "Generate draft"}
        </Button>
        {productId == null && (
          <span className="text-xs text-ink-500">No product linked to this unit - nothing to draft about.</span>
        )}
      </div>

      <div className="mt-4">
        <p className={kickerClass}>Vibe</p>
        <p className="mt-1 text-xs text-ink-500">
          Each vibe asks for a fresh draft written in that voice. It re-generates; it does not
          re-word what is on screen.
        </p>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Draft vibe">
          {VIBES.map((v) => {
            const active = vibe === v;
            return (
              <button
                key={v}
                type="button"
                aria-pressed={active}
                disabled={busy || productId == null}
                onClick={() => onGenerate(v)}
                className={
                  "min-h-[36px] rounded-control px-3 text-sm font-semibold transition duration-fast " +
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 " +
                  "disabled:opacity-50 disabled:pointer-events-none " +
                  (active
                    ? "bg-brand-700 text-white hover:bg-brand-800"
                    : "bg-surface text-brand-300 ring-1 ring-line hover:bg-brand-50")
                }
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-5 space-y-4 border-t border-line pt-4">
        <div>
          <label htmlFor="studio-title" className={kickerClass}>Title</label>
          <Input
            id="studio-title"
            className="mt-1"
            value={title}
            maxLength={140}
            placeholder="The listing title the storefront will show"
            onChange={(e) => onTitle(e.target.value)}
          />
          <p className="mt-1 text-xs text-ink-500">{title.length}/140 characters.</p>
        </div>

        <div>
          <label htmlFor="studio-description" className={kickerClass}>Description</label>
          <textarea
            id="studio-description"
            className={TEXTAREA + " mt-1 min-h-[10rem] resize-y"}
            value={description}
            maxLength={4000}
            placeholder="The product description the storefront will show"
            onChange={(e) => onDescription(e.target.value)}
          />
          <p className="mt-1 text-xs text-ink-500">{description.length}/4000 characters.</p>
        </div>
      </div>

      <div className="mt-4">
        <p className={kickerClass}>Keywords - suggested, not published</p>
        <p className="mt-1 text-xs text-ink-500">
          The draft returned these; the publish press sends the title and the description only, and a
          product row has no keywords column, so they are a suggestion and nothing more.
        </p>
        <ul className="mt-2 flex flex-wrap gap-1">
          {keywords.map((k, i) => (
            <li key={i}><Badge colorClass="bg-surface-sunken text-ink-600">{k}</Badge></li>
          ))}
        </ul>
        {drafted && keywords.length === 0 && (
          <p className="mt-2 text-xs text-ink-500">None came back with this draft.</p>
        )}
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <Button onClick={onPublish} disabled={busy || title.trim() === "" || description.trim() === ""}>
          {publishing ? "Publishing..." : "Publish to Storefront"}
        </Button>
        <p className="mt-2 text-xs text-ink-500">
          Writes straight away, with no confirmation press. It replaces the product's title and
          description - the values it displaces are kept in the audit record - and walks this unit to
          <span className="font-mono"> listed</span> so it appears on the storefront.
        </p>
      </div>

      {messages.length > 0 && (
        <ul className="mt-4 space-y-1 border-t border-line pt-3">
          {messages.map((m, i) => (
            <li key={i} className="text-sm text-ink-600">{m}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
