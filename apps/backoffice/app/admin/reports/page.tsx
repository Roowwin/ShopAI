"use client";

/* Reports & BI: the sales trend, the leaderboard, and what is sitting in the warehouse.

   FILTERS IN ONE ROW ABOVE THE CHARTS, because a filter that lives inside a chart's card reads as
   belonging to that chart when it in fact re-scopes everything below it. The range, category and
   channel controls move the whole page together, which is the only way the trend and the leaderboard
   cannot disagree about what "this quarter" means.

   TWO CHARTS, NOT ONE WITH TWO AXES. Revenue and order volume are different scales; putting them on
   one plot with two y-axes invents a relationship out of the crossing point of two unrelated rulers.
   They are drawn as two small multiples sharing an x-axis - see LineChart.

   THE EXPORT IS THE SAME NUMBERS. Every button hits `/staff/reports/export` with the CURRENT filter
   state, and the API renders it from the same service functions this screen just called, so the file
   an accountant opens cannot disagree with the screen it was downloaded from. */

import { useCallback, useEffect, useState } from "react";

import { Badge, Button, Card, Heading, Input, Stat, cn } from "@/app/components/ui";
import { apiFetch, API } from "@/lib/api";
import { aud } from "@/lib/format";
import { requireRole, useMe } from "@/lib/session";
import { kickerClass } from "@/lib/ui";
import LineChart, { type Point } from "./LineChart";

/* The two series colours. Both are the reference categorical palette's DARK steps and both were run
   through the palette validator against this app's own chart surface before use. They are written
   here as literals because a CSS variable cannot be handed to an SVG stroke without a resolution
   step, and the pair is the thing that was validated - so it must be visible in one place. */
const REVENUE_COLOUR = "#3987e5";
const VOLUME_COLOUR = "#d95926";

type TrendPoint = { date: string; orders: number; units: number; revenue_cents: number;
                    gst_cents: number };
type Trends = { days: number; from: string; to: string; channel: string | null;
                category: string | null; series: TrendPoint[];
                totals: { orders: number; units: number; revenue_cents: number; gst_cents: number };
                channels: string[] };
type Product = { product_id: number; title: string; category: string; units: number;
                 revenue_cents: number; cogs_cents: number; margin_cents: number; margin_pct: number;
                 velocity_per_day: number };
type Performers = { days: number; products: Product[]; by_units: Product[]; by_revenue: Product[];
                    by_margin: Product[]; by_velocity: Product[] };
type StockUnit = { asset_id: number; serial_number: string | null; status: string; grade: string | null;
                   title: string; category: string; cost_cents: number;
                   sale_price_cents: number | null; days_in_warehouse: number;
                   listed_at: string | null; days_listed: number | null; dead: boolean };
type Inventory = { dead_days: number; as_of: string; units: StockUnit[];
                   summary: { units_in_stock: number; stock_value_cents: number; dead_units: number;
                              dead_value_cents: number; by_status: Record<string, number> } };

const RANGES = [30, 90, 365];
const CHANNEL_LABEL: Record<string, string> = {
  storefront: "Storefront", ebay: "eBay", amazon: "Amazon",
};
// The four ways the same rows are read. One list, so the switcher and the heading cannot drift.
const METRICS: { key: keyof Performers; label: string; right: string }[] = [
  { key: "by_revenue", label: "Revenue", right: "Revenue" },
  { key: "by_units", label: "Units sold", right: "Units" },
  { key: "by_margin", label: "Margin", right: "Margin" },
  { key: "by_velocity", label: "Velocity", right: "Units/day" },
];

const money = (c: number) => aud(c);

export default function ReportsPage() {
  const { me, checked } = useMe();
  const allowed = requireRole(me, ["admin"]);

  const [days, setDays] = useState(30);
  const [channel, setChannel] = useState("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<{ slug: string; name: string }[]>([]);
  const [trends, setTrends] = useState<Trends | null>(null);
  const [performers, setPerformers] = useState<Performers | null>(null);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [metric, setMetric] = useState<keyof Performers>("by_revenue");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const query = useCallback((extra = "") => {
    const q = new URLSearchParams({ days: String(days) });
    if (channel) q.set("channel", channel);
    if (category) q.set("category", category);
    return `/staff/reports/${extra}?${q.toString()}`;
  }, [days, channel, category]);

  const load = useCallback(async () => {
    setErr("");
    const [t, p, i] = await Promise.all([
      apiFetch(query("sales-trends")),
      apiFetch(query("top-performers")),
      apiFetch("/staff/reports/inventory?dead_days=60&limit=200"),
    ]);
    if (!t.ok || !p.ok || !i.ok) {
      setErr(`Could not read the reports (${t.status}/${p.status}/${i.status})`);
      setLoaded(true);
      return;
    }
    setTrends(await t.json());
    setPerformers(await p.json());
    setInventory(await i.json());
    setLoaded(true);
  }, [query]);

  useEffect(() => { if (checked && allowed) void load(); }, [checked, allowed, load]);
  useEffect(() => {
    if (!checked || !allowed) return;
    void (async () => {
      const r = await apiFetch("/store/categories");
      if (!r.ok) return;
      const j: any = await r.json().catch(() => ({}));
      const rows = Array.isArray(j?.categories) ? j.categories : Array.isArray(j) ? j : [];
      setCategories(rows.map((c: any) => ({ slug: c.slug, name: c.name ?? c.slug })));
    })();
  }, [checked, allowed]);

  async function download(report: string, format: "csv" | "pdf") {
    setBusy(`${report}-${format}`); setErr("");
    const r = await apiFetch(`/staff/reports/export?report=${report}&format=${format}`
                             + `&days=${days}${channel ? `&channel=${channel}` : ""}`
                             + `${category ? `&category=${encodeURIComponent(category)}` : ""}`);
    setBusy("");
    if (!r.ok) { setErr(`Export failed (${r.status})`); return; }
    const blob = await r.blob();
    // The filename the server chose (it carries the report and the date) - so the download is named
    // by the API rather than re-invented here.
    const cd = r.headers.get("content-disposition") ?? "";
    const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? `${report}.${format}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    a.remove(); URL.revokeObjectURL(url);
  }

  if (!checked || !loaded) {
    return <main className="mx-auto max-w-6xl px-4 pt-8"><p className="text-sm text-ink-500">Loading...</p></main>;
  }
  if (!allowed) {
    return <main className="mx-auto max-w-6xl px-4 pt-8">
      <p className="text-sm text-danger-600">Reporting is an administrator&apos;s screen.</p></main>;
  }

  const revenuePoints: Point[] = (trends?.series ?? []).map((p) => ({ label: p.date, value: p.revenue_cents }));
  const volumePoints: Point[] = (trends?.series ?? []).map((p) => ({ label: p.date, value: p.orders }));
  const t = trends?.totals;
  const board = (performers?.[metric] ?? []) as Product[];

  return (
    <main className="mx-auto max-w-6xl px-4 pt-8 pb-24">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Heading level="h1">Reports &amp; Business Intelligence</Heading>
        {err && <span className="text-sm text-danger-600">{err}</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="muted" onClick={() => download("sales-trends", "csv")} disabled={busy !== ""}>
            {busy === "sales-trends-csv" ? "Exporting…" : "Trend CSV"}
          </Button>
          <Button variant="muted" onClick={() => download("sales-trends", "pdf")} disabled={busy !== ""}>
            {busy === "sales-trends-pdf" ? "Exporting…" : "Trend PDF"}
          </Button>
        </div>
      </div>

      {/* FILTERS, one row, above everything they scope. */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <span className={cn(kickerClass, "block")}>Range</span>
            <div className="mt-1 flex gap-1">
              {RANGES.map((d) => (
                <button key={d} onClick={() => setDays(d)}
                        aria-pressed={days === d}
                        className={cn("rounded-control px-3 py-1.5 text-sm ring-1 ring-line transition",
                                      days === d ? "bg-brand-700 text-ink-900" : "text-ink-600 hover:bg-surface-sunken")}>
                  {d}d
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className={cn(kickerClass, "block")}>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}
                    className="mt-1 rounded-control bg-surface px-3 py-2 text-sm ring-1 ring-line">
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={cn(kickerClass, "block")}>Channel</span>
            <select value={channel} onChange={(e) => setChannel(e.target.value)}
                    className="mt-1 rounded-control bg-surface px-3 py-2 text-sm ring-1 ring-line">
              <option value="">All channels</option>
              {(trends?.channels ?? []).map((c) =>
                <option key={c} value={c}>{CHANNEL_LABEL[c] ?? c}</option>)}
            </select>
          </label>
          <p className="ml-auto max-w-sm text-xs text-ink-500">
            Revenue is stated <span className="font-medium text-ink-600">excluding GST</span>; the tax
            collected is reported separately, as the statement does.
          </p>
        </div>
      </Card>

      {/* THE HEADLINE FIGURES. A statistic with no plot is a tile, not a chart. */}
      <div className="mt-4 grid gap-4 sm:grid-cols-4">
        <Stat label="Revenue (ex GST)" value={money(t?.revenue_cents ?? 0)} />
        <Stat label="GST collected" value={money(t?.gst_cents ?? 0)}
                                   sub="Held for the tax authority" />
        <Stat label="Orders" value={String(t?.orders ?? 0)} />
        <Stat label="Units sold" value={String(t?.units ?? 0)} />
      </div>

      {/* TWO SMALL MULTIPLES, ONE X-AXIS EACH - never one plot with two y-axes. */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <LineChart title="Revenue" subtitle="excluding GST" points={revenuePoints}
                     colour={REVENUE_COLOUR} format={(v) => aud(Math.round(v))}
                     empty="No sales in this window." />
        </Card>
        <Card className="p-5">
          <LineChart title="Order volume" subtitle="orders placed" points={volumePoints}
                     colour={VOLUME_COLOUR} format={(v) => String(Math.round(v))}
                     empty="No orders in this window." />
        </Card>
      </div>

      {/* TOP PERFORMERS. One set of rows, four readings - the switcher re-orders, it does not refetch. */}
      <Card className="mt-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Heading level="h2">Top performers</Heading>
          <div className="ml-auto flex gap-1">
            {METRICS.map((m) => (
              <button key={String(m.key)} onClick={() => setMetric(m.key)}
                      aria-pressed={metric === m.key}
                      className={cn("rounded-control px-3 py-1.5 text-sm ring-1 ring-line transition",
                                    metric === m.key ? "bg-brand-700 text-ink-900"
                                                     : "text-ink-600 hover:bg-surface-sunken")}>
                {m.label}
              </button>
            ))}
          </div>
          <Button variant="muted" onClick={() => download("top-performers", "csv")} disabled={busy !== ""}>
            {busy === "top-performers-csv" ? "Exporting…" : "CSV"}
          </Button>
          <Button variant="muted" onClick={() => download("top-performers", "pdf")} disabled={busy !== ""}>
            {busy === "top-performers-pdf" ? "Exporting…" : "PDF"}
          </Button>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line-strong text-left">
                <th className="py-2 pr-3 font-medium text-ink-500">#</th>
                <th className="py-2 pr-3 font-medium text-ink-500">Product</th>
                <th className="py-2 pr-3 font-medium text-ink-500">Category</th>
                <th className="py-2 pr-3 text-right font-medium text-ink-500">Units</th>
                <th className="py-2 pr-3 text-right font-medium text-ink-500">Revenue</th>
                <th className="py-2 pr-3 text-right font-medium text-ink-500">Margin</th>
                <th className="py-2 text-right font-medium text-ink-500">Units/day</th>
              </tr>
            </thead>
            <tbody>
              {board.map((p, i) => (
                <tr key={`${p.product_id}-${i}`} className="border-b border-line">
                  <td className="py-2 pr-3 tabular-nums text-ink-500">{i + 1}</td>
                  <td className="py-2 pr-3 text-ink-900">{p.title}</td>
                  <td className="py-2 pr-3 text-ink-600">{p.category || "-"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-ink-700">{p.units}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-ink-700">{money(p.revenue_cents)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-ink-700">
                    {money(p.margin_cents)} <span className="text-ink-500">({p.margin_pct.toFixed(1)}%)</span>
                  </td>
                  <td className="py-2 text-right tabular-nums text-ink-700">{p.velocity_per_day.toFixed(3)}</td>
                </tr>
              ))}
              {board.length === 0 && (
                <tr><td colSpan={7} className="py-3 text-ink-500">Nothing sold in this window.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* INVENTORY TURNOVER. */}
      <Card className="mt-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Heading level="h2">Inventory turnover</Heading>
          {inventory && inventory.summary.dead_units > 0 && (
            <Badge colorClass="bg-danger-50 text-danger-600">
              {inventory.summary.dead_units} dead units
            </Badge>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="muted" onClick={() => download("inventory", "csv")} disabled={busy !== ""}>
              {busy === "inventory-csv" ? "Exporting…" : "CSV"}
            </Button>
            <Button variant="muted" onClick={() => download("inventory", "pdf")} disabled={busy !== ""}>
              {busy === "inventory-pdf" ? "Exporting…" : "PDF"}
            </Button>
          </div>
        </div>

        <div className="mt-3 grid gap-4 sm:grid-cols-4">
          <Stat label="Units in stock" value={String(inventory?.summary.units_in_stock ?? 0)} />
          <Stat label="Stock value (at cost)" value={money(inventory?.summary.stock_value_cents ?? 0)} />
          <Stat label="Dead stock" value={String(inventory?.summary.dead_units ?? 0)}
                sub={`Listed over ${inventory?.dead_days ?? 60} days`} />
          <Stat label="Dead value (at cost)" value={money(inventory?.summary.dead_value_cents ?? 0)} />
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line-strong text-left">
                <th className="py-2 pr-3 font-medium text-ink-500">Asset</th>
                <th className="py-2 pr-3 font-medium text-ink-500">Product</th>
                <th className="py-2 pr-3 font-medium text-ink-500">Status</th>
                <th className="py-2 pr-3 text-right font-medium text-ink-500">Days in warehouse</th>
                <th className="py-2 pr-3 text-right font-medium text-ink-500">Days listed</th>
                <th className="py-2 text-right font-medium text-ink-500">Cost</th>
              </tr>
            </thead>
            <tbody>
              {/* WORST FIRST - the rows the report is for are the ones at the top. */}
              {(inventory?.units ?? []).slice(0, 40).map((u) => (
                <tr key={u.asset_id} className="border-b border-line">
                  <td className="py-2 pr-3 text-ink-900">#{u.asset_id}</td>
                  <td className="py-2 pr-3 text-ink-700">{u.title}</td>
                  <td className="py-2 pr-3">
                    <span className="text-ink-600">{u.status}</span>
                    {u.dead && <span className="ml-2 text-xs font-medium text-danger-600">dead stock</span>}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-ink-700">
                    {u.days_in_warehouse.toFixed(0)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-ink-700">
                    {u.days_listed === null ? "-" : u.days_listed.toFixed(0)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-ink-700">{money(u.cost_cents)}</td>
                </tr>
              ))}
              {(inventory?.units ?? []).length === 0 && (
                <tr><td colSpan={6} className="py-3 text-ink-500">No stock in the building.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink-500">
          Showing the {Math.min(40, inventory?.units.length ?? 0)} longest-held units. Dead stock is a
          unit still listed past the threshold - units in refurbishment are not counted as dead.
        </p>
      </Card>
    </main>
  );
}
