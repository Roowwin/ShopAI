import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "./cn";
import { kickerClass } from "@/lib/ui";

/* Table, THead/TBody, TR/TH/TD. Admin-only: the storefront has no data tables.

   What this owns so no page re-derives it:
   - a horizontal-scroll wrapper, because the workbench tables carry five columns and the
     newsletter table has an unbounded email column, so a narrow viewport must scroll rather
     than squash the cells. It is keyboard-reachable (tabIndex + role=region + the required
     `label`): a scroll box a keyboard user cannot focus is a scroll box they cannot read;
   - `py-1 -my-1` on that wrapper. `overflow-x-auto` makes overflow-y compute to `auto`, not
     `visible`, so a descendant focus ring - Button's `ring-2` plus `ring-offset-2` is 4px -
     would be clipped at the first and last row. The padding gives the ring room and the
     negative margin keeps the layout exactly where it was;
   - `border-t border-line` on every row, replacing the three different row-border treatments the
     pages had (the line token, two raw slate values, and one table with no border at all).
     NOTE: utility names are written as prose in these comments, never as class syntax - Tailwind
     scans source TEXT, not code, so spelling a class in a comment emits a real rule into the
     built CSS (that is how a stray 44px min-height and two raw slate border colours got in
     during round 1).
   `THead` paints the header row with the shared kicker (lib/ui.ts). Cells take standard
   <th>/<td>/<tr> props, so colSpan and onClick pass straight through. */
type Props = {
  children: ReactNode;
  className?: string;
  /** Names the table for screen readers; rendered as the aria-label of the scroll region. */
  label: string;
};

export default function Table({ children, className, label }: Props) {
  return (
    <div
      className="w-full overflow-x-auto py-1 -my-1 rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      tabIndex={0}
      role="region"
      aria-label={label}
    >
      <table className={cn("w-full border-collapse text-sm", className)}>{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className={kickerClass}>{children}</tr>
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TR({ className, ...rest }: ComponentPropsWithoutRef<"tr">) {
  return <tr className={cn("border-t border-line", className)} {...rest} />;
}

export function TH({ className, ...rest }: ComponentPropsWithoutRef<"th">) {
  /* `text-left` sits on the CELL, not just the row: the UA stylesheet centres `th`, and a
     text-align inherited from the <tr> cannot beat it (Tailwind's preflight does not reset it -
     verified in the emitted CSS, which has no `th` selector at all). The pages already asked for
     left headers with `text-left` on the row; this is where that intent actually lands.
     `scope="col"` because every call site is a column header - a caller can still override it
     through ...rest. */
  return <th scope="col" className={cn("px-3 py-2 text-left font-medium", className)} {...rest} />;
}

export function TD({ className, ...rest }: ComponentPropsWithoutRef<"td">) {
  return <td className={cn("px-3 py-2 align-middle", className)} {...rest} />;
}
