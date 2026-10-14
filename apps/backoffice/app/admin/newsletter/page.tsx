"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Card, Heading, PageHeader, TBody, TD, TH, THead, TR, Table } from "@/app/components/ui";
import { requireRole, useMe } from "@/lib/session";
import { pageClass } from "@/lib/ui";

type Sub = { email: string; created_at: string };

function when(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

export default function NewsletterPage() {
  const { me, checked } = useMe();
  const allowed = requireRole(me, ["admin", "manager"]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [total, setTotal] = useState(0);
  const [msg, setMsg] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch("/staff/newsletter");
    if (!r.ok) {
      setMsg(r.status === 403 ? "admin or manager role required" : "Could not load subscribers");
      setLoaded(true);
      return;
    }
    const j: any = await r.json().catch(() => ({}));
    setSubs(j.subscribers ?? []);
    setTotal(j.total ?? 0);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!checked) { return; }
    if (!allowed) { setMsg("admin or manager role required"); setLoaded(true); return; }
    void load();
  }, [checked, allowed, load]);

  return (
    <main className={pageClass.wide}>
      <PageHeader title="Newsletter"
        description="Public signups from the storefront footer." />
      {msg && (<div className="rounded-control bg-accent-100 text-accent-700 px-3 py-2 mb-3 text-sm">{msg}</div>)}

      <Card className="p-4">
        <div className="flex items-baseline justify-between mb-2">
          <Heading level="h3" as="h2">Subscribers</Heading>
          <span className="text-sm text-ink-500">{total} total</span>
        </div>
        <Table label="Newsletter subscribers">
          <THead>
            <TH>Email</TH><TH>Subscribed</TH>
          </THead>
          <TBody>
            {subs.map((s) => (
              <TR key={s.email}>
                <TD>{s.email}</TD>
                <TD className="text-ink-500">{when(s.created_at)}</TD>
              </TR>
            ))}
            {loaded && subs.length === 0 && !msg && (
              <TR><TD colSpan={2} className="text-ink-500">No subscribers yet.</TD></TR>
            )}
          </TBody>
        </Table>
      </Card>
    </main>
  );
}
