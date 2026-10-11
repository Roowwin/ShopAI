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
   needs no translation table. */
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

/* The native <select> control. The design system deliberately has no Select primitive (the
   storefront ships none, and Input is an <input>), so without this every page retypes the same
   ~110-char string - which is the exact copy-paste the rest of this job removes. Metrics match
   Input, so a select and an input on the same row line up. Plain literal, same glob rule. */
export const selectClass =
  "rounded-control ring-1 ring-line bg-surface px-4 py-2.5 text-sm text-ink-900 outline-none transition focus:ring-2 focus:ring-brand-500";

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
