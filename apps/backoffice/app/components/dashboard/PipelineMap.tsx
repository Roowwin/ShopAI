import { cn } from "@/app/components/ui";
import { kickerClass } from "@/lib/ui";

/* The lifecycle pipeline: Received -> Tested -> Graded -> Listed, as a LINEAR PROCESS FLOW.

   J2 wrote this beside /admin/dashboard; J7's /admin draws the same map from the same endpoint, so
   the file moved into the shared dashboard set and `lifecycleStages` - the mapping from the
   payload's two backlog fields onto the four nodes - moved with it. Both pages call that one
   function: a second copy of this mapping in a second page is how two maps of one lifecycle start
   disagreeing about which node owns a backlog.

   WHAT THE EXECUTIVE PASS CHANGED, AND WHAT IT DID NOT. The four stages used to be four boxed
   nodes - a fill, a ring and a rounded rectangle each - laid side by side with an arrow between
   them. That read as four facts that happen to be adjacent. They are one PROCESS, so they are drawn
   as one now: a single thin rail running through all four markers, with the stage sitting under its
   own point on it, which is what makes "Received, then Tested, then Graded, then Listed" visible
   without a sentence saying so.

   The rail is the ONE thing on this page carrying `shadow-flow`. It is drawn in light rather than
   as a shadow, because a grey shadow is invisible against slate; the markers themselves keep the
   flat state tints they always had. The rail is decoration - the order is carried by the ordered
   list and by the stage labels sitting left to right - which is why it is allowed below the 3:1
   non-text bar that globals.css exempts the line tokens from by name.

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

   State is never carried by colour alone, and with the boxes gone that matters more than it did:
   the marker's tint is reinforced by the line of text under each stage ("holding stock" / "12
   unpriced, cannot be listed" / "no units"), which is also what a colour-blind reader and a screen
   reader get. */

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

/* stock reads the listed status green; a backlog reads as the amber warning. Empty and unknown are
   hollow rings - no fill at all, and never an `ink-*` value, because ink is a TEXT scale and a fill
   made of it is the defect that put a near-white banner under white text in J1. */
const DOT: Record<NodeState, string> = {
  backlog: "bg-accent-400",
  stock: "bg-status-listed-solid",
  empty: "bg-transparent ring-1 ring-line-strong",
  missing: "bg-transparent ring-1 ring-line",
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

/* THE CONNECTOR, one per stage except the last, drawn from this marker to the NEXT one.

   It is the per-row trick the attention rail uses, turned on its side: each connector knows only
   its own column, so it needs no measurement of the row and stays correct when a stage's text wraps
   to a different height in one column than another. Both the gap it bridges and the offset it
   starts at are fixed by THIS file (`gap-4` on the list, `left-[5px]` = the marker's own centre), so
   the rail meets each marker exactly instead of approximately.

   Vertical below sm, where the stages stack; horizontal from sm up, where they sit in one row.
   `bottom-auto` and `w-auto` are what cancel the mobile geometry at sm - without them the element
   would keep a fixed height and a 1px width and the horizontal rail would not draw at all. */
function Connector() {
  return (
    <span aria-hidden="true"
          className="absolute -bottom-4 left-[5px] h-4 w-px bg-line-strong shadow-flow sm:bottom-auto sm:-right-4 sm:left-[5px] sm:top-[5px] sm:h-px sm:w-auto" />
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
      {/* One row of four at sm and up, one column of four below it. `gap-4` is load-bearing: the
          Connector's `-right-4` / `-bottom-4` and its 1rem length are written against exactly this
          gap, so changing it here without changing the connector leaves the rail short of the next
          marker. */}
      <ol className="grid gap-4 sm:grid-cols-4">
        {stages.map((stage, i) => {
          const state = stateOf(stage);
          const text = stateText(stage, state);
          return (
            <li key={stage.key} className="relative min-w-0 pl-6 sm:pl-0 sm:pt-6">
              {i < stages.length - 1 && <Connector />}
              {/* The marker, at the rail's own offset: 5px from the left below sm (the vertical
                  rail's x), 5px from the top at sm and up (the horizontal rail's y). */}
              <span aria-hidden="true"
                    className={cn("absolute left-0 top-1 h-2.5 w-2.5 rounded-full sm:top-0", DOT[state])} />
              <p className={kickerClass}>{stage.label}</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-ink-900">
                {stage.count === null ? "-" : stage.count.toLocaleString("en-AU")}
              </p>
              <p className={cn("mt-0.5 text-xs", text.tone)}>{text.text}</p>
            </li>
          );
        })}
      </ol>
      {note && <p className="mt-4 text-xs text-ink-500">{note}</p>}
    </div>
  );
}
