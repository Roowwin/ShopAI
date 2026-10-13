"use client";

/* Settings & System - starting with the business's own LEGAL IDENTITY.

   WHY THIS PAGE EXISTS. Every other field on a tax invoice is derived from the sale: the customer,
   the address, the lines and the amounts all come from the order. The seller's legal name, ABN and
   registered address come from nowhere the platform can work out, which is why the invoice screen
   carried a note saying they did not exist. This is the store that note was waiting for.

   WHAT IS SAVED HERE PRINTS ON EVERY INVOICE. That is the whole of its purpose, so the page says so
   plainly rather than presenting four anonymous boxes - an operator editing "Contact email" should
   know it is the address a customer's accounts department will write to.

   A BLANK FIELD IS OMITTED, NOT FABRICATED. Only the legal name is required (a tax invoice that
   does not name its seller is not a tax invoice); the document renders whatever is set and simply
   leaves out what is not, which is why an ABN nobody has entered shows nothing rather than a
   placeholder standing in for a real registration number. */

import { useCallback, useEffect, useState } from "react";

import { Button, Card, Input, PageHeader, cn } from "@/app/components/ui";
import { apiFetch } from "@/lib/api";
import { requireRole, useMe } from "@/lib/session";
import { kickerClass } from "@/lib/ui";

type Identity = { legal_name: string; tax_id: string; address: string; email: string };

const BLANK: Identity = { legal_name: "", tax_id: "", address: "", email: "" };

/* The multi-line field. There is no Textarea primitive in the design system, so this is Input's own
   recipe (surface fill, hairline ring, the 36px control padding relaxed to `py-2`) on a <textarea> -
   the address is the one field here that is legitimately several lines. */
const AREA_CLASS =
  "mt-1 w-full rounded-control bg-surface px-4 py-2 text-sm text-ink-900 ring-1 ring-line " +
  "outline-none transition placeholder:text-ink-500 focus:ring-2 focus:ring-brand-700";

export default function SettingsPage() {
  const { me, checked } = useMe();
  const allowed = requireRole(me, ["admin", "manager"]);
  const canWrite = requireRole(me, ["admin"]);

  const [form, setForm] = useState<Identity>(BLANK);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const r = await apiFetch("/staff/settings/identity");
    if (!r.ok) {
      const j: any = await r.json().catch(() => ({}));
      setErr(typeof j?.detail === "string" ? j.detail
        : r.status === 403 ? "Settings are an administrator's screen" : `Could not read settings (${r.status})`);
      setLoaded(true);
      return;
    }
    const j: any = await r.json().catch(() => ({}));
    setForm({ ...BLANK, ...(j?.identity ?? {}) });
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!checked) return;
    if (!allowed) { setLoaded(true); return; }
    void load();
  }, [checked, allowed, load]);

  function field(key: keyof Identity) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function save() {
    setBusy(true); setMsg(""); setErr("");
    const r = await apiFetch("/staff/settings/identity", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const j: any = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      setErr(typeof j?.detail === "string" ? j.detail : `Could not save (${r.status})`);
      return;
    }
    setForm({ ...BLANK, ...(j?.identity ?? {}) });
    setMsg("Saved. Every invoice issued from now on names this business.");
  }

  if (!checked || !loaded) {
    return <main className="mx-auto max-w-2xl px-4 pt-10"><p className="text-sm text-ink-500">Loading...</p></main>;
  }
  if (!allowed) {
    return (
      <main className="mx-auto max-w-2xl px-4 pt-10">
        <p className="text-sm text-danger-600">{err || "Settings are an administrator's screen."}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pt-10 pb-24">
      <PageHeader
        title={<>Settings &amp; System</>}
        description={<>The business&apos;s own details, as they appear on the documents customers receive.</>}
      />

      <Card className="mt-6 p-6">
        <p className={cn(kickerClass, "block")}>Business legal identity</p>
        <p className="mt-2 text-sm text-ink-600">
          This is the seller block at the top of every tax invoice. Only the legal name is required;
          leave anything that does not apply blank and it is left off the document rather than
          filled in with something invented.
        </p>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className={cn(kickerClass, "block")}>Business legal name</span>
            <Input className="mt-1" value={form.legal_name} onChange={field("legal_name")}
                   disabled={!canWrite} placeholder="e.g. RFO Pty Ltd" autoComplete="organization" />
          </label>

          <label className="block">
            <span className={cn(kickerClass, "block")}>ABN / Tax ID</span>
            <Input className="mt-1" value={form.tax_id} onChange={field("tax_id")}
                   disabled={!canWrite} placeholder="e.g. 12 345 678 901" inputMode="numeric" />
          </label>

          <label className="block">
            <span className={cn(kickerClass, "block")}>Registered address</span>
            <textarea className={AREA_CLASS} rows={3} value={form.address} onChange={field("address")}
                      disabled={!canWrite} placeholder={"1 Example St\nSydney NSW 2000\nAustralia"} />
          </label>

          <label className="block">
            <span className={cn(kickerClass, "block")}>Contact email</span>
            <Input className="mt-1" type="email" value={form.email} onChange={field("email")}
                   disabled={!canWrite} placeholder="accounts@example.com" autoComplete="email" />
          </label>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button onClick={save} disabled={busy || !canWrite}>
            {busy ? "Saving..." : "Save identity"}
          </Button>
          {!canWrite && <span className="text-xs text-ink-500">Only an administrator can change these.</span>}
          {msg && <span className="text-sm text-ink-600">{msg}</span>}
          {err && <span className="text-sm text-danger-600">{err}</span>}
        </div>
      </Card>
    </main>
  );
}
