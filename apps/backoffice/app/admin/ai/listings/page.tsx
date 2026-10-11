"use client";

import { useEffect, useState } from "react";
import { API, apiFetch } from "@/lib/api";
import { Button, Card, Heading } from "@/app/components/ui";
import { selectClass } from "@/lib/ui";

type Cat = { id: number; slug: string; title: string };

export default function ListingsPage() {
  const [cat, setCat] = useState<Cat[]>([]);
  const [pid, setPid] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ title: string; description: string; keywords: string[] } | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(API + "/store/catalog", { credentials: "include" }).then(async (r) => { if (r.ok) setCat(await r.json()); });
  }, []);

  async function draftIt() {
    if (pid == null) return;
    setBusy(true); setMsg(""); setDraft(null);
    const r = await apiFetch("/staff/ai/description-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product_id: pid }) });
    if (r.ok) setDraft(await r.json()); else { const j: any = await r.json().catch(() => ({})); setMsg("error: " + (j.detail ?? r.status)); }
    setBusy(false);
  }

  async function approve() {
    if (!draft || pid == null) return;
    setBusy(true);
    const r = await apiFetch("/staff/products/" + pid + "/listing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: draft.title, description: draft.description }) });
    setMsg(r.ok ? "PUBLISHED (audit-logged). Refresh the storefront product page to see it." : ("error: " + r.status));
    setBusy(false);
  }

  return (
    <main className="max-w-2xl mx-auto pt-8 px-4 space-y-4">
      <Heading level="h1">AI listings (human-approved)</Heading>
      <p className="text-xs text-ink-500">Drafts use verified product facts only - you approve before anything publishes (ACCC-safe wording rule).</p>
      <Card className="p-6 space-y-3">
        <select className={selectClass + " w-full"} value={pid ?? ""} onChange={(e) => setPid(e.target.value ? parseInt(e.target.value) : null)}>
          <option value="">choose product...</option>
          {cat.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <Button onClick={draftIt} disabled={busy || pid == null}>Generate draft</Button>
      </Card>
      {draft && (
        <Card className="p-6 space-y-2">
          <p className="font-medium">{draft.title}</p>
          <p className="text-sm text-ink-700 whitespace-pre-line">{draft.description}</p>
          <p className="text-xs text-ink-400">{(draft.keywords ?? []).join(" | ")}</p>
          <Button onClick={approve} disabled={busy}>Approve &amp; publish</Button>
        </Card>
      )}
      {msg && <p className="text-sm text-ink-600">{msg}</p>}
    </main>
  );
}
