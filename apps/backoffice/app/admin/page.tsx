"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, logout } from "@/lib/api";
import { aud } from "@/lib/format";
import { Badge, Button, Card, Heading, Table, TBody, TD, TH, THead, TR } from "@/app/components/ui";
import { requireRole, useMe } from "@/lib/session";
import ActionTiles, { type ActionTile } from "@/app/components/dashboard/ActionTiles";
import AuditFeed from "@/app/components/dashboard/AuditFeed";
import KpiTile from "@/app/components/dashboard/KpiTile";
import PipelineMap, { lifecycleStages, stuckNote } from "@/app/components/dashboard/PipelineMap";
import { GradeStack, Sparkline, StatusDonut, type Slice } from "@/app/components/dashboard/charts";
import { NOTICE_TONE } from "@/app/components/dashboard/tokens";

/* The staff overview: /admin is the money and the operations, in one read of GET /staff/overview.

   Read-only by construction. There is no refund, no delete and no status write here - the API
   has no refund door to call, and the only writes this app makes live on the workbench pages.
   A dashboard that also mutates is a dashboard whose every number is one click from stale.
   Every call to action on this page NAVIGATES; none of them writes, which is also why each one is
   checked against the route tree below rather than guessed.

   The identity header is kept from the page this replaces (email + role + Sign out), and the
   heading renders OUTSIDE the load branch: SSR has no session, so a heading that only appeared
   once data arrived would leave an SSR response with no heading at all.

   NOTHING IS REDRAWN HERE. J2 built the Command Center on /admin/dashboard: the pipeline map, the
   glass KPI tile, the donut and the sparkline all exist in the tree and are imported from
   app/components/dashboard, which is where the shared widgets of this surface live. This page
   composes them from the same payload and adds only what did not exist: the Financial pulse row,
   the action tiles, the stacked grade bar and the condensed activity feed.

   THE OVERLAP IS REAL AND IT IS THE OWNER'S CALL. /admin and /admin/dashboard now draw the same
   pipeline map, the same donut, the same lifecycle counts and the same glass tiles from the same
   endpoint. The recommendation is that /admin/dashboard keeps the operations view (pipeline,
   pricing backlog, team activity, the two mixes) and /admin keeps the money view (the pulse row,
   the distributions, the attention tiles, the audit stream) - which is *not* what this job can
   resolve by deleting a page, so both are left standing and the duplication is reported. */

type Overview = {
  generated_at: string;
  inventory: { by_status: Record<string, number>; by_grade: Record<string, number>; total_units: number };
  lots: { by_status: Record<string, number> };
  stock_value: { at_cost_cents: number; at_list_cents: number; listed_units: number; cost_known_units: number };
  reservations: { active: number; expiring_24h: number };
  orders: { by_state: Record<string, number>; revenue_paid_cents_30d: number; orders_30d: number; aov_cents: number };
  newsletter: { total: number };
  dashboard: {
    pricing_pending: number;
    stuck_assets: { count: number; oldest_serial_number: string | null };
    lots_stuck: { count: number };
  };
  audit_feed: { at: string; actor_type: string; actor_id: number | null; entity: string; action: string; entity_id: number | null }[];
  needs_attention: { kind: string; count: number; label: string; items?: { id: number; title: string }[] }[];
};

/* Every count breakdown on this page is rendered from the payload's OWN keys - never a list
   re-typed here. The API zero-fills each grouped count from the DB's CHECK constraints, and that
   guarantee is only real if the UI iterates what the API sent: a breakdown driven by a local list
   would drop a value the DB admits later without a word. (Round 1 did exactly that - it listed
   `cancelled` for lots while the API seeds only intake/active/completed, so that row was drawn
   from a key the payload never contained.) Python's dict order carries through JSON and JS
   objects, so the API's lifecycle order is the display order, with any unexpected value appended
   rather than dropped.

   Two of the three tables this page used to print are now drawn as charts (the donut and the
   stacked bar), each of which keeps every count and label on the page - that is what makes the
   conversion legitimate rather than a loss. Lots by status is deliberately LEFT as the table it
   was: the status hues the donut reads are the ASSET lifecycle's (`--status-intake-solid` does not
   exist), so a chart of lots would need a second palette invented for three values, and the brief
   never asked for one. */
function Breakdown({ title, label, keyLabel, valueLabel, rows }: {
  title: string;
  label: string;
  keyLabel: string;
  valueLabel: string;
  rows: [string, number][];
}) {
  return (
    <Card className="p-4">
      <Heading level="h3" as="h2" className="mb-2">{title}</Heading>
      <Table label={label}>
        <THead><TH>{keyLabel}</TH><TH>{valueLabel}</TH></THead>
        <TBody>
          {rows.map(([key, n]) => (
            <TR key={key}>
              <TD><span className="text-ink-900">{key}</span></TD>
              <TD className="text-right tabular-nums">{n}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

/* The sparkline's honest gap, stated on the card instead of drawn as a shape. The payload carries
   `orders.revenue_paid_cents_30d` and `stock_value.at_list_cents` as single figures; the only
   seven-day value anywhere in it is `dashboard.revenue_last_7d_cents`, also a scalar. Nothing in
   this response is a time series, so neither card gets a line - J2 met the same wall on the
   dashboard and answered it the same way. */
const NO_SERIES = "No trend line: the API sends no daily series.";

/* Where a needs_attention kind can be acted on. Every destination below was checked against the
   route tree, not chosen because it sounds right: app/admin/<route>/page.tsx exists for each.

     intake_waiting        -> /admin/product-groups   a lot is activated by PUBLISHING it, which is
                                               what this door does; the old grading screen listed
                                               lots and had no way to activate one
     restock               -> /admin/cms       its product table prints the listed-unit count per
                                               product, which is the number this count is made of
     in_repair_stale       -> /admin/assets    the workbench, filterable by lifecycle status

   reservations_expiring has NO destination and is deliberately absent from this map. This app has
   no reservations route: the only reservations UI is the table inside /admin/assets/[id], and that
   needs an asset id the payload does not carry. The tile says so in words. */
const DESTINATION: Record<string, string> = {
  intake_waiting: "/admin/product-groups",
  restock: "/admin/cms",
  in_repair_stale: "/admin/assets",
};

/* Severity and consequence are THIS PAGE'S judgement, not payload fields - the API ranks nothing.
   The rule is the one J2 set on the dashboard feed: critical means a storefront path is blocked,
   warning means work is ageing without blocking anything. restock is critical because a product
   the storefront is advertising with nothing listed behind it cannot be bought; the other three
   are work sitting still. A kind the payload adds later falls back to warning and says so. */
const JUDGEMENT: Record<string, { severity: "critical" | "warning"; consequence: string }> = {
  intake_waiting: {
    severity: "warning",
    /* IT USED TO SAY "has not been scanned in yet", which named the workflow this app no longer
       has - stock arrives already graded on a supplier sheet and the importer writes it. What is
       actually true of such a lot is that nothing in it is on the shop, because publishing is what
       activates a lot. */
    consequence: "Stock that has arrived and has not been published yet.",
  },
  restock: {
    severity: "critical",
    consequence: "A product with nothing listed behind it cannot be bought.",
  },
  reservations_expiring: {
    severity: "warning",
    consequence: "A hold that lapses puts the unit back on sale mid-checkout.",
  },
  in_repair_stale: {
    severity: "warning",
    consequence: "Work ageing in the repair queue without blocking a sale.",
  },
};

/* The payload's array, in the payload's order, with the one thing it does not carry - a route -
   added where one was verified. A count above zero is the only thing that takes a severity. */
function tilesFor(attention: Overview["needs_attention"], reservations: Overview["reservations"]): ActionTile[] {
  return attention.map((a) => {
    const judged = JUDGEMENT[a.kind];
    return {
      kind: a.kind,
      label: a.label,
      count: a.count,
      items: a.items,
      href: DESTINATION[a.kind],
      severity: judged?.severity ?? "warning",
      consequence: judged?.consequence ?? "The API reports this kind; this page has no judgement for it yet.",
      /* The reservations tile's count is the 24-hour one; the number of holds in total is a
         separate payload field and is labelled as itself rather than added to it. */
      detail: a.kind === "reservations_expiring"
        ? `${reservations.active} active reservations in total`
        : undefined,
    };
  });
}

export default function AdminHome() {
  const router = useRouter();
  const { me, checked } = useMe();
  const allowed = requireRole(me, ["admin", "manager"]);
  const [data, setData] = useState<Overview | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const r = await apiFetch("/staff/overview");
    if (!r.ok) {
      setMsg(r.status === 403 ? "admin or manager role required" : "Could not load the overview");
      return;
    }
    setData(await r.json().catch(() => null));
  }, []);

  useEffect(() => {
    if (!checked) { return; }
    if (!allowed) { return; }
    void load();
  }, [checked, allowed, load]);

  async function signOut() {
    try { await logout(); } finally { router.replace("/"); }
  }

  const d = data?.dashboard;

  /* The donut's and the stacked bar's inputs come straight out of the payload's own keys, in the
     API's order (Python dict order survives JSON). Never a list re-typed here. */
  const statusSlices: Slice[] = data
    ? Object.entries(data.inventory.by_status).map(([key, value]) => ({ key, label: key, value }))
    : [];
  const gradeSegments: Slice[] = data
    ? Object.entries(data.inventory.by_grade).map(([key, value]) => ({ key, label: key, value }))
    : [];
  const stages = data && d
    ? lifecycleStages(data.inventory.by_status, {
        lotsStuck: d.lots_stuck.count,
        pricingPending: d.pricing_pending,
      })
    : [];
  const tiles = data ? tilesFor(data.needs_attention, data.reservations) : [];

  return (
    <main className="max-w-6xl mx-auto p-4 space-y-4 min-h-screen">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Heading level="h1">Overview</Heading>
          <p className="text-sm text-ink-500">
            {me ? <>Signed in as <span className="text-ink-900">{me.email}</span></> : "RFO Backoffice"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {me && <Badge colorClass="bg-brand-50 text-brand-300">{me.role}</Badge>}
          <Button variant="secondary" onClick={signOut}>Sign out</Button>
        </div>
      </header>

      {msg && <div className={`rounded-control px-3 py-2 text-sm ${NOTICE_TONE}`}>{msg}</div>}

      {!checked && <p className="text-sm text-ink-500">Loading...</p>}

      {checked && !allowed && !msg && (
        <Card className="p-6"><p className="text-sm text-ink-600">admin or manager role required.</p></Card>
      )}

      {checked && allowed && data && d && (
        <>
          {/* 1. Financial pulse. Four glass cards, every figure a payload field, no conversion:
                 the tile prints the field's own name beside it so a reader can trace it. */}
          <section className="space-y-3">
            <Heading level="h2">Financial pulse</Heading>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiTile label="Revenue (30 days)" value={aud(data.orders.revenue_paid_cents_30d)}
                       sub="paid orders only"
                       detail={`${data.orders.orders_30d} orders in the 30-day window`}>
                <Sparkline series={null} label="Revenue" unavailable={NO_SERIES} />
              </KpiTile>
              {/* The brief's stock figure is the at-list one. The at-cost figure this page showed
                  before it is the same payload block's other sum, with its OWN unit count - two
                  different populations, so they get two lines rather than one ratio. */}
              <KpiTile label="Stock value at list" value={aud(data.stock_value.at_list_cents)}
                       sub={`${data.stock_value.listed_units} units priced`}
                       detail={`at cost ${aud(data.stock_value.at_cost_cents)} across ${data.stock_value.cost_known_units} units with a cost`}>
                <Sparkline series={null} label="Stock value" unavailable={NO_SERIES} />
              </KpiTile>
              <KpiTile label="Average order value" value={aud(data.orders.aov_cents)}
                       sub={`the API's average over ${data.orders.orders_30d} orders`} />
              <KpiTile label="Newsletter" value={data.newsletter.total} sub="subscribers" />
            </div>
          </section>

          {/* 2. Operational hub: the lifecycle map J2 built, then the tiles that replace the old
                 attention list. */}
          <section className="space-y-3">
            <Heading level="h2">Operational hub</Heading>
            <Card className="p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                <Heading level="h3" as="h2">Lifecycle pipeline</Heading>
                <span className="text-xs text-ink-500">units on hand, by the stage each has reached</span>
              </div>
              <PipelineMap stages={stages} note={stuckNote(d.stuck_assets.count)} />
            </Card>
            <ActionTiles items={tiles} />
          </section>

          {/* 3. Distribution. The donut and the stacked bar both keep every label and count. */}
          <section className="space-y-3">
            <Heading level="h2">Distribution</Heading>
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                  <Heading level="h3" as="h2">Units by status</Heading>
                  <span className="text-xs text-ink-500">every unit on hand, by lifecycle stage</span>
                </div>
                <StatusDonut slices={statusSlices} total={data.inventory.total_units} centerLabel="units" />
              </Card>
              <Card className="p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                  <Heading level="h3" as="h2">Units by grade</Heading>
                  <span className="text-xs text-ink-500">every unit carrying a grade</span>
                </div>
                <GradeStack segments={gradeSegments} />
              </Card>
              <Breakdown title="Lots by status" label="Lots by status" keyLabel="Status" valueLabel="Lots"
                         rows={Object.entries(data.lots.by_status)} />
            </div>
          </section>

          {/* 4. The rest of the money view, unchanged from the page this replaces. */}
          <section className="space-y-3">
            <Heading level="h2">Orders</Heading>
            <div className="grid gap-4 lg:grid-cols-3">
              <Breakdown title="Orders by state (30 days)" label="Orders by state, last 30 days"
                         keyLabel="State" valueLabel="Orders"
                         rows={Object.entries(data.orders.by_state)} />
            </div>
          </section>

          {/* 5. The audit stream, condensed to one icon rail per row. */}
          <AuditFeed entries={data.audit_feed} />
        </>
      )}
    </main>
  );
}
