"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

type Proposal = { action: string; args: any; message: string };
type Msg = { role: "you" | "ai"; text: string; proposal?: Proposal; executed?: boolean; results?: any[] };
type Chip = { chip: string; message: string };

export default function AssistantPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [chips, setChips] = useState<Chip[]>([]);

  useEffect(() => {
    apiFetch("/staff/ai/suggestions")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((j) => setChips(Array.isArray(j.items) ? j.items : []))
      .catch(() => {});
  }, []);

  async function turn(message: string, opts?: { execute?: boolean; action?: string; args?: any }) {
    if (!message || busy) return;
    setMsgs((m) => [...m, { role: "you", text: message }]);
    setBusy(true);
    try {
      const body: any = { message };
      if (opts && opts.execute) { body.execute = true; body.action = opts.action; body.args = opts.args; }
      const r = await apiFetch("/staff/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) {
        const d = j.detail ? (typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail)) : String(r.status);
        setMsgs((m) => [...m, { role: "ai", text: "error: " + d }]);
      } else if (j.type === "proposed") {
        setMsgs((m) => [...m, { role: "ai",
          text: "Proposed action: " + j.action + " " + JSON.stringify(j.args || {}) + " - nothing is executed until you confirm.",
          proposal: { action: j.action, args: j.args || {}, message } }]);
      } else if (j.type === "executed") {
        setMsgs((m) => [...m, { role: "ai", text: "Executed " + j.action + " OK.", results: j.results || [] }]);
      } else {
        setMsgs((m) => [...m, { role: "ai", text: j.answer ?? "" }]);
      }
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "ai", text: "assistant unavailable: " + ((e && e.name ? e.name : "?") + " " + (e && e.message ? e.message : "")) }]);
    }
    setBusy(false);
  }

  async function execute(idx: number) {
    if (busy) return;
    const m = msgs[idx];
    if (!m || !m.proposal || m.executed) return;
    setMsgs((arr) => [...arr, { role: "you", text: "[Confirm] Execute " + m.proposal.action }]);
    await turn(m.proposal.message, { execute: true, action: m.proposal.action, args: m.proposal.args });
    setMsgs((arr) => {
      const last = arr[arr.length - 1];
      if (last && last.results) { return arr.map((x, k) => (k === idx ? { ...x, executed: true } : x)); }
      return arr;
    });
  }

  function sendNow() {
    const t = input.trim();
    if (!t) return;
    setInput("");
    turn(t);
  }

  return (
    <main className="max-w-2xl mx-auto pt-8 px-4 pb-12">
      <h1 className="text-xl font-semibold mb-1">Assistant</h1>
      <p className="text-xs text-slate-500 mb-3">Answers come from live catalog / lot / offer data - nothing invented. Actions run only after your Execute confirmation.</p>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {chips.map((c, i) => (
            <button key={i} className="text-xs border rounded-full px-3 py-1 hover:bg-slate-50" onClick={() => turn(c.message)} disabled={busy}>{c.chip}</button>
          ))}
        </div>
      )}
      <div className="bg-white rounded-xl shadow p-6 space-y-3 min-h-[300px]">
        {msgs.length === 0 && <p className="text-slate-400 text-sm">Try a chip above, or: &quot;What is in stock and how much?&quot;</p>}
        {msgs.map((m, i) => (
          <div key={i} className={"rounded-lg p-3 text-sm " + (m.role === "you" ? "bg-slate-100 ml-8" : "bg-emerald-50")}>
            <b className="mr-1">{m.role === "you" ? "You" : "Assistant"}:</b>{m.text}
            {m.proposal && (
              <button className="mt-2 bg-slate-900 text-white rounded px-3 py-1 disabled:opacity-50" onClick={() => execute(i)} disabled={busy || m.executed}>
                {m.executed ? "Confirmed" : "Execute"}
              </button>
            )}
            {!!m.results?.length && (
              <div className="mt-2 text-xs text-slate-600">
                {m.results.map((r: any, k: number) => (<div key={k}>{JSON.stringify(r)}</div>))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-4 items-end">
        <textarea className="border rounded px-3 py-2 flex-1" rows={2}
          placeholder="ask the assistant... (Enter sends - Shift+Enter newline)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendNow(); } }} />
        <button className="bg-slate-900 text-white rounded px-4 py-2 disabled:opacity-50" onClick={sendNow} disabled={busy}>Send</button>
      </div>
    </main>
  );
}