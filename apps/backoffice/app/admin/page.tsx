"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, logout } from "@/lib/api";
import { Badge, Button, Card, Heading, Table, TBody, TD, TH, THead, TR } from "@/app/components/ui";
import { gradeTone, statusTone } from "@/lib/ui";
import { requireRole, useMe } from "@/lib/session";
import AuditFeed from "@/app/components/dashboard/AuditFeed";
import AttentionList from "@/app/components/dashboard/AttentionList";
import StatRow from "@/app/components/dashboard/StatRow";
import { NOTICE_TONE } from "@/app/components/dashboard/tokens";

/* The staff overview: /admin stops being a profile card and becomes the dashboard.

   Read-only by construction. There is no refund, no delete and no status write here - the API
   has no refund door to call, and the only writes this app makes live on the workbench pages.
   A dashboard that also mutates is a dashboard whose every number is one click from stale.

   The identity header is kept from the page this replaces (email + role + Sign out), and the
   heading renders OUTSIDE the load branch: SSR has no session, so a heading that only appeared
   once data arrived would leave an SSR response with no heading at all. */
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

/* Every count breakdown on this page is rendered from the payload's OWN keys - never a list
   re-typed here. The API zero-fills each grouped count from the DB's CHECK constraints, and that
   guarantee is only real if the UI iterates what the API sent: a breakdown driven by a local list
   would drop a value the DB admits later without a word. (Round 1 did exactly that - it listed
   `cancelled` for lots while the API seeds only intake/active/completed, so that row was drawn
   from a key the payload never contained.) Python's dict order carries through JSON and JS
   objects, so the API's lifecycle order is the display order, with any unexpected value appended
   rather than dropped. */
function Breakdown({ title, label, keyLabel, valueLabel, rows, renderKey }: {
  title: string;
  label: string;
  keyLabel: string;
  valueLabel: string;
  rows: [string, number][];
  renderKey?: (key: string) => ReactNode;
}) {
  return (
    <Card className="p-4">
      <Heading level="h3" className="mb-2">{title}</Heading>
      <Table label={label}>
        <THead><TH>{keyLabel}</TH><TH>{valueLabel}</TH></THead>
        <TBody>
          {rows.map(([key, n]) => (
            <TR key={key}>
              <TD>{renderKey ? renderKey(key) : <span className="text-ink-900">{key}</span>}</TD>
              <TD className="text-right tabular-nums">{n}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
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

      {msg && <div className={`rounded-control px-3 py-2 text-sm ${NOTICE_TONE}`}>{msg}</div>}

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
              <Breakdown title="Units by status" label="Units by status" keyLabel="Status" valueLabel="Units"
                         rows={Object.entries(data.inventory.by_status)}
                         renderKey={(s) => <Badge colorClass={statusTone(s)}>{s}</Badge>} />
              <Breakdown title="Units by grade" label="Units by grade" keyLabel="Grade" valueLabel="Units"
                         rows={Object.entries(data.inventory.by_grade)}
                         renderKey={(g) => <Badge colorClass={gradeTone(g)}>{g}</Badge>} />
              <Breakdown title="Lots by status" label="Lots by status" keyLabel="Status" valueLabel="Lots"
                         rows={Object.entries(data.lots.by_status)} />
            </div>
          </section>

          <section>
            <Heading level="h2" className="mb-2">Orders</Heading>
            <div className="grid gap-4 lg:grid-cols-3">
              <Breakdown title="Orders by state (30 days)" label="Orders by state, last 30 days"
                         keyLabel="State" valueLabel="Orders"
                         rows={Object.entries(data.orders.by_state)} />
            </div>
          </section>
        </>
      )}
    </main>
  );
}
