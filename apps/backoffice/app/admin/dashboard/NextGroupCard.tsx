"use client";

import { useEffect, useState } from "react";

import { Button, Card, Heading } from "@/app/components/ui";
import { apiFetch } from "@/lib/api";
import { kickerClass } from "@/lib/ui";

/* THE PRIORITY QUEUE, at the level the work is actually done.

   This replaced a card that walked `GET /staff/lots` ranked by size and opened up to five
   `lots/worklist` queues inside it, to name the oldest UNGRADED unit. It was the right answer while
   grading was a screen somebody sat in front of. It is not any more: units arrive already graded on
   a supplier sheet, the importer writes them, and the work left is giving each model+grade a
   photograph and a price, once, on the Product groups screen. A card that hunts for the oldest
   ungraded unit is now hunting for work nobody is going to do.

   SO THE WALK IS GONE, and that is the improvement rather than a simplification for its own sake:
   one request where there were up to six, and the count it prints is the size of the actual
   worklist rather than a single unit's serial number.

   WHY THIS IS A SECOND READ ON A PAGE THAT IS PROUD OF HAVING ONE. /admin/dashboard is one guarded
   surface and one round trip, and the KPIs are the page - they must not wait on a list that may be
   long. So this is its own client component with its own fetch, mounted after the payload has
   already painted: it can be slow, it can fail, and it can render nothing without moving a single
   number above it. Its read takes the same roles the page does; a 403 is drawn as the quiet note
   below rather than as an error, because somebody who cannot read it should not have been shown
   the page at all. */

/* The list door caps `limit` at 200 and this screen has no count of its own, so above the cap the
   number is a FLOOR and says so. Printing "200" for a catalogue with 295 unfinished groups would be
   a lie of exactly the kind this dashboard is built to avoid - and getting a true count would mean
   adding a parameter to the API, which this change deliberately does not touch. */
const CAP = 200;

type GroupRow = { units_total: number; units_listed: number };

type State =
  | { kind: "loading" }
  | { kind: "ready"; groups: number; capped: boolean }
  | { kind: "empty" }
  | { kind: "unavailable" };

export default function NextGroupCard() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const r = await apiFetch(`/staff/product-groups?state=needs_setup&limit=${CAP}`);
        if (!r.ok) {
          if (live) setState({ kind: "unavailable" });
          return;
        }
        const rows: GroupRow[] = await r.json().catch(() => []);
        if (!Array.isArray(rows)) {
          if (live) setState({ kind: "unavailable" });
          return;
        }
        if (!live) return;
        if (rows.length === 0) { setState({ kind: "empty" }); return; }
        setState({ kind: "ready", groups: rows.length, capped: rows.length >= CAP });
      } catch {
        if (live) setState({ kind: "unavailable" });
      }
    })();
    // An unmounted card must not set state on the way out; the page it sits on re-mounts on every
    // visit.
    return () => { live = false; };
  }, []);

  const body = () => {
    if (state.kind === "loading") {
      return <p className="text-sm text-ink-500">Counting the groups that still need setting up...</p>;
    }
    if (state.kind === "unavailable") {
      return (
        <p className="text-sm text-ink-500">
          The group worklist could not be read. Open it from{" "}
          <a className="text-brand-300 hover:underline" href="/admin/product-groups">Product groups</a>.
        </p>
      );
    }
    if (state.kind === "empty") {
      return (
        <p className="text-sm text-ink-600">
          Every model and grade has a photograph and a price. Nothing is waiting.
        </p>
      );
    }
    const n = state.capped ? `${state.groups}+` : String(state.groups);
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <p className="font-display text-xl font-semibold text-ink-900">
            {n} model+grade group{state.groups === 1 && !state.capped ? "" : "s"}
          </p>
          <p className="mt-1 text-sm text-ink-500">
            still {state.groups === 1 && !state.capped ? "needs" : "need"} a photograph and a price
            before they can go on the shop.
          </p>
        </div>
        <Button href="/admin/product-groups" size="lg">
          Open product groups
        </Button>
      </div>
    );
  };

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <span className={kickerClass}>Priority queue</span>
          {/* An `h2` at the h2 STEP, where every other card on this page is an h2 tag at the h3
              step. That one-step lift is the whole of what makes this the featured banner: the
              honest way to say "this one is the action" is to let its heading outrank its
              neighbours' - not to spend a colour on it, which the Quiet Luxury pass reserved for
              the primary button inside. */}
          <Heading level="h2" as="h2" className="mt-1">Next up</Heading>
          <p className="mt-1 text-sm text-ink-500">
            One photograph and one price per model and grade - the work left before stock can be
            published.
          </p>
        </div>
      </div>
      <div className="mt-5">{body()}</div>
    </Card>
  );
}
