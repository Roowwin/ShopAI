import { cn } from "@/app/components/ui";

/* The attention feed: the page's `alerts` array as a vertical timeline.

   Nothing is invented here. Every row is one entry of the array the page builds from the same
   overview payload (pricing_pending, stuck_assets, lots_stuck), the counts are the payload's
   counts, and the row's own link is the array's href. An EMPTY array says so in words rather than
   rendering an empty rail.

   `severity` is the page's judgement, not a payload field - the payload ranks nothing - so it
   lives in the array literal where it can be read against its own count, and it only applies when
   the count is above zero: a cleared row is "clear", never a coloured danger row reading 0.
   Critical is "the storefront path is blocked" (graded units that cannot be listed because they
   carry no price); warning is work ageing without blocking anything, which is what makes it
   warning and not critical.

   Colour is the reinforcement, not the message: each row carries its count, its label and a
   detail line, and the severity is also in that copy - so the timeline still reads with the tints
   removed. The tints themselves are `danger-600` and `accent-400` (the tokens the brief names),
   with a restrained halo from `-danger` / `-warning`; the emerald
   `` would have been the wrong hue on either, which is why those two exist.

   The rail is one hairline per row, not one per timeline: a single absolutely positioned line
   across the whole list cannot know where the last node sits once rows differ in height, and the
   per-row line reaches exactly the next node's centre at any row height. */

export type FeedItem = {
  label: string;
  count: number;
  href: string;
  detail?: string;
  severity: "critical" | "warning";
};

type RowState = "critical" | "warning" | "clear";

const DOT: Record<RowState, string> = {
  critical: "bg-danger-600",
  warning: "bg-accent-400",
  clear: "bg-transparent ring-1 ring-line-strong",
};

const COUNT_TONE: Record<RowState, string> = {
  critical: "text-danger-600",
  warning: "text-accent-700",
  clear: "text-ink-400",
};

export default function AttentionFeed({ items }: { items: FeedItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-ink-500">No alerts: nothing is waiting on a human right now.</p>;
  }
  return (
    <ol className="relative">
      {items.map((item, i) => {
        const state: RowState = item.count === 0 ? "clear" : item.severity;
        return (
          <li key={item.label} className="relative">
            {/* node centre x = 5px; the rail is drawn from this node's centre down to the next
                node's centre, which is 24px below the top of the following row whatever that
                row's height. */}
            {i < items.length - 1 && (
              <span aria-hidden="true" className="absolute -bottom-6 left-[4.5px] top-6 w-px bg-line" />
            )}
            <span aria-hidden="true"
                  className={cn("absolute left-0 top-[19px] h-2.5 w-2.5 rounded-full", DOT[state])} />
            <a href={item.href}
               className="flex items-start gap-3 rounded-control -mx-1 py-2.5 pl-6 pr-3 transition hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 motion-reduce:transition-none">
              <span className={cn("w-7 shrink-0 text-lg font-semibold tabular-nums", COUNT_TONE[state])}>
                {item.count}
              </span>
              <span className="min-w-0">
                <span className="block text-sm text-ink-900">{item.label}</span>
                {item.detail && <span className="mt-0.5 block text-xs text-ink-500">{item.detail}</span>}
              </span>
              <span className="ml-auto shrink-0 self-center text-xs text-ink-500">Open &rarr;</span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}
