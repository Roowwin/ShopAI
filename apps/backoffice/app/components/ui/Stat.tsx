import type { ReactNode } from "react";
import { cn } from "./cn";

/* Admin-only stat tile for the dashboard: label / value / optional sub-line. The label uses the
   eyebrow kicker, so the tile needs no per-page typography of its own. */
type Props = {
  label: string;
  value: ReactNode;
  /** one line under the value - a comparison, a unit, a caveat */
  sub?: string;
  className?: string;
};

export default function Stat({ label, value, sub, className }: Props) {
  return (
    <div className={cn("rounded-card bg-surface ring-1 ring-line p-4", className)}>
      <p className="text-eyebrow uppercase text-ink-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-ink-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-500">{sub}</p>}
    </div>
  );
}
