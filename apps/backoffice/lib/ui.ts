/* Status and grade -> tone class strings, so no page re-derives a status colour inline.

   PLAIN LITERALS on purpose. Tailwind only emits classes it can see as text in a scanned file,
   so `bg-status-listed-soft` has to appear here verbatim - `"bg-status-" + s + "-soft"` would
   compile to nothing. That is also exactly why tailwind.config.ts widens `content` to ./lib:
   when the storefront's glob missed its lib dir, Grade D's badge background was missing from
   the built CSS entirely. Keep the two in step. */

export type AssetStatus =
  | "received"
  | "tested"
  | "in_repair"
  | "graded"
  | "listed"
  | "reserved"
  | "sold"
  | "shipped"
  | "returned"
  | "scrapped";

export type Grade = "A" | "B" | "C" | "D";

/* The status keys mirror the API's own strings, underscore and all, so `statusTone(a.status)`
   needs no translation map. */
const STATUS_TONE: Record<AssetStatus, string> = {
  received: "bg-status-received-soft text-status-received-ink",
  tested: "bg-status-tested-soft text-status-tested-ink",
  in_repair: "bg-status-in_repair-soft text-status-in_repair-ink",
  graded: "bg-status-graded-soft text-status-graded-ink",
  listed: "bg-status-listed-soft text-status-listed-ink",
  reserved: "bg-status-reserved-soft text-status-reserved-ink",
  sold: "bg-status-sold-soft text-status-sold-ink",
  shipped: "bg-status-shipped-soft text-status-shipped-ink",
  returned: "bg-status-returned-soft text-status-returned-ink",
  scrapped: "bg-status-scrapped-soft text-status-scrapped-ink",
};

const GRADE_TONE: Record<Grade, string> = {
  A: "bg-grade-a-soft text-grade-a-ink",
  B: "bg-grade-b-soft text-grade-b-ink",
  C: "bg-grade-c-soft text-grade-c-ink",
  D: "bg-grade-d-soft text-grade-d-ink",
};

const NEUTRAL = "bg-surface-sunken text-ink-600";

/* Unknown or absent values fall back to neutral rather than throwing: the API can return a
   lifecycle step the UI has not been taught yet, and a missing chip is not worth a 500. */
export function statusTone(status: string | null | undefined): string {
  if (!status) return NEUTRAL;
  return STATUS_TONE[status as AssetStatus] ?? NEUTRAL;
}

export function gradeTone(grade: string | null | undefined): string {
  if (!grade) return NEUTRAL;
  return GRADE_TONE[grade as Grade] ?? NEUTRAL;
}

/* The uppercase kicker - the SINGLE definition of the eyebrow, used by Table's header row and
   by Stat's label. It is a class and not the storefront's Eyebrow component because a Table
   header row is a `<tr>` and cannot contain the `<p>` that Eyebrow renders; see the note in
   app/components/ui/index.ts.

   `ink-500`, not the storefront Eyebrow's `ink-400`: at 11px, ink-400 on white is 2.56:1 and
   fails WCAG AA, while ink-500 is 4.76:1 and passes. That is a deliberate one-token divergence
   from the mirror, the same spirit as Button's 36px - do not read it as drift. */
export const kickerClass = "text-eyebrow uppercase text-ink-500";
