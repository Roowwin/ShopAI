import { cn } from "@/app/components/ui";

/* The attention feed: what is waiting on a human, as a timeline down the left of the card.

   Nothing is invented here. Every row is one entry of the array the page builds from the same
   overview payload (pricing_pending, stuck_assets, lots_stuck), the counts are the payload's
   counts, and the row's own link is the array's href. An EMPTY array says so in words rather than
   rendering an empty rail. Read-only by construction, like every card on this page: each row links
   out to the workbench that owns the fix.

   `severity` is the page's judgement, not a payload field - the payload ranks nothing - so it
   lives in the array literal where it can be read against its own count, and it only applies when
   the count is above zero: a cleared row is "clear", never a coloured danger row reading 0.
   Critical is "the storefront path is blocked" (graded units that cannot be listed because they
   carry no price); warning is work ageing without blocking anything, which is what makes it
   warning and not critical.

   THE URGENCY BADGE. Each row names its own severity in a pill, so the judgement is legible
   without working out what a coloured dot meant - and the dot's tint and the count's tone are
   still there for the reader who has learned them. The badge words are the plain-English form of
   the two levels above ("Blocking" / "Ageing"), which is the same distinction the counts draw.

   `urgent` is the page's second judgement and a narrower one: work that is not merely waiting but
   OLD - a lot that has sat for a fortnight. Those rows carry a pulsing amber halo. It is a halo
   and not a pulsing badge, deliberately: `animate-pulse` on the badge itself fades the badge's own
   text, and a label that blinks is a label that cannot be read. The halo sits behind the pill, is
   amber (the warning token, never the red one - a red pulse on ageing work would claim a severity
   this row does not have), and stops for anyone who has asked for no motion.

   Colour is still the reinforcement, not the message: each row carries its count, its label, its
   badge and a detail line, so the timeline reads with every tint removed. Each severity used to
   carry its own halo as well (`shadow-glow-danger` / `shadow-glow-warning` - a separate pair,
   because the brand's green halo on a red row would have contradicted the row's own state); the
   Quiet Luxury pass deleted those and every other glow in the app. The one halo that came back is
   `shadow-urgency`, and it is on the AGEING rows of this feed only. */

export type FeedItem = {
  label: string;
  count: number;
  href: string;
  detail?: string;
  severity: "critical" | "warning";
  /** Work that is old as well as outstanding - draws the pulsing amber halo. Only ever meaning
      something when `count > 0`; a cleared row is never urgent. */
  urgent?: boolean;
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

const BADGE: Record<RowState, string> = {
  critical: "bg-danger-600/15 text-danger-600 ring-1 ring-danger-600/30",
  warning: "bg-accent-400/15 text-accent-700 ring-1 ring-accent-400/30",
  clear: "bg-surface-sunken text-ink-400 ring-1 ring-line",
};

const BADGE_TEXT: Record<RowState, string> = {
  critical: "Blocking",
  warning: "Ageing",
  clear: "Clear",
};

export default function AttentionFeed({ items }: { items: FeedItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-ink-500">No alerts: nothing is waiting on a human right now.</p>;
  }
  return (
    <ol className="relative">
      {items.map((item, i) => {
        const state: RowState = item.count === 0 ? "clear" : item.severity;
        const urgent = item.count > 0 && item.urgent === true;
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
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm text-ink-900">{item.label}</span>
                  <span className="relative inline-flex shrink-0">
                    {urgent && (
                      <span aria-hidden="true"
                            className="absolute inset-0 animate-pulse rounded-full shadow-urgency motion-reduce:animate-none" />
                    )}
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", BADGE[state])}>
                      {BADGE_TEXT[state]}
                    </span>
                  </span>
                </span>
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
