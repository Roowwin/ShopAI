"use client";

import { useEffect, useState } from "react";
import { API, aud } from "@/lib/api";

type Card = { title: string; brand: string; grade: string; price_cents: number; units_available: number; url: string };
type Msg = { role: "you" | "ai"; text: string; cards?: Card[] };

export default function AssistantPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sid, setSid] = useState("");

  useEffect(() => {
    let s = localStorage.getItem("rfo_chat_sid");
    if (!s) { s = Array.from(crypto.getRandomValues(new Uint8Array(8))).map((b) => b.toString(16).padStart(2, "0")).join(""); localStorage.setItem("rfo_chat_sid", s); }
    setSid(s);
  }, []);

  async function send() {
    const text = input.trim();
    if (!text || busy || !sid) return;
    setMsgs((m) => [...m, { role: "you", text }]);
    setInput(""); setBusy(true);
    try {
      const r = await fetch(API + "/store/assistant/chat", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, session_id: sid }),
      });
      const j: any = await r.json().catch(() => ({}));
      setMsgs((m) => [...m, { role: "ai", text: r.ok ? (j.text ?? "") : ("error: " + (j.detail ?? r.status)), cards: j.products ?? [] }]);
    } catch { setMsgs((m) => [...m, { role: "ai", text: "assistant unavailable" }]); }
    setBusy(false);
  }

  return (
    <main className="max-w-2xl mx-auto pt-8 px-4">
      <h1 className="text-xl font-semibold mb-4">Ask about our stock</h1>
      <div className="bg-white rounded-xl shadow p-6 space-y-3 min-h-[360px]">
        {msgs.length === 0 && <p className="text-slate-400 text-sm">Try: &quot;What refurbished phones do you have under $300?&quot;</p>}
        {msgs.map((m, i) => (
          <div key={i} className={"rounded-lg p-3 text-sm " + (m.role === "you" ? "bg-slate-100 ml-8" : "bg-sky-50")}>
            <b className="mr-1">{m.role === "you" ? "You" : "Assistant"}:</b>{m.text}
            {!!m.cards?.length && (
              <div className="mt-2 space-y-2">
                {m.cards.map((c) => (
                  <a key={c.title + c.grade} href={c.url} className="block border rounded p-2 hover:bg-white">
                    {c.title} · Grade {c.grade} · from {aud(c.price_cents)} · {c.units_available} in stock
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-4">
        <input className="border rounded px-3 py-2 flex-1" placeholder="what are you looking for?" value={input} onChange={(e) => setInput(e.target.value)} />
        <button className="bg-slate-900 text-white rounded px-4 py-2 disabled:opacity-50" onClick={send} disabled={busy}>Send</button>
      </div>
    </main>
  );
}
