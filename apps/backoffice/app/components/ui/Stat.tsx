import type { ReactNode } from "react";
import { cn } from "./cn";
import { kickerClass } from "@/lib/ui";

/* Admin-only stat tile for the dashboard: label / value / optional sub-line. The label uses the
   shared kicker (lib/ui.ts), so the tile needs no typography of its own - and the kicker has one
   definition rather than being spelled here. */
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
      <p className={kickerClass}>{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-ink-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-500">{sub}</p>}
    </div>
  );
}
