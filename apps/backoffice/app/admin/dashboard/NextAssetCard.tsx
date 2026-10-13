"use client";

import { useEffect, useState } from "react";

import { Button, Card, Heading } from "@/app/components/ui";
import { apiFetch } from "@/lib/api";
import { kickerClass } from "@/lib/ui";

/* THE PRIORITY QUEUE: the one unit to pick up next, as a door rather than a number.

   The dashboard is a wall of counts - "342 received", "pricing pending: 61" - and a count is not a
   next action. A grader arriving at the start of a shift has to choose a lot, open it, and hunt for
   a unit with no grade. This card makes that choice for them: the biggest lot that still has
   grading outstanding, and the unit that has been waiting longest inside it.

   WHICH LOT, AND WHICH UNIT.

   * The biggest lot we can see. `GET /staff/lots` returns lots newest first with an asset count,
     so the candidates are ranked by that count and opened in order. "Biggest" is by units, not by
     id: a lot of 200 is where a grader's hour goes, and the lot that happens to be newest is not.
   * The oldest unit in it that still has no grade. `GET /staff/lots/worklist?scope=unfinished`
     returns the queue in ascending unit id, which is oldest-first, so its first row IS the oldest
     waiting unit. Nothing is re-sorted here - the endpoint that owns "awaiting a grade" is the one
     that answers it, the same rule the workbench follows.
   * It walks down the ranking when the biggest lot is already finished, which is the normal case
     near the end of a lot: the largest fully-graded lot must not hide the work in the next one.
     The walk is bounded (PROBE lots) and stops at the first lot with a queue, so the usual cost is
     one request for the lots and one for the queue.

   WHY THIS IS A SECOND READ ON A PAGE THAT IS PROUD OF HAVING ONE. /admin/dashboard is one guarded
   surface and one round trip, and that is a property worth keeping - the KPIs are the page, and
   they must not wait on a search that walks lots. So this card is its own client component with
   its own fetch, mounted after the payload has already painted: it can be slow, it can fail, and
   it can render nothing without moving a single number above it. Its reads take the same roles the
   page does (admin/manager); a 403 is drawn as the quiet note below rather than as an error, since
   a viewer who cannot read it is a viewer who should not have been shown the page at all.

   The link carries the asset ID. The workbench resolves a numeric term as an asset id, which is
   unambiguous here, and the serial is printed beside it for the human - the ID is what the search
   box will accept. */

type LotRow = { id: number; lot_number: string; status: string; warehouse: string | null; asset_count: number };

type Queue = {
  lot: { id: number; lot_number: string; warehouse: string | null };
  progress: { total_units: number; graded_units: number; awaiting_grade_units: number };
  assets: { id: number; serial_number: string | null; product_model: string | null; product_title: string | null }[];
};

/* How many lots, ranked by size, are opened looking for grading work. A handful is enough to walk
   past the finished ones at the top of the ranking without turning a card into a sweep. */
const PROBE = 5;

type State =
  | { kind: "loading" }
  | { kind: "ready"; queue: Queue; next: Queue["assets"][number] }
  | { kind: "empty" }
  | { kind: "unavailable" };

export default function NextAssetCard() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let live = true;

    async function walk() {
      try {
        const r = await apiFetch("/staff/lots?limit=100");
        if (!r.ok) {
          if (live) setState({ kind: "unavailable" });
          return;
        }
        const lots: LotRow[] = await r.json().catch(() => []);
        if (!Array.isArray(lots)) {
          if (live) setState({ kind: "unavailable" });
          return;
        }
        const ranked = [...lots].sort((a, b) => b.asset_count - a.asset_count).slice(0, PROBE);
        for (const lot of ranked) {
          const w = await apiFetch(`/staff/lots/worklist?lot_id=${lot.id}&scope=unfinished`);
          if (!w.ok) continue;                       // one unreadable lot must not sink the card
          const q: Queue = await w.json().catch(() => null as any);
          if (!q || !q.progress || !Array.isArray(q.assets)) continue;
          if (q.progress.awaiting_grade_units > 0 && q.assets.length > 0) {
            if (live) setState({ kind: "ready", queue: q, next: q.assets[0] });
            return;
          }
        }
        if (live) setState({ kind: "empty" });
      } catch {
        if (live) setState({ kind: "unavailable" });
      }
    }

    void walk();
    // An unmounted card must not set state on the way out; the page it sits on re-mounts on every
    // visit, and every visit starts the walk again.
    return () => { live = false; };
  }, []);

  const body = () => {
    if (state.kind === "loading") {
      return <p className="text-sm text-ink-500">Finding the unit that has waited longest...</p>;
    }
    if (state.kind === "unavailable") {
      return (
        <p className="text-sm text-ink-500">
          The queue could not be read. <a className="text-brand-300 hover:underline" href="/admin/intake">Open Lot Process</a>.
        </p>
      );
    }
    if (state.kind === "empty") {
      return (
        <p className="text-sm text-ink-600">
          Nothing is waiting on a grade. Every lot in the ranking is fully graded.
        </p>
      );
    }
    const { queue, next } = state;
    const p = queue.progress;
    const stillToGrade = p.awaiting_grade_units;
    const unit = next.serial_number ? `Asset ${next.id} - ${next.serial_number}` : `Asset ${next.id}`;
    const what = next.product_model ?? next.product_title;
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-ink-900">{unit}</p>
          <p className="mt-0.5 text-xs text-ink-500">
            {what ? `${what} - ` : ""}
            oldest ungraded unit in lot{" "}
            <span className="font-mono">{queue.lot.lot_number}</span>, the largest lot still waiting
            ({stillToGrade} of {p.total_units} units to grade
            {queue.lot.warehouse ? `, ${queue.lot.warehouse}` : ""}).
          </p>
        </div>
        <Button href={`/admin/intake?q=${next.id}`} size="lg">
          Open in Lot Process
        </Button>
      </div>
    );
  };

  return (
    <Card className="p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <Heading level="h3" as="h2">Next asset</Heading>
        <span className={kickerClass}>priority queue</span>
      </div>
      {body()}
    </Card>
  );
}
