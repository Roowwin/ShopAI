"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Badge, Button, Card, Heading, Input, Table, TBody, TD, TH, THead, TR } from "@/app/components/ui";
import { gradeTone, selectClass, statusTone } from "@/lib/ui";

type Lot = { id: number; lot_number: string; status: string; warehouse: string | null; asset_count: number };
type Draft = { brand: string; model: string; serial_visible: string; condition_notes: string; suggested_grade: string; confidence: string };

export default function IntakePage() {
  const [lots, setLots] = useState<Lot[]>([]);
  const [warehouse, setWarehouse] = useState("WH-A");
  const [notes, setNotes] = useState("");
  const [serial, setSerial] = useState("");
  const [lotId, setLotId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch("/staff/lots?limit=50");
    if (r.ok) { const j: Lot[] = await r.json(); setLots(j); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function createLot() {
    setErr(""); setMsg("");
    const r = await apiFetch("/staff/lots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ warehouse: warehouse || null, notes: notes || null }) });
    const j: any = await r.json().catch(() => ({}));
    if (r.status === 201) { setMsg("Created lot " + j.lot_number); setLotId(j.id); await load(); }
    else setErr(j.detail ?? "create failed");
  }

  async function scanIn() {
    setErr(""); setMsg("");
    if (lotId == null) { setErr("create or select a lot below first"); return; }
    if (!serial.trim()) { setErr("serial required"); return; }
    const r = await apiFetch("/staff/assets/scan-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lot_id: lotId, serial_number: serial.trim() }) });
    const j: any = await r.json().catch(() => ({}));
    if (r.status === 201) { setMsg("Scanned " + j.serial_number); setSerial(""); await load(); }
    else setErr(j.detail ?? "scan failed");
  }

  async function aiDraft(file: File | null) {
    if (!file) return;
    setAiBusy(true); setErr(""); setDraft(null);
    const fd = new FormData();
    fd.append("image", file);
    const r = await apiFetch("/staff/ai/intake-draft", { method: "POST", body: fd });
    if (r.ok) { setDraft(await r.json()); } else { const j: any = await r.json().catch(() => ({})); setErr(j.detail ?? "AI draft failed"); }
    setAiBusy(false);
  }

  function prefill() {
    if (!draft) return;
    if (draft.serial_visible) setSerial(draft.serial_visible.trim());
    setNotes("AI draft: " + draft.brand + " " + draft.model + " - " + draft.condition_notes + " (suggest grade " + draft.suggested_grade + ")");
  }

  return (
    <main className="max-w-3xl mx-auto pt-8 px-4 space-y-6">
      <Heading level="h1">Intake</Heading>

      <Card className="p-6 space-y-3">
        <Heading level="h3" as="h2">AI draft from photo</Heading>
        <p className="text-xs text-ink-500">The model only reads the photo - you confirm everything. Drafts never touch stock.</p>
        <div className="flex gap-3 items-center">
          <input type="file" accept="image/*" className="text-sm" onChange={(e) => aiDraft(e.target.files?.[0] ?? null)} />
          {aiBusy && <span className="text-ink-500 text-sm">Reading photo...</span>}
        </div>
        {draft && (
          <div className="rounded-control ring-1 ring-line bg-surface-muted p-4 space-y-1 text-sm">
            <p><b>{draft.brand}</b> {draft.model} <Badge className="ml-2" colorClass={gradeTone(draft.suggested_grade)}>grade {draft.suggested_grade}</Badge> <span className="text-xs text-ink-500">confidence {draft.confidence}</span></p>
            {draft.serial_visible && <p className="font-mono text-xs">serial seen: {draft.serial_visible}</p>}
            <p className="text-ink-600">{draft.condition_notes}</p>
            <Button size="sm" onClick={prefill}>Prefill scan-in</Button>
          </div>
        )}
      </Card>

      <Card className="p-6 space-y-3">
        <Heading level="h3" as="h2">New lot</Heading>
        <div className="flex gap-3">
          <div className="w-40">
            <Input placeholder="warehouse" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} />
          </div>
          <Input className="flex-1" placeholder="notes / supplier ref" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <Button onClick={createLot}>Create</Button>
        </div>
      </Card>

      <Card className="p-6 space-y-3">
        <Heading level="h3" as="h2">Scan-in</Heading>
        <div className="flex gap-3">
          <select className={selectClass} value={lotId ?? ""} onChange={(e) => setLotId(e.target.value ? parseInt(e.target.value) : null)}>
            <option value="">select lot...</option>
            {lots.map((l) => <option key={l.id} value={l.id}>{l.lot_number} ({l.status}, {l.asset_count} units)</option>)}
          </select>
          <Input className="flex-1" placeholder="serial number" value={serial} onChange={(e) => setSerial(e.target.value)} />
          <Button onClick={scanIn}>Scan</Button>
        </div>
      </Card>

      <Card className="p-6">
        <Table>
          <THead>
            <TH>Lot</TH><TH>Status</TH><TH>WH</TH><TH>Units</TH>
          </THead>
          <TBody>
            {lots.map((l) => (
              <TR key={l.id} className={"cursor-pointer " + (lotId === l.id ? "bg-brand-50" : "hover:bg-surface-muted")} onClick={() => setLotId(l.id)}>
                <TD className="font-mono">{l.lot_number}</TD>
                <TD><Badge colorClass={statusTone(l.status)}>{l.status}</Badge></TD>
                <TD>{l.warehouse}</TD>
                <TD>{l.asset_count}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      {msg && <p className="text-brand-700 text-sm">{msg}</p>}
      {err && <p className="text-danger-600 text-sm">{err}</p>}
    </main>
  );
}
