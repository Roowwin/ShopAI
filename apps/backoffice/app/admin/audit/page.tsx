"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Badge, Button, Card, Heading, PageHeader, Select, Stat, Table, TBody, TD, TH, THead, TR } from "@/app/components/ui";
import { when } from "@/lib/format";
import { requireRole, useMe } from "@/lib/session";
import { MUTED_TONE } from "@/app/components/dashboard/tokens";

/* The audit browser: every recorded action, with the state it moved between.

   READ-ONLY by construction - the audit table is append-only at the DB level, so a row here can
   never be an action affordance.

   THE THREE JSON COLUMNS (before / after / meta) ARE RENDERED VERBATIM, and that is a decision
   backed by a query rather than an assumption: across every audit row in the live database the
   distinct key set is active, brand, confidence, count, country, cta_label, deal_of_month,
   description, grade, hero_sub, hero_title, hold, image_url, kind, location, lot, lot_number,
   model, name, note, ref, sale_price_cents, serial, simulated, slug, status, title, total_cents,
   units and value. The customer-scoped entities carry only non-personal keys, the only `name`
   belongs to a promotion, and a scan for an email shape and one for an address shape both
   matched nothing. There is nothing to redact, so every column is shown - omitting one here would
   cost the browser its whole point. If that ever changes, this is the file to revisit.

   The filter option lists are accumulated from the payload's own values (never a re-typed enum),
   so an entity or action the API starts emitting shows up in the picker without an edit here. */
const PAGE = 25;

type Entry = { id: number; at: string; actor_type: string; actor_id: number | null;
               entity: string; entity_id: number | null; action: string;
               before: unknown; after: unknown; meta: unknown };
type Page = { total: number; entries: Entry[] };

function Json({ value }: { value: unknown }) {
  if (value == null) { return <span className="text-ink-500">-</span>; }
  return <span className="font-mono text-xs text-ink-600 break-all">{JSON.stringify(value)}</span>;
}

function Cell({ children }: { children: ReactNode }) {
  return <span className="text-ink-900">{children}</span>;
}

export default function AuditPage() {
  const { me, checked } = useMe();
  const allowed = requireRole(me, ["admin", "manager"]);
  const [entity, setEntity] = useState("");
  const [actorType, setActorType] = useState("");
  const [action, setAction] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Page | null>(null);
  const [seen, setSeen] = useState<{ entity: string[]; actor: string[]; action: string[] }>(
    { entity: [], actor: [], action: [] });
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setMsg("");
    const p = new URLSearchParams();
    if (entity) p.set("entity", entity);
    if (actorType) p.set("actor_type", actorType);
    if (action) p.set("action", action);
    p.set("limit", String(PAGE));
    p.set("offset", String(offset));
    const r = await apiFetch("/staff/audit?" + p.toString());
    if (!r.ok) {
      setMsg(r.status === 403 ? "admin or manager role required" : "Could not load the audit log");
      setData(null);
      return;
    }
    const j: Page | null = await r.json().catch(() => null);
    setData(j);
    // Grow the picker options from what the API actually sent - a union across loads, so applying
    // a filter never removes the other values from the picker.
    setSeen((prev) => {
      const merge = (old: string[], next: string[]) => Array.from(new Set(old.concat(next))).sort();
      const entries = j?.entries ?? [];
      return { entity: merge(prev.entity, entries.map((e) => e.entity)),
               actor: merge(prev.actor, entries.map((e) => e.actor_type)),
               action: merge(prev.action, entries.map((e) => e.action)) };
    });
  }, [entity, actorType, action, offset]);

  useEffect(() => {
    if (!checked) { return; }
    if (!allowed) { setMsg("admin or manager role required"); return; }
    void load();
  }, [checked, allowed, load]);

  const rows = data?.entries ?? [];
  const total = data?.total ?? 0;
  const byEntity: Record<string, number> = {};
  for (const e of rows) { byEntity[e.entity] = (byEntity[e.entity] ?? 0) + 1; }

  return (
    <main className="max-w-6xl mx-auto p-4 space-y-4 min-h-screen">
      <PageHeader
        title={<>Audit</>}
        description={<>Append-only history. Read-only here - nothing on this page writes.</>}
      />

      {msg && <Card className="p-4"><p className="text-sm text-ink-600">{msg}</p></Card>}

      {checked && allowed && (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            <Stat label="Entries matching" value={total} />
            <Stat label="On this page" value={rows.length} sub={`offset ${offset}`} />
            <Stat label="Entities on this page" value={Object.keys(byEntity).length} />
          </section>

          <Card className="p-4">
            <Heading level="h3" as="h2" className="mb-2">On this page, by entity</Heading>
            <Table label="Audit entries on this page by entity">
              <THead><TH>Entity</TH><TH>Entries</TH></THead>
              <TBody>
                {Object.entries(byEntity).map(([name, n]) => (
                  <TR key={name}>
                    <TD><Cell>{name}</Cell></TD>
                    <TD className="text-right tabular-nums">{n}</TD>
                  </TR>
                ))}
                {Object.entries(byEntity).length === 0 && (
                  <TR><TD colSpan={2}><span className="text-ink-500">Nothing on this page.</span></TD></TR>
                )}
              </TBody>
            </Table>
          </Card>

          <Card className="p-4">
            <div className="flex flex-wrap gap-3 mb-3">
              <Select value={entity} onChange={(e) => { setEntity(e.target.value); setOffset(0); }}>
                <option value="">any entity</option>
                {seen.entity.map((v) => <option key={v} value={v}>{v}</option>)}
              </Select>
              <Select value={actorType} onChange={(e) => { setActorType(e.target.value); setOffset(0); }}>
                <option value="">any actor</option>
                {seen.actor.map((v) => <option key={v} value={v}>{v}</option>)}
              </Select>
              <Select value={action} onChange={(e) => { setAction(e.target.value); setOffset(0); }}>
                <option value="">any action</option>
                {seen.action.map((v) => <option key={v} value={v}>{v}</option>)}
              </Select>
            </div>
            <Table label="Audit log">
              <THead>
                <TH>When</TH><TH>Actor</TH><TH>Entity</TH><TH>Action</TH>
                <TH>Before</TH><TH>After</TH><TH>Meta</TH>
              </THead>
              <TBody>
                {rows.map((e) => (
                  <TR key={e.id}>
                    <TD className="whitespace-nowrap"><span className="text-ink-500">{when(e.at)}</span></TD>
                    <TD>
                      <Badge colorClass={MUTED_TONE}>
                        {e.actor_type}{e.actor_id != null ? ` · ${e.actor_id}` : ""}
                      </Badge>
                    </TD>
                    <TD className="font-mono text-xs">
                      <span className="text-ink-600">{e.entity}{e.entity_id != null ? ` #${e.entity_id}` : ""}</span>
                    </TD>
                    <TD><Cell>{e.action}</Cell></TD>
                    <TD><Json value={e.before} /></TD>
                    <TD><Json value={e.after} /></TD>
                    <TD><Json value={e.meta} /></TD>
                  </TR>
                ))}
                {data && rows.length === 0 && (
                  <TR><TD colSpan={7}><span className="text-ink-500">No audit entries match.</span></TD></TR>
                )}
              </TBody>
            </Table>
            <div className="flex items-center justify-between pt-3">
              <span className="text-sm text-ink-500">
                {rows.length === 0 ? 0 : offset + 1}-{offset + rows.length} of {total}
              </span>
              <span className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={offset === 0}
                        onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
                <Button variant="secondary" size="sm" disabled={offset + rows.length >= total}
                        onClick={() => setOffset(offset + PAGE)}>Next</Button>
              </span>
            </div>
          </Card>
        </>
      )}
    </main>
  );
}
