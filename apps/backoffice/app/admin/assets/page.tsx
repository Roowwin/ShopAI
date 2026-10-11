"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Badge, Button, Card, Heading, Input, Select, Table, TBody, TD, TH, THead, TR } from "@/app/components/ui";
import { gradeTone, statusTone } from "@/lib/ui";

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
      <Heading level="h1">Assets workbench</Heading>

      <div className="flex gap-3">
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">any status</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </Select>
        <div className="w-56">
          <Input placeholder="lot number" value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} />
        </div>
      </div>

      <Card className="p-4">
        <Table label="Assets">
          <THead>
            <TH>Serial</TH><TH>Status</TH><TH>Grade</TH><TH>Lot</TH>
          </THead>
          <TBody>
            {assets.map((a) => (
              <TR key={a.id} className={"cursor-pointer " + (sel?.id === a.id ? "bg-brand-50" : "hover:bg-surface-muted")} onClick={() => setSel(a)}>
                <TD className="font-mono">{a.serial_number}</TD>
                <TD><Badge colorClass={statusTone(a.status)}>{a.status}</Badge></TD>
                <TD>{a.grade ? <Badge colorClass={gradeTone(a.grade)}>{a.grade}</Badge> : null}</TD>
                <TD className="font-mono">{a.lot_number}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {assets.length === 0 && <p className="text-ink-500 text-sm pt-2">no assets match</p>}
      </Card>

      {sel && (
        <Card className="p-6 space-y-4">
          <Heading level="h3" as="h2">Selected: <span className="font-mono">{sel.serial_number}</span> <Badge className="ml-1" colorClass={statusTone(sel.status)}>{sel.status}</Badge></Heading>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <p className="text-sm text-ink-500">Transitions (DB trigger rejects illegal ones)</p>
              <Button variant="secondary" size="sm" onClick={() => act(() => apiFetch("/staff/assets/" + sel.id + "/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "tested" }) }), "tested")}>tested</Button>
              <Button variant="secondary" size="sm" onClick={() => act(() => apiFetch("/staff/assets/" + sel.id + "/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "listed" }) }), "listed")}>list for sale</Button>
              <Button variant="secondary" size="sm" onClick={() => act(() => apiFetch("/staff/assets/" + sel.id + "/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "in_repair" }) }), "in_repair")}>in_repair</Button>
              <Button variant="secondary" size="sm" onClick={() => act(() => apiFetch("/staff/assets/" + sel.id + "/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "sold" }) }), "sold")}>mark sold</Button>
            </div>
            <div className="space-y-2">
              <div className="flex gap-2 items-center">
                <Select value={grade} onChange={(e) => setGrade(e.target.value)}>{GRADES.map((g) => <option key={g}>{g}</option>)}</Select>
                <div className="w-28">
                  <Input placeholder="cost cents" value={cost} onChange={(e) => setCost(e.target.value)} />
                </div>
                <Button size="sm" onClick={() => act(() => apiFetch("/staff/assets/" + sel.id + "/grade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grade, ...(cost ? { cost_cents: parseInt(cost) } : {}) }) }), "graded")}>grade</Button>
              </div>
              <div className="flex gap-2 items-center">
                <div className="w-28">
                  <Input placeholder="price cents" value={price} onChange={(e) => setPrice(e.target.value)} />
                </div>
                <Button size="sm" onClick={() => act(() => apiFetch("/staff/assets/" + sel.id + "/price", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sale_price_cents: parseInt(price) }) }), "priced")}>price</Button>
              </div>
              <div className="flex gap-2 items-center">
                <div className="w-36">
                  <Input placeholder="location" value={location} onChange={(e) => setLocation(e.target.value)} />
                </div>
                <Button size="sm" onClick={() => act(() => apiFetch("/staff/assets/" + sel.id + "/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location }) }), "moved")}>move</Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {msg && <p className="text-brand-700 text-sm">{msg}</p>}
      {err && <p className="text-danger-600 text-sm">{err}</p>}
    </main>
  );
}
