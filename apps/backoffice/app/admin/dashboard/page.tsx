"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Card, Heading } from "@/app/components/ui";
import { requireRole, useMe } from "@/lib/session";
import { aud } from "@/lib/format";
import { NOTICE_TONE } from "@/app/components/dashboard/tokens";
import { GradeBars, Sparkline, StatusDonut, type Slice } from "./charts";
import AttentionFeed, { type FeedItem } from "./attention";
import KpiTile from "./kpi";
import PipelineMap, { type PipelineStage } from "./pipeline";

/* /admin/dashboard - the operations view: the lifecycle pipeline, four glass headline numbers,
   two hand-rolled SVG charts, the week's leaderboard, and the attention feed.

   ONE read. This page calls the SAME `GET /staff/overview` the home page calls - there is no
   second summary endpoint. The dashboard is one screen, so it is one guarded surface and one
   round trip; a page assembled from several endpoints would be several places a read can leak
   and several sequential waits before the first pixel lands. The fields it needs that the home
   page did not (pricing_pending, the two mixes, the leaderboard) live in the payload's
   `dashboard` block, added to that same endpoint rather than to a new route.

   Read-only by construction, like the home page it sits beside: nothing here writes, and every
   count links out to the workbench page that owns the fix. */

type Overview = {
  inventory: { by_status: Record<string, number>; total_units: number };
  stock_value: { listed_units: number };
  dashboard: {
    pricing_pending: number;
    revenue_last_7d_cents: number;
    orders_last_7d: number;
    stuck_assets: { count: number; oldest_serial_number: string | null };
    lots_stuck: { count: number };
    grade_mix: Record<string, number>;
    category_mix: Record<string, number>;
    team_activity: { actor_id: number | null; actor_email: string | null; actions: number }[];
  };
};

/* The four lifecycle stages the pipeline map draws, in the order a unit walks them. `count` is
   read from `inventory.by_status` (the same zero-filled map the donut draws, so the two can never
   disagree) and a `backlog` is set only where the payload attributes work to ONE stage:
   Received -> lots_stuck (lots in intake past 14 days), Graded -> pricing_pending. Tested and
   Listed have none, because the payload's `stuck_assets.count` covers received AND tested
   together and nothing in it flags listed stock; that shared figure is printed under the map
   rather than split in half here. A key the payload omits renders "not reported by the API". */
function stagesFor(byStatus: Record<string, number>, d: Overview["dashboard"]): PipelineStage[] {
  const count = (key: string): number | null => {
    const n = byStatus[key];
    return typeof n === "number" ? n : null;
  };
  return [
    { key: "received", label: "Received", count: count("received"),
      backlog: d.lots_stuck.count > 0
        ? { count: d.lots_stuck.count, label: "lots awaiting activation" } : undefined },
    { key: "tested", label: "Tested", count: count("tested") },
    { key: "graded", label: "Graded", count: count("graded"),
      backlog: d.pricing_pending > 0
        ? { count: d.pricing_pending, label: "unpriced, cannot be listed" } : undefined },
    { key: "listed", label: "Listed", count: count("listed") },
  ];
}

/* The attention feed's rows, each pointing at the page that can act on it. The counts are the
   payload's; only the route, the wording and the severity live here. Severity is this page's
   judgement and it is written beside the count it judges: critical = the storefront path is
   blocked (a graded unit with no price can never be listed), warning = work ageing without
   blocking anything. A zero row is neither - see attention.tsx. */
function feedFor(d: Overview["dashboard"]): FeedItem[] {
  return [
    { label: "Units graded but not priced", count: d.pricing_pending, href: "/admin/assets",
      severity: "critical",
      detail: "A graded unit with no price cannot reach the storefront." },
    { label: "Units stuck in intake/received", count: d.stuck_assets.count, href: "/admin/assets",
      severity: "warning",
      detail: d.stuck_assets.oldest_serial_number
        ? `Oldest: ${d.stuck_assets.oldest_serial_number}` : "Nothing older than 7 days." },
    { label: "Lots in intake over 14 days", count: d.lots_stuck.count, href: "/admin/intake",
      severity: "warning",
      detail: "Received but never activated." },
  ];
}

export default function DashboardPage() {
  const { me, checked } = useMe();
  const allowed = requireRole(me, ["admin", "manager"]);
  const [data, setData] = useState<Overview | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const r = await apiFetch("/staff/overview");
    if (!r.ok) {
      setMsg(r.status === 403 ? "admin or manager role required" : "Could not load the dashboard");
      return;
    }
    setData(await r.json().catch(() => null));
  }, []);

  useEffect(() => {
    if (!checked) { return; }
    if (!allowed) { return; }
    void load();
  }, [checked, allowed, load]);

  const d = data?.dashboard;

  /* The donut's slices come straight out of the payload's own keys, in the API's order (Python
     dict order survives JSON). Never a list re-typed here: the API zero-fills the whole asset
     lifecycle, and that guarantee only holds if the chart draws what it was sent. */
  const statusSlices: Slice[] = data
    ? Object.entries(data.inventory.by_status).map(([key, value]) => ({ key, label: key, value }))
    : [];
  const gradeBars: Slice[] = d
    ? Object.entries(d.grade_mix).map(([key, value]) => ({ key, label: key, value }))
    : [];

  const pipeline = data && d ? stagesFor(data.inventory.by_status, d) : [];
  const alerts: FeedItem[] = d ? feedFor(d) : [];

  /* The one thing the map cannot say per node: the payload's stuck count spans two stages. */
  const pipelineNote = d
    ? "A stage counts the units currently in it, from the same inventory.by_status the donut " +
      "draws. " +
      (d.stuck_assets.count > 0
        ? `${d.stuck_assets.count} units have sat in Received or Tested for over 7 days - the ` +
          "API reports those two stages together, so the count is not attributed to either node."
        : "No unit has sat in Received or Tested for over 7 days.")
    : undefined;

  const categories = d ? Object.entries(d.category_mix) : [];

  return (
    <main className="max-w-6xl mx-auto p-4 space-y-4 min-h-screen">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Heading level="h1">Dashboard</Heading>
          <p className="text-sm text-ink-500">Inventory health, backlogs and this week&rsquo;s activity.</p>
        </div>
        {me && <span className="text-sm text-ink-500">Signed in as <span className="text-ink-900">{me.email}</span></span>}
      </header>

      {msg && <div className={`rounded-control px-3 py-2 text-sm ${NOTICE_TONE}`}>{msg}</div>}

      {!checked && <p className="text-sm text-ink-500">Loading...</p>}

      {checked && !allowed && !msg && (
        <Card className="p-6"><p className="text-sm text-ink-600">admin or manager role required.</p></Card>
      )}

      {checked && allowed && data && d && (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTile label="Listed inventory" value={data.stock_value.listed_units}
                     sub={`of ${data.inventory.total_units} units on hand`}>
              <Sparkline series={null} label="Listed units" unavailable="7-day trend not available" />
            </KpiTile>
            <KpiTile label="Pricing pending" value={d.pricing_pending} sub="graded, no price set" />
            <KpiTile label="Revenue (7 days)" value={aud(d.revenue_last_7d_cents)}
                     sub={`${d.orders_last_7d} paid ${d.orders_last_7d === 1 ? "order" : "orders"}`}>
              <Sparkline series={null} label="Revenue" unavailable="7-day trend not available" />
            </KpiTile>
            <KpiTile label="Stuck assets" value={d.stuck_assets.count} sub="received/tested over 7 days" />
          </section>

          <Card className="p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
              <Heading level="h3" as="h2">Lifecycle pipeline</Heading>
              <span className="text-xs text-ink-500">units on hand, by the stage each has reached</span>
            </div>
            <PipelineMap stages={pipeline} note={pipelineNote} />
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-4 lg:col-span-1">
              <Heading level="h3" as="h2" className="mb-2">Needs attention</Heading>
              <AttentionFeed items={alerts} />
            </Card>

            <Card className="p-4 lg:col-span-2">
              <Heading level="h3" as="h2" className="mb-2">Units by status</Heading>
              <StatusDonut slices={statusSlices} total={data.inventory.total_units} centerLabel="units" />
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-4 lg:col-span-2">
              <div className="flex items-baseline justify-between mb-2">
                <Heading level="h3" as="h2">Listed units by grade</Heading>
                <span className="text-xs text-ink-500">graded A&ndash;D, live on the storefront</span>
              </div>
              <GradeBars bars={gradeBars} />
            </Card>

            <Card className="p-4 lg:col-span-1">
              <Heading level="h3" as="h2" className="mb-2">Team activity (7 days)</Heading>
              {d.team_activity.length === 0 ? (
                <p className="text-sm text-ink-500">No staff activity recorded this week.</p>
              ) : (
                <ol className="space-y-2">
                  {d.team_activity.map((t, i) => (
                    <li key={`${t.actor_id ?? "none"}-${i}`} className="flex items-center gap-2 text-sm">
                      <span className="w-4 text-xs text-ink-400 tabular-nums">{i + 1}</span>
                      <span className="min-w-0 truncate text-ink-900">{t.actor_email ?? `actor #${t.actor_id ?? "-"}`}</span>
                      <span className="ml-auto shrink-0 tabular-nums text-ink-600">{t.actions}</span>
                    </li>
                  ))}
                </ol>
              )}

              {categories.length > 0 && (
                <>
                  <Heading level="h3" as="h2" className="mt-4 mb-2">Listed by category</Heading>
                  <ul className="space-y-1">
                    {categories.map(([name, n]) => (
                      <li key={name} className="flex items-center gap-2 text-sm">
                        <span className="min-w-0 truncate text-ink-600">{name}</span>
                        <span className="ml-auto shrink-0 tabular-nums text-ink-900">{n}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          </div>
        </>
      )}
    </main>
  );
}
