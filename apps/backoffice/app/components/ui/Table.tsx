import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "./cn";
import { kickerClass } from "@/lib/ui";

/* Table, THead/TBody, TR/TH/TD. Admin-only: the storefront has no data grids.

   What this owns so no page re-derives it:
   - a horizontal-scroll wrapper, because the workbench grids carry five columns and the
     newsletter grid has an unbounded email column, so a narrow viewport must scroll rather
     than squash the cells. It is keyboard-reachable (tabIndex + role=region + the required
     `label`): a scroll box a keyboard user cannot focus is a scroll box they cannot read;
   - `py-1 -my-1` on that wrapper. Giving one axis a non-default overflow makes the other axis
     overflow too, so a focused control in the first or last row would have its focus highlight
     clipped. The padding gives that highlight room, and the negative margin keeps the layout
     exactly where it was;
   - `border-t border-line` on every row, replacing the three different row-border treatments the
     pages had (the line token, two raw slate values, and one with none at all).
   `THead` paints the header row with the shared kicker (lib/ui.ts). Cells take standard
   <th>/<td>/<tr> props, so colSpan and onClick pass straight through.

   NOTE on these comments: Tailwind scans source TEXT, not code, so a bare utility word written
   in prose emits a real rule into the built CSS. These comments therefore describe things
   ("focus highlight", "grids", "Table") instead of naming utilities. Round 1 shipped a stray
   44px minimum height and two raw slate values that way. */
type Props = {
  children: ReactNode;
  className?: string;
  /** Names the Table for screen readers; rendered as the aria-label of the scroll region. */
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
