import type { ReactNode } from "react";
import { cn } from "@/app/components/ui";
import { kickerClass } from "@/lib/ui";

/* The KPI tile: the dashboard's headline number, on the glass treatment (`bg-surface-glass/80`
   over `backdrop-blur-md`) with a neutral hairline. On a dark ground the elevation cue is not
   there, so the card's edge is drawn in light rather than cast in darkness.

   TWO SIZES, ONE COMPONENT. The executive layout gives Revenue a hero card and the other three
   figures supporting cards, so `size` picks the padding and the value's step and nothing else: the
   label, the sub-line, the detail line and the trend slot are the same in both, because they are
   the same information and a second component would let the two drift. The size only changes how
   loudly the same fact is said.

   The hairline is `ring-brand-500/60`. brand-500 WAS the brand's saturated green and the comment
   here used to say "emerald"; the Quiet Luxury pass repointed it to slate-400, because the brand is
   allowed on the primary action and nowhere else. A light neutral hairline measures 3.33:1
   composited over this page, which clears the 3:1 non-text bar - the figures this file carried for
   the old green still happen to hold, so nothing else about the edge changed.

   Deliberately NOT a change to ui/Stat, which is otherwise the same label/value/sub shape: Stat is
   on six other ops pages (assets, audit, customers, orders, their detail pages), and it carries no
   slot for a trend. Rather than adding a variant that only one page uses to a shared primitive -
   and changing the surface of every page that already renders it - the tile is its own component
   in the shared dashboard set, so /admin's pulse row and this page cannot drift apart.

   `detail` is the second provenance line the Stock value card needed: the brief's stock figure is
   the at-list one, and the at-cost figure is still a payload number, so it needs a line of its own
   rather than being folded into `sub` or dropped.

   `children` is the trend slot under the sub-line; a tile that has none renders exactly as tall as
   its content, and the grid stretches the row's tiles to match. The ground under the glass is the
   page (`bg-surface-sunken`, painted by app/layout.tsx), so the tile's effective fill is the glass
   at 80% over that page - which is what the contrast figures above were computed against, not the
   raw token. */

const SIZES: Record<"default" | "hero", { pad: string; value: string }> = {
  default: { pad: "p-4", value: "text-2xl" },
  hero: { pad: "p-6", value: "text-4xl" },
};

export default function KpiTile({ label, value, sub, detail, children, className, size = "default" }: {
  label: string;
  value: ReactNode;
  sub?: string;
  detail?: ReactNode;
  children?: ReactNode;
  className?: string;
  size?: "default" | "hero";
}) {
  const s = SIZES[size];
  return (
    <div className={cn(
      "rounded-card bg-surface-glass/80 ring-1 ring-brand-500/60 backdrop-blur-md",
      s.pad,
      className,
    )}>
      <p className={kickerClass}>{label}</p>
      <p className={cn("mt-1 font-semibold tracking-tight text-ink-900 tabular-nums", s.value)}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-500">{sub}</p>}
      {detail && <p className="mt-0.5 text-xs text-ink-500">{detail}</p>}
      {children}
    </div>
  );
}
