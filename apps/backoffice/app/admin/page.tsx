"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, logout } from "@/lib/api";
import { Badge, Button, Card, Heading, Table, TBody, TD, TH, THead, TR } from "@/app/components/ui";
import { gradeTone, statusTone } from "@/lib/ui";
import { requireRole, useMe } from "@/lib/session";
import AuditFeed from "@/app/components/dashboard/AuditFeed";
import AttentionList from "@/app/components/dashboard/AttentionList";
import StatRow from "@/app/components/dashboard/StatRow";

/* The staff overview: /admin stops being a profile card and becomes the dashboard.

   Read-only by construction. There is no refund, no delete and no status write here - the API
   has no refund door to call, and the only writes this app makes live on the workbench pages.
   A dashboard that also mutates is a dashboard whose every number is one click from stale.

   The identity header is kept from the page this replaces (email + role + Sign out), and the
   heading renders OUTSIDE the load branch: SSR has no session, so a heading that only appeared
   once data arrived would leave an SSR response with no heading at all. */
const ASSET_STATUSES = ["received", "tested", "in_repair", "graded", "listed",
                        "reserved", "sold", "shipped", "returned", "scrapped"];
const GRADES = ["A", "B", "C", "D"];
const LOT_STATUSES = ["intake", "active", "completed", "cancelled"];

type Overview = {
  generated_at: string;
  inventory: { by_status: Record<string, number>; by_grade: Record<string, number>; total_units: number };
  lots: { by_status: Record<string, number> };
  stock_value: { at_cost_cents: number; at_list_cents: number; listed_units: number; cost_known_units: number };
  reservations: { active: number; expiring_24h: number };
  orders: { by_state: Record<string, number>; revenue_paid_cents_30d: number; orders_30d: number; aov_cents: number };
  newsletter: { total: number };
  audit_feed: { at: string; actor_type: string; actor_id: number | null; entity: string; action: string; entity_id: number | null }[];
  needs_attention: { kind: string; count: number; label: string; items?: { id: number; title: string }[] }[];
};

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
          {me && <Badge colorClass="bg-brand-50 text-brand-700">{me.role}</Badge>}
          <Button variant="secondary" onClick={signOut}>Sign out</Button>
        </div>
      </header>

      {msg && <div className="rounded-control bg-accent-100 text-accent-700 px-3 py-2 text-sm">{msg}</div>}

      {!checked && <p className="text-sm text-ink-500">Loading...</p>}

      {checked && !allowed && !msg && (
        <Card className="p-6"><p className="text-sm text-ink-600">admin or manager role required.</p></Card>
      )}

      {checked && allowed && data && (
        <>
          <StatRow inventory={data.inventory} stockValue={data.stock_value}
                   reservations={data.reservations} orders={data.orders}
                   newsletter={data.newsletter} />

          <AttentionList items={data.needs_attention} />

          <AuditFeed entries={data.audit_feed} />

          <section>
            <Heading level="h2" className="mb-2">Inventory</Heading>
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="p-4">
                <Heading level="h3" className="mb-2">Units by status</Heading>
                <Table label="Units by status">
                  <THead><TH>Status</TH><TH>Units</TH></THead>
                  <TBody>
                    {ASSET_STATUSES.map((s) => (
                      <TR key={s}>
                        <TD><Badge colorClass={statusTone(s)}>{s}</Badge></TD>
                        <TD className="text-right tabular-nums">{data.inventory.by_status[s] ?? 0}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </Card>

              <Card className="p-4">
                <Heading level="h3" className="mb-2">Units by grade</Heading>
                <Table label="Units by grade">
                  <THead><TH>Grade</TH><TH>Units</TH></THead>
                  <TBody>
                    {GRADES.map((g) => (
                      <TR key={g}>
                        <TD><Badge colorClass={gradeTone(g)}>{g}</Badge></TD>
                        <TD className="text-right tabular-nums">{data.inventory.by_grade[g] ?? 0}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </Card>

              <Card className="p-4">
                <Heading level="h3" className="mb-2">Lots by status</Heading>
                <Table label="Lots by status">
                  <THead><TH>Status</TH><TH>Lots</TH></THead>
                  <TBody>
                    {LOT_STATUSES.map((s) => (
                      <TR key={s}>
                        <TD className="text-ink-900">{s}</TD>
                        <TD className="text-right tabular-nums">{data.lots.by_status[s] ?? 0}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </Card>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
