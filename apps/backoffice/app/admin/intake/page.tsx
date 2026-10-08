"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

type Lot = { id: number; lot_number: string; status: string; warehouse: string | null; asset_count: number };

export default function IntakePage() {
  const [lots, setLots] = useState<Lot[]>([]);
  const [warehouse, setWarehouse] = useState("WH-A");
  const [notes, setNotes] = useState("");
  const [serial, setSerial] = useState("");
  const [lotId, setLotId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const r = await apiFetch("/staff/lots?limit=50");
    if (r.ok) { const j: Lot[] = await r.json(); setLots(j); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function createLot() {
    setErr(""); setMsg("");
    const r = await apiFetch("/staff/lots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ warehouse: warehouse || null, notes: notes || null }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (r.status === 201) { setMsg("Created lot " + j.lot_number); setLotId(j.id); await load(); }
    else setErr(j.detail ?? "create failed");
  }

  async function scanIn() {
    setErr(""); setMsg("");
    if (lotId == null) { setErr("create or select a lot below first"); return; }
    if (!serial.trim()) { setErr("serial required"); return; }
    const r = await apiFetch("/staff/assets/scan-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lot_id: lotId, serial_number: serial.trim() }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (r.status === 201) { setMsg("Scanned " + j.serial_number); setSerial(""); await load(); }
    else setErr(j.detail ?? "scan failed");
  }

  return (
    <main className="max-w-3xl mx-auto pt-8 px-4 space-y-6">
      <h1 className="text-xl font-semibold">Intake</h1>

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
          <button className="border rounded px-4 py-2 text-slate-400 cursor-not-allowed" title="Phase 11" disabled>
            AI: draft from photo
          </button>
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
