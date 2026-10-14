import { cn } from "@/app/components/ui";
import { kickerClass } from "@/lib/ui";

/* The action tiles: `needs_attention[]` as a grid of glowing tiles, each with a direct way in.

   This replaces the AttentionList that used to render the same array on /admin. The array is the
   same payload field it always was, in the API's own order, and nothing is invented: the label, the
   count and the item titles are the payload's, and the page hands each tile the one thing the
   payload does not carry - the route to the page that owns the count.

   A kind with no destination is NOT given a plausible-looking route. It renders as a tile that
   says so in words, because a link to a page that cannot act on the count spends a click and then
   lies; the report names each one and why.

   Severity is the page's judgement, not a payload field (the API ranks nothing), and it applies
   only above zero: a cleared tile goes calm rather than wearing a danger edge that reads 0 - the
   same rule the feed it replaced followed. It is never colour alone, the word is printed in the
   tile beside the count it judges.

   The edge is drawn at an alpha that clears 3:1 against the page it sits on (70% red, 50% amber);
   the paired glow token adds the bloom behind it. That bloom's own faint hairline is decoration,
   not the boundary - the boundary is that edge, and the state is also a word. */

export type ActionItem = { id: number; title: string };

export type ActionTile = {
  /** the payload's own kind, used as the key and as the tile's identity in the report */
  kind: string;
  /** the payload's own label */
  label: string;
  /** the payload's own count */
  count: number;
  /** the payload's own items, where the endpoint sends them (restock does) */
  items?: ActionItem[];
  /** the page's judgement of what this count costs, printed whether or not it is critical */
  consequence: string;
  /** the page's judgement, applied only when count > 0 */
  severity: "critical" | "warning";
  /** a route the page verified exists under app/admin/**, or absent when none owns this count */
  href?: string;
  /** one more payload figure that belongs with this count, labelled as what it is */
  detail?: string;
};

type TileState = "critical" | "warning" | "clear";

/* The edge is the boundary a reader acts on; the glow token is the bloom behind it. A cleared tile
   takes the app's own hairline and no bloom at all. */
const EDGE: Record<TileState, string> = {
  critical: "ring-danger-600/70",
  warning: "ring-accent-400/50",
  clear: "ring-line",
};

const COUNT_TONE: Record<TileState, string> = {
  critical: "text-danger-600",
  warning: "text-accent-700",
  clear: "text-ink-400",
};

const WORD: Record<TileState, string> = {
  critical: "critical",
  warning: "warning",
  clear: "clear",
};

export default function ActionTiles({ items }: { items: ActionTile[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-ink-500">Nothing is waiting on a human right now.</p>;
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map((t) => {
        const state: TileState = t.count === 0 ? "clear" : t.severity;
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span className={kickerClass}>{WORD[state]}</span>
              <span className={cn("text-2xl font-semibold tabular-nums tracking-tight", COUNT_TONE[state])}>
                {t.count}
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-900">{t.label}</p>
            <p className="mt-0.5 text-xs text-ink-500">{t.consequence}</p>
            {t.detail && <p className="mt-0.5 text-xs text-ink-500">{t.detail}</p>}
            {t.items && t.items.length > 0 && (
              <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-500">
                {t.items.map((p) => <li key={p.id}>{p.title}</li>)}
              </ul>
            )}
            {/* The last line is the tile's own verdict on whether it can be acted on from here, so
                a reader never has to guess which tiles are links. */}
            <p className="mt-auto pt-2 text-xs text-ink-500">
              {t.href ? <>Open &rarr;</> : "No page in this app owns this count yet."}
            </p>
          </>
        );
        const shape = cn("flex w-full flex-col rounded-card bg-surface p-4 ring-1", EDGE[state]);
        return (
          <li key={t.kind} className="flex">
            {t.href ? (
              <a href={t.href} aria-label={`${t.label}: ${t.count}`}
                 className={cn(shape, "transition hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-offset-2 motion-reduce:transition-none")}>
                {body}
              </a>
            ) : (
              <div className={shape}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
