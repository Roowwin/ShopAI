"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Card, Heading } from "@/app/components/ui";
import { requireRole, useMe } from "@/lib/session";
import { aud } from "@/lib/format";
import { NOTICE_TONE } from "@/app/components/dashboard/tokens";
import { GradeBars, Sparkline, StatusDonut, type Slice } from "@/app/components/dashboard/charts";
import AttentionFeed, { type FeedItem } from "./attention";
import NextAssetCard from "./NextAssetCard";
import KpiTile from "@/app/components/dashboard/KpiTile";
import PipelineMap, { lifecycleStages, stuckNote } from "@/app/components/dashboard/PipelineMap";

/* /admin/dashboard - the operations view: the pipeline as a process flow, a hero revenue card
   with three supporting figures, a featured "next asset" banner, two hand-rolled SVG charts, the
   week's leaderboard, and the attention feed.

   THE EXECUTIVE PASS changed the LAYOUT and nothing else. Every count on this page, every read it
   makes and every link it carries is the one it already had; what moved is which number is loud,
   which cards get air, and whether the lifecycle reads as four facts or one process. Nothing here
   was added to the payload to make the page look fuller - where a section wanted data the payload
   does not hold (action kinds for the activity timeline, a per-day revenue series for the
   sparklines), the section says so rather than inventing it.

   ONE read. This page calls the SAME `GET /staff/overview` the home page calls - there is no
   second summary endpoint. The dashboard is one screen, so it is one guarded surface and one
   round trip; a page assembled from several endpoints would be several places a read can leak
   and several sequential waits before the first pixel lands. The fields it needs that the home
   page did not (pricing_pending, the two mixes, the leaderboard) live in the payload's
   `dashboard` block, added to that same endpoint rather than to a new route.

   Read-only by construction, like the home page it sits beside: nothing here writes, and every
   count links out to the workbench page that owns the fix.

   ONE EXCEPTION, AND IT IS BUILT NOT TO COUNT AS ONE. The Priority Queue card - the biggest lot
   still waiting on a grade, and the oldest ungraded unit inside it - needs a search the overview
   payload does not carry, so it is its own client component with its own reads, mounted BELOW the
   payload. It is not part of this page's round trip and cannot delay or damage it: the KPI row
   paints from the overview whether that walk is slow, empty, refused or still going. */

type Overview = {
  inventory: { by_status: Record<string, number>; total_units: number };
  stock_value: { listed_units: number };
  dashboard: {
    pricing_pending: number;
    revenue_last_7d_cents: number;
    orders_last_7d: number;
    stuck_assets: { count: number; oldest_serial_number: string | null };
    lots_stuck: { count: number };
    /* `days` is the threshold the count was taken at, carried by the payload so the copy below
       cannot disagree with the number beside it. */
    stale_listed: { count: number; days: number };
    grade_mix: Record<string, number>;
    category_mix: Record<string, number>;
    team_activity: { actor_id: number | null; actor_email: string | null; actions: number }[];
  };
};

/* The four lifecycle stages and the map's own note both live in the shared PipelineMap module,
   because /admin draws the same map from the same endpoint: one definition of which node owns
   which backlog, not two. */

/* The attention feed's rows, each pointing at the page that can act on it. The counts are the
   payload's; only the route, the wording, the severity and the urgency live here. Severity is this
   page's judgement and it is written beside the count it judges: critical = the storefront path is
   blocked (a graded unit with no price can never be listed), warning = work ageing without
   blocking anything. A zero row is neither - see attention.tsx.

   `urgent` is the second judgement: work the payload DATES as old. Two rows qualify - units listed
   past three months, and lots that have sat in intake past a fortnight - because both carry a
   threshold of months or weeks rather than days. The "stuck in received/tested" row above them is
   aged too, but at 7 days, and marking that one as well would leave the halo saying nothing the
   badge does not already say.

   The stale row's badge reads "Stale" rather than the level's own "Ageing", for the reason given on
   the field in attention.tsx: "Ageing" is true of three rows on this page and would tell the
   operator nothing about which one is being pointed at. Its threshold is read off the payload's own
   `days` rather than typed as 90 here, so the sentence and the number cannot drift apart. */
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
      severity: "warning", urgent: true,
      detail: "Received but never activated." },
    /* The link carries the narrowing the row is about, so the operator lands on the units the count
       counted rather than on the whole inventory. The assets page reads `status` from the query
       string - see the note there; without that, this href would be a narrowing that silently did
       nothing, which is worse than a plain link. */
    { label: `Assets listed over ${Math.round(d.stale_listed.days / 30)} months`,
      count: d.stale_listed.count, href: "/admin/assets?status=listed",
      severity: "warning", urgent: true, badge: "Stale",
      detail: "Consider price drop or promotional bundle." },
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

  const pipeline = data && d
    ? lifecycleStages(data.inventory.by_status, {
        lotsStuck: d.lots_stuck.count,
        pricingPending: d.pricing_pending,
      })
    : [];
  const alerts: FeedItem[] = d ? feedFor(d) : [];

  /* The one thing the map cannot say per node: the payload's stuck count spans two stages. */
  const pipelineNote = d ? stuckNote(d.stuck_assets.count) : undefined;

  const categories = d ? Object.entries(d.category_mix) : [];

  return (
    <main className="max-w-6xl mx-auto p-4 space-y-6 min-h-screen">
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
          {/* THE TOP ROW IS NOT FOUR EQUAL BOXES. Four identical tiles said "here are four
              numbers"; the executive layout says "here is the number, and here is what supports
              it". Revenue takes a hero card three columns wide and the three counts sit beside it
              at one column each, so the row is read in the order the business is: what came in,
              then what is on the shelf, what cannot be sold yet, and what is stuck.

              Six columns on lg, three on sm. On a phone the hero spans the full width and the
              three supporting cards sit under it; at sm the hero takes the whole first row for the
              same reason. `size="hero"` changes the tile's padding and the value's step and
              nothing else - the four tiles say the same four things they always did. */}
          <section className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <KpiTile size="hero" className="sm:col-span-3" label="Revenue (7 days)"
                     value={aud(d.revenue_last_7d_cents)}
                     sub={`${d.orders_last_7d} paid ${d.orders_last_7d === 1 ? "order" : "orders"}`}>
              <Sparkline series={null} label="Revenue" unavailable="7-day trend not available" />
            </KpiTile>
            <KpiTile label="Listed inventory" value={data.stock_value.listed_units}
                     sub={`of ${data.inventory.total_units} units on hand`}>
              <Sparkline series={null} label="Listed units" unavailable="7-day trend not available" />
            </KpiTile>
            <KpiTile label="Pricing pending" value={d.pricing_pending} sub="graded, no price set" />
            <KpiTile label="Stuck assets" value={d.stuck_assets.count} sub="received/tested over 7 days" />
          </section>

          {/* Under the numbers, because the numbers are what the page is: this is the one card
              that tells the operator what to DO, and it makes its own reads. */}
          <NextAssetCard />

          <Card className="p-6">
            <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
              <Heading level="h3" as="h2">Lifecycle pipeline</Heading>
              <span className="text-xs text-ink-500">units on hand, by the stage each has reached</span>
            </div>
            <PipelineMap stages={pipeline} note={pipelineNote} />
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="p-6 lg:col-span-1">
              <Heading level="h3" as="h2" className="mb-4">Needs attention</Heading>
              <AttentionFeed items={alerts} />
            </Card>

            {/* The donut gets the most air on the page, deliberately: it is the one card that is
                read rather than scanned - a ring and ten labels need room between them or the
                legend becomes a column of grey. `p-8` against the `p-6` every other card takes. */}
            <Card className="p-8 lg:col-span-2">
              <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
                <Heading level="h3" as="h2">Units by status</Heading>
                <span className="text-xs text-ink-500">every unit on hand, by the stage it is at</span>
              </div>
              <StatusDonut slices={statusSlices} total={data.inventory.total_units} centerLabel="units" />
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="p-6 lg:col-span-2">
              <div className="mb-5 flex items-baseline justify-between gap-2">
                <Heading level="h3" as="h2">Listed units by grade</Heading>
                <span className="text-xs text-ink-500">graded A&ndash;D, live on the storefront</span>
              </div>
              <GradeBars bars={gradeBars} />
            </Card>

            <Card className="p-6 lg:col-span-1">
              <div className="mb-4 flex items-baseline justify-between gap-2">
                <Heading level="h3" as="h2">Team activity</Heading>
                <span className="text-xs text-ink-500">7 days</span>
              </div>

              {/* A CONDENSED TIMELINE, and the honest limit of it. The payload's `team_activity` is
                  a leaderboard - an actor and a COUNT of what they did - and it carries no action
                  kinds at all. So there is no "completed" to tick and no "paid" to mark with a
                  dollar sign: an icon per row claiming either would be inventing a fact about a
                  person's work, which is worse here than anywhere else on this page. Every row
                  therefore carries the one glyph that is true of all of them - an actor - and the
                  count keeps the meaning. Wiring the typed audit feed in to get real kinds would
                  mean a second read on a page that is deliberately one round trip. */}
              {d.team_activity.length === 0 ? (
                <p className="text-sm text-ink-500">No staff activity recorded this week.</p>
              ) : (
                <ol className="relative">
                  {d.team_activity.map((t, i) => (
                    <li key={`${t.actor_id ?? "none"}-${i}`} className="relative flex items-center gap-3 py-2 pl-9">
                      {i < d.team_activity.length - 1 && (
                        <span aria-hidden="true" className="absolute -bottom-2 left-[11px] top-8 w-px bg-line" />
                      )}
                      <span aria-hidden="true"
                            className="absolute left-0 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-surface-sunken ring-1 ring-line">
                        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-ink-500" fill="none"
                             stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="8" cy="5.5" r="2.6" />
                          <path d="M3 13.5c.7-2.4 2.7-3.6 5-3.6s4.3 1.2 5 3.6" />
                        </svg>
                      </span>
                      <span className="min-w-0 truncate text-sm text-ink-900">
                        {t.actor_email ?? `actor #${t.actor_id ?? "-"}`}
                      </span>
                      <span className="ml-auto shrink-0 rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-medium tabular-nums text-ink-600 ring-1 ring-line">
                        {t.actions}
                      </span>
                    </li>
                  ))}
                </ol>
              )}

              {categories.length > 0 && (
                <>
                  <Heading level="h3" as="h2" className="mt-6 mb-3">Listed by category</Heading>
                  <ul className="space-y-1.5">
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
