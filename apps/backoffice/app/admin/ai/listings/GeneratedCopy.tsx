"use client";

import { Badge, Button, Heading } from "@/app/components/ui";
import { kickerClass } from "@/lib/ui";
import type { CatalogItem } from "./ProductContext";

/* The right column of the listing studio: the copy the model returned, and the one control that
   publishes it.

   THE PANEL IS READ-ONLY. The publish press sends the draft's own title and description - the two
   values the old card sent - so nothing here is editable. An editable field would change what the
   write carries, which would be a re-wire rather than a restyle.

   WHICH PRODUCT THE COPY BELONGS TO, AND WHICH ONE THE PRESS WRITES TO, are two different things
   on this page, and the column says so. The picker on the left stays usable while a draft is in
   flight and after one lands, so the selection can move after the press that produced this copy.
   The top line names the product the shown draft was GENERATED FOR (captured at that press, not
   read from the picker now), and the foot says that the publish press writes to whichever product
   the picker shows at the moment it is pressed. Both are the handler's own two facts: the draft
   body carries the id chosen at draft time, and the publish address is built from the id chosen at
   publish time. Naming both is what keeps a split view from implying the pair is always one
   record; a reader who moves the picker is told what that does.

   KEYWORDS ARE SHOWN AS A SUGGESTION AND LABELLED AS ONE. The draft returns them; the publish
   press sends the title and the description only, because a product row has no keywords column to
   write. Showing them bare would imply they publish with the copy.

   WHAT THE PRESS DOES is said before it, not after: it replaces the product's current title and
   description, the replaced values are kept in the audit record, and the control carries no
   confirmation press of its own - which is how this page has always behaved, and is left as it is. */

export type Draft = { title: string; description: string; keywords: string[] };

export default function GeneratedCopy({ draft, draftFor, busy, onSave }: {
  draft: Draft | null;
  /** the product the shown draft was generated for, captured when that press was made */
  draftFor: CatalogItem | null;
  /** the page's existing in-flight flag, unchanged */
  busy: boolean;
  /** the page's own publish handler - this column only hands the press on */
  onSave: () => void;
}) {
  return (
    <section>
      <Heading level="h3" as="h2">Generated copy</Heading>

      {draft ? (
        <>
          <p className="mt-1 pb-3 text-xs text-ink-500">
            {draftFor
              ? "Generated for " + draftFor.title + " (product " + draftFor.id + ")."
              : "Generated for the product that was chosen when the draft was asked for."}
          </p>

          <div className="space-y-2 rounded-control bg-surface-muted p-4">
            <p className="text-sm font-semibold text-ink-900">{draft.title}</p>
            <p className="whitespace-pre-line text-sm text-ink-700">{draft.description}</p>
          </div>

          <div className="mt-4">
            <p className={kickerClass}>Keywords - suggested, not published</p>
            <p className="mt-1 text-xs text-ink-500">
              The draft returned these; the publish press sends the title and the description only,
              and a product row has no keywords column, so they are a suggestion and nothing more.
            </p>
            <ul className="mt-2 flex flex-wrap gap-1">
              {(draft.keywords ?? []).map((k, i) => (
                <li key={i}><Badge colorClass="bg-surface-sunken text-ink-600">{k}</Badge></li>
              ))}
            </ul>
            {(draft.keywords ?? []).length === 0 && (
              <p className="mt-2 text-xs text-ink-500">
                None came back with this draft.
              </p>
            )}
          </div>

          <div className="mt-4 border-t border-line pt-3">
            <Button onClick={onSave} disabled={busy}>Approve &amp; publish</Button>
            <p className="mt-2 text-xs text-ink-500">
              Writes straight away - no confirmation press, the way this page has always worked. It
              replaces the title and description of whichever product the picker shows at the
              moment you press, which is not necessarily the product this copy was written for.
              The values it replaces are kept in the audit record.
            </p>
          </div>
        </>
      ) : busy ? (
        <p className="mt-3 rounded-control bg-surface-sunken px-3 py-2 text-sm text-ink-400 ring-1 ring-line">
          A draft is being written now - the answer appears here when the call comes back.
        </p>
      ) : (
        <p className="mt-3 rounded-control bg-surface-sunken px-3 py-2 text-sm text-ink-400 ring-1 ring-line">
          No draft yet - choose a product on the left and press Generate draft.
        </p>
      )}
    </section>
  );
}
