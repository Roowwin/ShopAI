"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

type Asset = { id: number; public_id: string; serial_number: string | null; status: string; grade: string | null; lot_number: string };

const GRADES = ["A", "B", "C", "D"];
const STATUSES = ["received", "tested", "in_repair", "graded", "listed", "reserved", "sold", "shipped", "returned", "scrapped"];

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [status, setStatus] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [sel, setSel] = useState<Asset | null>(null);
  const [grade, setGrade] = useState("A");
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("19900");
  const [location, setLocation] = useState("WH-A-01-01");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (lotNumber) p.set("lot_number", lotNumber);
    p.set("limit", "50");
    const r = await apiFetch("/staff/assets?" + p.toString());
    if (r.ok) { const j: Asset[] = await r.json(); setAssets(j); }
  }, [status, lotNumber]);
  useEffect(() => { load(); }, [load]);

  async function act(fn: () => Promise<Response>, label: string) {
    setErr(""); setMsg("");
    const r = await fn();
    if (r.status === 200 || r.status === 201) { setMsg(label + " ok"); await load(); }
    else {
      const j: any = await r.json().catch(() => ({}));
      setErr(j.detail ?? (label + " failed (" + r.status + ")"));
    }
  }

  return (
    <main className="max-w-4xl mx-auto pt-8 px-4 space-y-6">
      <h1 className="text-xl font-semibold">Assets workbench</h1>

      <div className="flex gap-3">
        <select className="border rounded px-3 py-2" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">any status</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <input className="border rounded px-3 py-2" placeholder="lot number" value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} />
      </div>

      <div className="bg-white rounded-xl shadow p-4">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-500"><th className="pb-2">Serial</th><th>Status</th><th>Grade</th><th>Lot</th></tr></thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.id} className={"cursor-pointer border-t " + (sel?.id === a.id ? "bg-slate-100" : "hover:bg-slate-50")} onClick={() => setSel(a)}>
                <td className="py-2 font-mono">{a.serial_number}</td>
                <td>{a.status}</td>
                <td>{a.grade}</td>
                <td className="font-mono">{a.lot_number}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {assets.length === 0 && <p className="text-slate-500 text-sm pt-2">no assets match</p>}
      </div>

      {sel && (
        <div className="bg-white rounded-xl shadow p-6 space-y-4">
          <h2 className="font-medium">Selected: <span className="font-mono">{sel.serial_number}</span> <span className="text-xs bg-slate-200 rounded px-2 py-0.5 ml-1">{sel.status}</span></h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <p className="text-sm text-slate-500">Transitions (DB trigger rejects illegal ones)</p>
              <button className="border rounded px-3 py-1.5" onClick={() => act(() => apiFetch("/staff/assets/" + sel.id + "/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "tested" }) }), "tested")}>tested</button>
              <button className="border rounded px-3 py-1.5" onClick={() => act(() => apiFetch("/staff/assets/" + sel.id + "/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "listed" }) }), "listed")}>list for sale</button>
              <button className="border rounded px-3 py-1.5" onClick={() => act(() => apiFetch("/staff/assets/" + sel.id + "/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "in_repair" }) }), "in_repair")}>in_repair</button>
              <button className="border rounded px-3 py-1.5" onClick={() => act(() => apiFetch("/staff/assets/" + sel.id + "/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "sold" }) }), "sold")}>mark sold</button>
            </div>
            <div className="space-y-2">
              <div className="flex gap-2 items-center">
                <select className="border rounded px-2 py-1.5" value={grade} onChange={(e) => setGrade(e.target.value)}>{GRADES.map((g) => <option key={g}>{g}</option>)}</select>
                <input className="border rounded px-2 py-1.5 w-28" placeholder="cost cents" value={cost} onChange={(e) => setCost(e.target.value)} />
                <button className="bg-slate-900 text-white rounded px-3 py-1.5" onClick={() => act(() => apiFetch("/staff/assets/" + sel.id + "/grade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grade, ...(cost ? { cost_cents: parseInt(cost) } : {}) }) }), "graded")}>grade</button>
              </div>
              <div className="flex gap-2 items-center">
                <input className="border rounded px-2 py-1.5 w-28" placeholder="price cents" value={price} onChange={(e) => setPrice(e.target.value)} />
                <button className="bg-slate-900 text-white rounded px-3 py-1.5" onClick={() => act(() => apiFetch("/staff/assets/" + sel.id + "/price", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sale_price_cents: parseInt(price) }) }), "priced")}>price</button>
              </div>
              <div className="flex gap-2 items-center">
                <input className="border rounded px-2 py-1.5 w-36" placeholder="location" value={location} onChange={(e) => setLocation(e.target.value)} />
                <button className="bg-slate-900 text-white rounded px-3 py-1.5" onClick={() => act(() => apiFetch("/staff/assets/" + sel.id + "/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location }) }), "moved")}>move</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {msg && <p className="text-green-700 text-sm">{msg}</p>}
      {err && <p className="text-red-600 text-sm">{err}</p>}
    </main>
  );
}