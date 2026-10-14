import { cn } from "@/app/components/ui";
import { kickerClass } from "@/lib/ui";

/* The lifecycle pipeline: Received -> Tested -> Graded -> Listed, as four connected nodes.

   J2 wrote this beside /admin/dashboard; J7's /admin draws the same map from the same endpoint, so
   the file moved into the shared dashboard set and `lifecycleStages` - the mapping from the
   payload's two backlog fields onto the four nodes - moved with it. Both pages call that one
   function: a second copy of this mapping in a second page is how two maps of one lifecycle start
   disagreeing about which node owns a backlog.

   Every number is the payload's own. `count` is `inventory.by_status[key]` - the same zero-filled
   lifecycle the donut beside it draws - and a `backlog` is only ever set where the payload
   attributes work TO A SINGLE STAGE:
     - Received: lots_stuck (lots in intake past 14 days, never activated)
     - Graded:   pricing_pending (graded units with no price)
   Tested and Listed carry no backlog here on purpose. The payload's `stuck_assets.count` spans
   received AND tested together ("still in received/tested"), and nothing in it flags listed
   stock, so neither number can be attributed to one node without inventing the split. The page
   prints that shared figure under the map instead of hiding it or halving it.

   A count that is absent from the payload renders as "not reported by the API", never as 0: the
   API zero-fills `by_status`, so a missing key means the contract changed, and a zero drawn there
   would be a claim the payload never made.

   State is never carried by colour alone. The dot's tint is reinforced by a line of text
   ("holding stock" / "12 unpriced, cannot be listed" / "no units"), which is also what a
   colour-blind reader and a screen reader get.

   The one element here that sits under its contrast bar is the CONNECTOR hairline, drawn from
   `--line-strong` (1.81:1 on a card). That is the app's own recorded exception - globals.css
   exempts both line tokens by name - and it is decoration: the order is carried by the ordered
   list and the stage labels, not by the arrow. Everything a reader must act on clears its bar,
   including the node edges (see NODE_RING). */

export type PipelineStage = {
  /** the lifecycle key, which is also the status token suffix: received | tested | graded | listed */
  key: string;
  label: string;
  /** units the payload reports in this stage, or null when the payload does not report it */
  count: number | null;
  /** work in THIS stage the payload attributes to this stage alone */
  backlog?: { count: number; label: string };
};

type NodeState = "backlog" | "stock" | "empty" | "missing";

function stateOf(stage: PipelineStage): NodeState {
  if (stage.count === null) { return "missing"; }
  if ((stage.backlog?.count ?? 0) > 0) { return "backlog"; }
  return stage.count > 0 ? "stock" : "empty";
}

/* stock reads emerald (the `listed` solid + the emerald glow J1 already ships); a backlog reads
   as the amber warning. Empty and unknown are hollow rings - no fill at all, and never an
   `ink-*` value, because ink is a TEXT scale and a fill made of it is the defect that put a
   near-white banner under white text in J1. */
const DOT: Record<NodeState, string> = {
  backlog: "bg-accent-400",
  stock: "bg-status-listed-solid",
  empty: "bg-transparent ring-1 ring-line-strong",
  missing: "bg-transparent ring-1 ring-line",
};

/* The node's own edge, in the state's colour. Held at 60% (emerald) / 50% (amber) rather than the
   fainter 40% so the edge itself clears 3:1 - measured 3.30:1 and 3.51:1 against the card it is
   drawn on, and 3.60:1 / 3.83:1 against the node fill it borders, which is the pair that matters
   when a 1px ring sits between two grounds. The dark emerald tone cannot do this at any usable
   alpha: being dark it reaches only 3.26:1 at full strength - the class for it is deliberately
   not spelled out here, because Tailwind scans comments and would emit the rule for it. */
const NODE_RING: Record<NodeState, string> = {
  backlog: "ring-accent-400/50",
  stock: "ring-brand-500/60",
  empty: "ring-line",
  missing: "ring-line",
};

function stateText(stage: PipelineStage, state: NodeState): { text: string; tone: string } {
  switch (state) {
    case "missing":
      return { text: "not reported by the API", tone: "text-ink-400" };
    case "backlog":
      return {
        text: `${stage.backlog!.count.toLocaleString("en-AU")} ${stage.backlog!.label}`,
        tone: "text-accent-700",
      };
    case "stock":
      return { text: "holding stock", tone: "text-ink-500" };
    case "empty":
      return { text: "no units", tone: "text-ink-400" };
  }
}

/* The connector is one hairline arrow. It is drawn from `--line-strong` rather than given a
   colour of its own - it says "next stage", not "healthy" or "late", and a state colour here
   would be read as a fifth verdict. Hidden below sm: when the four nodes wrap, an arrow at the
   head of a wrapped row would point at the node above it. */
function Connector() {
  return (
    <svg viewBox="0 0 14 8" aria-hidden="true" className="hidden h-2 w-3.5 shrink-0 sm:block">
      <path d="M0 4h10M7.5 1l3 3-3 3" fill="none" stroke="rgb(var(--line-strong))" strokeWidth="1.5" />
    </svg>
  );
}

/* The four stages, built from the payload's own counts. `count` comes from `inventory.by_status`
   (the same zero-filled map the donut draws, so the two can never disagree); a key the payload
   omits renders as "not reported by the API" rather than 0. A `backlog` is set only where the
   payload attributes work to ONE stage - Received takes `lots_stuck`, Graded takes
   `pricing_pending` - because `stuck_assets` spans Received AND Tested together and nothing in the
   payload flags listed stock. */
export type StageBacklogs = {
  /** lots in intake past 14 days, never activated */
  lotsStuck: number;
  /** graded units carrying no price */
  pricingPending: number;
};

export function lifecycleStages(byStatus: Record<string, number>, backlogs: StageBacklogs): PipelineStage[] {
  const count = (key: string): number | null => {
    const n = byStatus[key];
    return typeof n === "number" ? n : null;
  };
  return [
    { key: "received", label: "Received", count: count("received"),
      backlog: backlogs.lotsStuck > 0
        ? { count: backlogs.lotsStuck, label: "lots awaiting activation" } : undefined },
    { key: "tested", label: "Tested", count: count("tested") },
    { key: "graded", label: "Graded", count: count("graded"),
      backlog: backlogs.pricingPending > 0
        ? { count: backlogs.pricingPending, label: "unpriced, cannot be listed" } : undefined },
    { key: "listed", label: "Listed", count: count("listed") },
  ];
}

/* The one thing the map cannot say per node, in one place so both pages say it the same way. */
export function stuckNote(stuckCount: number): string {
  return "A stage counts the units currently in it, from the same inventory.by_status the donut " +
    "draws. " +
    (stuckCount > 0
      ? `${stuckCount} units have sat in Received or Tested for over 7 days - the API reports ` +
        "those two stages together, so the count is not attributed to either node."
      : "No unit has sat in Received or Tested for over 7 days.");
}

export default function PipelineMap({ stages, note }: { stages: PipelineStage[]; note?: string }) {
  return (
    <div>
      <ol className="flex flex-wrap items-stretch gap-x-2 gap-y-3">
        {stages.map((stage, i) => {
          const state = stateOf(stage);
          const text = stateText(stage, state);
          return (
            <li key={stage.key} className="flex min-w-[9.5rem] flex-1 items-center gap-2">
              {i > 0 && <Connector />}
              <div className={cn("min-w-0 flex-1 rounded-control bg-surface-muted px-3 py-2.5 ring-1", NODE_RING[state])}>
                <div className="flex items-center gap-1.5">
                  <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", DOT[state])} />
                  <p className={kickerClass}>{stage.label}</p>
                </div>
                <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-ink-900">
                  {stage.count === null ? "-" : stage.count.toLocaleString("en-AU")}
                </p>
                <p className={cn("mt-0.5 text-xs", text.tone)}>{text.text}</p>
              </div>
            </li>
          );
        })}
      </ol>
      {note && <p className="mt-3 text-xs text-ink-500">{note}</p>}
    </div>
  );
}
