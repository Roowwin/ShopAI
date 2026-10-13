"use client";

/* Expenses: money out, recorded and corrected.

   EDITING IS A CORRECTION, NOT A DELETE AND RE-ADD. A cost that has already appeared in a statement
   somebody read has to be reconcilable against what the statement said, so the row changes and the
   amendment is audited with its before and after - which is why the API has a PATCH and no DELETE.
   The screen follows that: there is no remove control, because the honest fix for a wrong expense is
   a corrected expense with a trail, not a hole where a number used to be.

   THE EDIT WRITES ONLY WHAT CHANGED, because the API does. A row opened for edit and saved untouched
   sends nothing rather than all seven fields, so a re-save cannot re-date a cost that a period has
   already been reported on - and the form's state is the row's own values, not defaults, so nothing
   is silently replaced by an empty string.

   MONEY IS DOLLARS HERE AND CENTS IN THE API. `dollarsToCents` is the one conversion, and a blank is
   null rather than zero: a field nobody touched is "no filter", not a floor of $0. */

import { useCallback, useEffect, useState } from "react";

import { Badge, Button, Card, Heading, Input, Stat, Table, TBody, TD, TH, THead, TR, cn } from "@/app/components/ui";
import { apiFetch } from "@/lib/api";
import { aud } from "@/lib/format";
import { requireRole, useMe } from "@/lib/session";
import { kickerClass } from "@/lib/ui";

type Expense = {
  id: number; category: string; vendor: string | null; description: string | null;
  amount_cents: number; tax_cents: number; incurred_on: string | null; paid_at: string | null;
  created_at: string | null;
};

type Draft = { category: string; vendor: string; description: string; amount: string;
               tax: string; incurred_on: string; paid: boolean };

const PAGE = 25;

function dollarsToCents(v: string): number {
  const n = Number(v.trim() || "0");
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function centsToDollars(c: number): string {
  return (c / 100).toFixed(2);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyDraft(): Draft {
  return { category: "", vendor: "", description: "", amount: "", tax: "", incurred_on: todayISO(), paid: false };
}

function draftFrom(e: Expense): Draft {
  return { category: e.category, vendor: e.vendor ?? "", description: e.description ?? "",
           amount: centsToDollars(e.amount_cents), tax: centsToDollars(e.tax_cents),
           incurred_on: e.incurred_on ?? todayISO(), paid: e.paid_at !== null };
}

export default function ExpensesPage() {
  const { me, checked } = useMe();
  const allowed = requireRole(me, ["admin"]);

  const [rows, setRows] = useState<Expense[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [category, setCategory] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<number | null>(null);
  const [edit, setEdit] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setErr("");
    const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (category.trim()) p.set("category", category.trim());
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    const r = await apiFetch("/staff/finance/expenses?" + p.toString());
    if (!r.ok) {
      const j: any = await r.json().catch(() => ({}));
      setErr(typeof j?.detail === "string" ? j.detail : `Could not read expenses (${r.status})`);
      setRows([]); setLoaded(true); return;
    }
    const j: any = await r.json().catch(() => ({}));
    setRows(j.expenses ?? []); setTotal(j.total ?? 0); setLoaded(true);
  }, [offset, category, from, to]);

  useEffect(() => {
    if (!checked) return;
    if (!allowed) { setLoaded(true); return; }
    void load();
  }, [checked, allowed, load]);

  async function detail(r: Response, fallback: string) {
    const j: any = await r.json().catch(() => ({}));
    return typeof j?.detail === "string" ? j.detail : `${fallback} (${r.status})`;
  }

  async function add() {
    if (busy) return;
    setErr(""); setMsg("");
    if (!draft.category.trim()) { setErr("a category is required"); return; }
    setBusy(true);
    try {
      const r = await apiFetch("/staff/finance/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: draft.category.trim(),
          vendor: draft.vendor.trim() || null,
          description: draft.description.trim() || null,
          amount_cents: dollarsToCents(draft.amount),
          tax_cents: dollarsToCents(draft.tax),
          incurred_on: draft.incurred_on || null,
          paid: draft.paid,
        }),
      });
      if (!r.ok) { setErr(await detail(r, "the expense was refused")); return; }
      setMsg(`Recorded ${aud(dollarsToCents(draft.amount))} of ${draft.category.trim()}.`);
      setDraft(emptyDraft());
      setOffset(0);
      await load();
    } finally {
      setBusy(false);
    }
  }

  /* Only the fields whose input differs from the stored row are sent. That is what keeps a re-save
     from rewriting everything - and it means an edit made purely to look at the row costs nothing. */
  function changesFrom(e: Expense, d: Draft): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (d.category.trim() !== e.category) out.category = d.category.trim();
    if ((d.vendor.trim() || null) !== (e.vendor ?? null)) out.vendor = d.vendor.trim() || null;
    if ((d.description.trim() || null) !== (e.description ?? null)) out.description = d.description.trim() || null;
    if (dollarsToCents(d.amount) !== e.amount_cents) out.amount_cents = dollarsToCents(d.amount);
    if (dollarsToCents(d.tax) !== e.tax_cents) out.tax_cents = dollarsToCents(d.tax);
    if ((d.incurred_on || null) !== (e.incurred_on ?? null)) out.incurred_on = d.incurred_on || null;
    if (d.paid !== (e.paid_at !== null)) out.paid = d.paid;
    return out;
  }

  async function save(e: Expense) {
    if (busy) return;
    setErr(""); setMsg("");
    const changes = changesFrom(e, edit);
    if (Object.keys(changes).length === 0) { setEditing(null); return; }
    setBusy(true);
    try {
      const r = await apiFetch(`/staff/finance/expenses/${e.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      if (!r.ok) { setErr(await detail(r, "the correction was refused")); return; }
      setMsg(`Corrected ${Object.keys(changes).join(", ")} on expense #${e.id}.`);
      setEditing(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!checked || !loaded) {
    return <main className="mx-auto max-w-6xl px-4 pt-8 pb-16"><p className="text-sm text-ink-500">Loading...</p></main>;
  }
  if (!allowed) {
    return (
      <main className="mx-auto max-w-6xl px-4 pt-8 pb-16">
        <Card className="p-6">
          <Heading level="h3" as="h2">Expenses</Heading>
          <p className="mt-2 text-sm text-ink-500">The books are an administrator&apos;s screen.</p>
        </Card>
      </main>
    );
  }

  const pageValue = rows.reduce((s, e) => s + e.amount_cents, 0);

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 pt-8 pb-16">
      <div>
        <Heading level="h1">Expenses</Heading>
        <p className="mt-1 text-sm text-ink-500">
          What the business spent, by when it was incurred. These are the operating expenses the
          profit and loss statement nets against gross profit.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label="Expenses matching" value={total} sub="the current filters" />
        <Stat label="On this page" value={rows.length} sub={`offset ${offset}`} />
        <Stat label="Value on this page" value={aud(pageValue)} />
      </section>

      {msg && <p className="text-sm text-brand-300">{msg}</p>}
      {err && <p className="text-sm text-danger-600">{err}</p>}

      <Card className="p-6">
        <Heading level="h3" as="h2" className="mb-4">Record an expense</Heading>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <label htmlFor="n-cat" className={cn(kickerClass, "block pb-1")}>Category</label>
            <Input id="n-cat" value={draft.category} placeholder="Freight, Rent, Packaging…"
                   onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
          </div>
          <div>
            <label htmlFor="n-amt" className={cn(kickerClass, "block pb-1")}>Amount ($)</label>
            <Input id="n-amt" inputMode="decimal" placeholder="0.00" value={draft.amount}
                   onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
          </div>
          <div>
            <label htmlFor="n-tax" className={cn(kickerClass, "block pb-1")}>GST in that ($)</label>
            <Input id="n-tax" inputMode="decimal" placeholder="0.00" value={draft.tax}
                   onChange={(e) => setDraft({ ...draft, tax: e.target.value })} />
          </div>
          <div>
            <label htmlFor="n-on" className={cn(kickerClass, "block pb-1")}>Incurred on</label>
            <Input id="n-on" type="date" value={draft.incurred_on}
                   onChange={(e) => setDraft({ ...draft, incurred_on: e.target.value })} />
          </div>
          <div>
            <label htmlFor="n-ven" className={cn(kickerClass, "block pb-1")}>Vendor</label>
            <Input id="n-ven" value={draft.vendor}
                   onChange={(e) => setDraft({ ...draft, vendor: e.target.value })} />
          </div>
          <div>
            <label htmlFor="n-desc" className={cn(kickerClass, "block pb-1")}>Description</label>
            <Input id="n-desc" value={draft.description}
                   onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" checked={draft.paid}
                   onChange={(e) => setDraft({ ...draft, paid: e.target.checked })}
                   className="h-4 w-4 rounded border-line text-brand-700 focus:ring-2 focus:ring-brand-700" />
            Already paid
          </label>
          <Button onClick={() => { void add(); }} disabled={busy}>
            {busy ? "Saving..." : "Record expense"}
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-3 grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="e-from" className={cn(kickerClass, "block pb-1")}>From</label>
            <Input id="e-from" type="date" value={from}
                   onChange={(e) => { setFrom(e.target.value); setOffset(0); }} />
          </div>
          <div>
            <label htmlFor="e-to" className={cn(kickerClass, "block pb-1")}>To</label>
            <Input id="e-to" type="date" value={to}
                   onChange={(e) => { setTo(e.target.value); setOffset(0); }} />
          </div>
          <div>
            <label htmlFor="e-cat" className={cn(kickerClass, "block pb-1")}>Category</label>
            <Input id="e-cat" value={category} placeholder="any"
                   onChange={(e) => { setCategory(e.target.value); setOffset(0); }} />
          </div>
        </div>

        <Table label="Recorded expenses">
          <THead>
            <TH>Incurred</TH><TH>Category</TH><TH>Vendor</TH><TH>Description</TH>
            <TH className="text-right">Amount</TH><TH className="text-right">GST</TH>
            <TH>Paid</TH><TH>Actions</TH>
          </THead>
          <TBody>
            {rows.map((e) => {
              const open = editing === e.id;
              return (
                <TR key={e.id}>
                  {open ? (
                    <>
                      <TD><Input type="date" aria-label="Incurred on" value={edit.incurred_on}
                                 onChange={(ev) => setEdit({ ...edit, incurred_on: ev.target.value })} /></TD>
                      <TD><Input aria-label="Category" value={edit.category}
                                 onChange={(ev) => setEdit({ ...edit, category: ev.target.value })} /></TD>
                      <TD><Input aria-label="Vendor" value={edit.vendor}
                                 onChange={(ev) => setEdit({ ...edit, vendor: ev.target.value })} /></TD>
                      <TD><Input aria-label="Description" value={edit.description}
                                 onChange={(ev) => setEdit({ ...edit, description: ev.target.value })} /></TD>
                      <TD><Input aria-label="Amount in dollars" inputMode="decimal" value={edit.amount}
                                 onChange={(ev) => setEdit({ ...edit, amount: ev.target.value })} /></TD>
                      <TD><Input aria-label="GST in dollars" inputMode="decimal" value={edit.tax}
                                 onChange={(ev) => setEdit({ ...edit, tax: ev.target.value })} /></TD>
                      <TD>
                        <input type="checkbox" aria-label="Paid" checked={edit.paid}
                               onChange={(ev) => setEdit({ ...edit, paid: ev.target.checked })}
                               className="h-4 w-4 rounded border-line text-brand-700" />
                      </TD>
                      <TD>
                        <div className="flex items-center gap-2">
                          <Button variant="secondary" size="sm" disabled={busy}
                                  onClick={() => { void save(e); }}>Save</Button>
                          <Button variant="muted" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                        </div>
                      </TD>
                    </>
                  ) : (
                    <>
                      <TD className="text-ink-500">{e.incurred_on ?? "-"}</TD>
                      <TD className="text-ink-900">{e.category}</TD>
                      <TD className="text-ink-600">{e.vendor || "-"}</TD>
                      <TD className="text-ink-600">{e.description || "-"}</TD>
                      <TD className="text-right tabular-nums font-medium">{aud(e.amount_cents)}</TD>
                      <TD className="text-right tabular-nums text-ink-600">{aud(e.tax_cents)}</TD>
                      <TD>
                        {e.paid_at
                          ? <Badge colorClass="bg-status-sold-soft text-status-sold-ink">paid</Badge>
                          : <span className="text-ink-500">unpaid</span>}
                      </TD>
                      <TD>
                        <Button variant="muted" size="inline"
                                onClick={() => { setEditing(e.id); setEdit(draftFrom(e)); setErr(""); setMsg(""); }}>
                          Edit
                        </Button>
                      </TD>
                    </>
                  )}
                </TR>
              );
            })}
            {rows.length === 0 && !err && (
              <TR><TD colSpan={8} className="text-ink-500">No expenses match these filters.</TD></TR>
            )}
          </TBody>
        </Table>

        <div className="mt-3 flex items-center justify-between">
          <Button variant="muted" size="sm" disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
          <span className="text-xs text-ink-500">
            {total === 0 ? "nothing to show" : `${offset + 1}-${Math.min(offset + PAGE, total)} of ${total}`}
          </span>
          <Button variant="muted" size="sm" disabled={offset + PAGE >= total}
                  onClick={() => setOffset(offset + PAGE)}>Next</Button>
        </div>
        <p className="mt-3 text-xs text-ink-500">
          A correction rewrites the row and records what it was - there is no delete, because a cost a
          statement already reported has to stay reconcilable against it.
        </p>
      </Card>
    </main>
  );
}
