import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "./cn";

/* Table, THead/TBody, TR/TH/TD. Admin-only: the storefront has no data tables.

   Two things this owns so no page re-derives them:
   - a horizontal-scroll wrapper, because the workbench tables carry five columns and the
     newsletter table has an unbounded email column, so a narrow viewport must scroll rather
     than squash the cells;
   - `border-t border-line` on every row, replacing the mix of `border-t`, `border-t
     border-slate-100` and `border-t border-slate-200` the pages had.
   `THead` paints the header row with the eyebrow kicker (text-eyebrow). Cells take standard
   <th>/<td>/<tr> props, so colSpan and onClick pass straight through. */
type Props = { children: ReactNode; className?: string };

export default function Table({ children, className }: Props) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)}>{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="text-left text-eyebrow uppercase text-ink-400">{children}</tr>
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
     verified in the emitted CSS). The pages already asked for left headers with `text-left` on
     the row; this is where that intent actually lands. */
  return <th className={cn("px-3 py-2 text-left font-medium", className)} {...rest} />;
}

export function TD({ className, ...rest }: ComponentPropsWithoutRef<"td">) {
  return <td className={cn("px-3 py-2 align-middle", className)} {...rest} />;
}
