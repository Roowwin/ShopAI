"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";

type Msg = { role: "you" | "ai"; text: string };

export default function AssistantPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setMsgs((m) => [...m, { role: "you", text }]);
    setInput(""); setBusy(true);
    try {
      const r = await apiFetch("/staff/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text }) });
      const j: any = await r.json().catch(() => ({}));
      setMsgs((m) => [...m, { role: "ai", text: r.ok ? (j.answer ?? "") : ("error: " + (j.detail ?? r.status)) }]);
    } catch { setMsgs((m) => [...m, { role: "ai", text: "assistant unavailable" }]); }
    finally { setBusy(false); }
  }

  return (
    <main className="max-w-2xl mx-auto pt-8 px-4">
      <h1 className="text-xl font-semibold mb-1">Assistant</h1>
      <p className="text-xs text-slate-500 mb-4">Answers come from live catalog / lot / offer data - nothing invented.</p>
      <div className="bg-white rounded-xl shadow p-6 space-y-3 min-h-[300px]">
        {msgs.length === 0 && <p className="text-slate-400 text-sm">Try: &quot;What is in stock and how much?&quot; or &quot;Any current offers?&quot;</p>}
        {msgs.map((m, i) => (
          <div key={i} className={"rounded-lg p-3 text-sm " + (m.role === "you" ? "bg-slate-100 ml-8" : "bg-emerald-50")}>
            <b className="mr-1">{m.role === "you" ? "You" : "Assistant"}:</b>{m.text}
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-4">
        <input className="border rounded px-3 py-2 flex-1" placeholder="ask the assistant..." onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }} value={input} onChange={(e) => setInput(e.target.value)} />
        <button className="bg-slate-900 text-white rounded px-4 py-2 disabled:opacity-50" onClick={send} disabled={busy}>Send</button>
      </div>
    </main>
  );
}
