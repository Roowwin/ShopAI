import type { ReactNode } from "react";
import { cn } from "@/app/components/ui";
import { kickerClass } from "@/lib/ui";

/* The KPI tile: the dashboard's headline number on the glass treatment - a translucent panel
   (`bg-surface-glass/80`, the same step the chrome uses) over `backdrop-blur-md`, an emerald
   hairline, and `` instead of a light-mode box-shadow. On a dark ground the
   elevation cue is not there, so the card's edge has to be drawn in light rather than cast in
   darkness; that is what the two glow tokens are for, and it is why no light-mode elevation
   utility - not even as a word, since Tailwind scans comment text too and would emit a dead rule
   for it - is mentioned in this file.

   The hairline is emerald at 60% (`ring-brand-500/60`), not the `brand-700` the glow tokens use:
   composited over the page it measures 3.33:1, where the darker 700 tone reaches only 1.5:1 at
   this alpha and cannot clear 3:1 at any usable one. The glow behind it stays ``,
   whose own 1px ring and bloom are decoration - the boundary the eye reads is this one.

   Deliberately NOT a change to ui/Stat, which is otherwise the same label/value/sub shape: Stat
   is on six other ops pages (assets, audit, customers, orders, their detail pages), and it carries
   no slot for a trend. Rather than adding a variant that only one page uses to a shared primitive
   - and changing the surface of every page that already renders it - the glass card is its own
   component. J2 wrote it beside /admin/dashboard, the only page that rendered it; J7's pulse row
   made it a two-page widget, so the file moved here into the shared dashboard set rather than
   being copied - a second glass tile would have been the drift this set exists to prevent.

   `detail` is the second provenance line J7's Stock value card needed: the brief's stock figure is
   the at-list one, and the at-cost figure the page showed before it is still a payload number, so
   it needs a line of its own rather than being folded into `sub` or dropped.

   `children` is the trend slot under the sub-line; a tile that has none renders exactly as tall as
   its content, and the grid stretches the row's tiles to match. The ground under the glass is the
   page (`bg-surface-sunken`, painted by app/layout.tsx), so the tile's effective fill is the
   glass at 80% over that page - which is what the contrast figures for this card were computed
   against, not the raw token. */

export default function KpiTile({ label, value, sub, detail, children, className }: {
  label: string;
  value: ReactNode;
  sub?: string;
  detail?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(
      "rounded-card bg-surface-glass/80 p-4 ring-1 ring-brand-500/60 backdrop-blur-md",
      className,
    )}>
      <p className={kickerClass}>{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-ink-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-500">{sub}</p>}
      {detail && <p className="mt-0.5 text-xs text-ink-500">{detail}</p>}
      {children}
    </div>
  );
}
