"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

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
      <h1 className="text-xl font-semibold">Intake</h1>

      <div className="bg-white rounded-xl shadow p-6 space-y-3">
        <h2 className="font-medium">AI draft from photo</h2>
        <p className="text-xs text-slate-500">The model only reads the photo - you confirm everything. Drafts never touch stock.</p>
        <div className="flex gap-3 items-center">
          <input type="file" accept="image/*" className="text-sm" onChange={(e) => aiDraft(e.target.files?.[0] ?? null)} />
          {aiBusy && <span className="text-slate-500 text-sm">Reading photo...</span>}
        </div>
        {draft && (
          <div className="border rounded-lg p-4 bg-slate-50 space-y-1 text-sm">
            <p><b>{draft.brand}</b> {draft.model} <span className="ml-2 text-xs bg-slate-200 rounded px-2 py-0.5">grade {draft.suggested_grade}</span> <span className="text-xs text-slate-500">confidence {draft.confidence}</span></p>
            {draft.serial_visible && <p className="font-mono text-xs">serial seen: {draft.serial_visible}</p>}
            <p className="text-slate-600">{draft.condition_notes}</p>
            <button className="bg-slate-900 text-white rounded px-3 py-1.5" onClick={prefill}>Prefill scan-in</button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow p-6 space-y-3">
        <h2 className="font-medium">New lot</h2>
        <div className="flex gap-3">
          <input className="border rounded px-3 py-2 w-40" placeholder="warehouse" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} />
          <input className="border rounded px-3 py-2 flex-1" placeholder="notes / supplier ref" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button className="bg-slate-900 text-white rounded px-4 py-2" onClick={createLot}>Create</button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow p-6 space-y-3">
        <h2 className="font-medium">Scan-in</h2>
        <div className="flex gap-3">
          <select className="border rounded px-3 py-2" value={lotId ?? ""} onChange={(e) => setLotId(e.target.value ? parseInt(e.target.value) : null)}>
            <option value="">select lot...</option>
            {lots.map((l) => <option key={l.id} value={l.id}>{l.lot_number} ({l.status}, {l.asset_count} units)</option>)}
          </select>
          <input className="border rounded px-3 py-2 flex-1" placeholder="serial number" value={serial} onChange={(e) => setSerial(e.target.value)} />
          <button className="bg-slate-900 text-white rounded px-4 py-2" onClick={scanIn}>Scan</button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow p-6">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-500"><th className="pb-2">Lot</th><th>Status</th><th>WH</th><th>Units</th></tr></thead>
          <tbody>
            {lots.map((l) => (
              <tr key={l.id} className={"cursor-pointer border-t " + (lotId === l.id ? "bg-slate-100" : "hover:bg-slate-50")} onClick={() => setLotId(l.id)}>
                <td className="py-2 font-mono">{l.lot_number}</td>
                <td>{l.status}</td>
                <td>{l.warehouse}</td>
                <td>{l.asset_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {msg && <p className="text-green-700 text-sm">{msg}</p>}
      {err && <p className="text-red-600 text-sm">{err}</p>}
    </main>
  );
}
