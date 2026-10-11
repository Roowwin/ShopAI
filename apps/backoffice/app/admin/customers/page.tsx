"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Badge, Button, Card, Heading, Input, Stat, Table, TBody, TD, TH, THead, TR } from "@/app/components/ui";
import { aud, when } from "@/lib/format";
import { requireRole, useMe } from "@/lib/session";
import { statusTone } from "@/lib/ui";

/* The customer list: email, display name, how many orders they place and what they have spent.

   READ-ONLY, and the strongest PII surface in the app: this page is a directory of names and
   addresses. The server door is require_roles("admin","manager") on every request; the client
   guard below is UX on top of it, so an under-privileged session never even fires the call.

   Orders count and lifetime spend arrive as one grouped aggregate per row from the API - this
   page never fans out a request per customer. */
const PAGE = 25;

type Customer = { id: number; public_id: string; email: string; display_name: string | null;
                  status: string; created_at: string; orders_count: number; lifetime_cents: number };
type Page = { total: number; customers: Customer[] };

export default function CustomersPage() {
  const { me, checked } = useMe();
  const allowed = requireRole(me, ["admin", "manager"]);
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Page | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setMsg("");
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    p.set("limit", String(PAGE));
    p.set("offset", String(offset));
    const r = await apiFetch("/staff/customers?" + p.toString());
    if (!r.ok) {
      setMsg(r.status === 403 ? "admin or manager role required" : "Could not load customers");
      setData(null);
      return;
    }
    setData(await r.json().catch(() => null));
  }, [q, offset]);

  useEffect(() => {
    if (!checked) { return; }
    if (!allowed) { setMsg("admin or manager role required"); return; }
    void load();
  }, [checked, allowed, load]);

  const rows = data?.customers ?? [];
  const total = data?.total ?? 0;
  const lifetime = rows.reduce((sum, c) => sum + c.lifetime_cents, 0);

  return (
    <main className="max-w-6xl mx-auto p-4 space-y-4 min-h-screen">
      <Heading level="h1">Customers</Heading>
      <p className="text-sm text-ink-500">
        Names and addresses from the storefront. Admin and manager only, on every request.
      </p>

      {msg && <Card className="p-4"><p className="text-sm text-ink-600">{msg}</p></Card>}

      {checked && allowed && (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            <Stat label="Customers" value={total} />
            <Stat label="On this page" value={rows.length} sub={`offset ${offset}`} />
            <Stat label="Lifetime spend on this page" value={aud(lifetime)} />
          </section>

          <Card className="p-4">
            <div className="w-72 mb-3">
              <Input placeholder="email or display name" value={q}
                     onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
            </div>
            <Table label="Customers">
              <THead><TH>Email</TH><TH>Name</TH><TH>Status</TH><TH>Orders</TH><TH>Lifetime</TH><TH>Joined</TH></THead>
              <TBody>
                {rows.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <a href={"/admin/customers/" + c.id} className="text-brand-700 hover:underline">{c.email}</a>
                    </TD>
                    <TD><span className="text-ink-900">{c.display_name || "-"}</span></TD>
                    <TD><Badge colorClass={statusTone(c.status)}>{c.status}</Badge></TD>
                    <TD className="text-right tabular-nums">{c.orders_count}</TD>
                    <TD className="text-right tabular-nums">{aud(c.lifetime_cents)}</TD>
                    <TD className="whitespace-nowrap"><span className="text-ink-500">{when(c.created_at)}</span></TD>
                  </TR>
                ))}
                {data && rows.length === 0 && (
                  <TR><TD colSpan={6}><span className="text-ink-500">No customers match.</span></TD></TR>
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
