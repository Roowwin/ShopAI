"use client";

import { useEffect, useState } from "react";
import { API, aud } from "@/lib/api";
import { Button, Card, Heading, Input } from "../components/ui";

type Result = { title: string; brand: string; grade: string; price_cents: number; units_available: number; url: string };
type Msg = { role: "you" | "ai"; text: string; cards?: Result[] };

export default function AssistantPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sid, setSid] = useState("");
  const [about, setAbout] = useState("");

  useEffect(() => {
    let s = localStorage.getItem("rfo_chat_sid");
    if (!s) { s = Array.from(crypto.getRandomValues(new Uint8Array(8))).map((b) => b.toString(16).padStart(2, "0")).join(""); localStorage.setItem("rfo_chat_sid", s); }
    setSid(s);
  }, []);
  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get("about");
    if (!slug || !sid || msgs.length > 0 || input) return;
    setAbout(slug);
    setInput("Tell me about product " + slug);
  }, [sid, msgs.length, input]);

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
    } catch (e) { const em = e instanceof Error ? (e.name + " " + e.message) : String(e); setMsgs((m) => [...m, { role: "ai", text: "assistant unavailable: " + em }]); }
    setBusy(false);
  }

  return (
    <main className="max-w-2xl mx-auto pt-8 px-4">
      <Heading level="h1" className="mb-4">Ask about our stock</Heading>
      {about && <p className="text-xs text-ink-500 mb-2">About: {about} <a className="text-brand-700 underline" href={"/products/" + about}>view item</a></p>}
      <Card className="p-6 shadow space-y-3 min-h-[360px]">
        {msgs.length === 0 && <p className="text-ink-400 text-sm">Try: &quot;What refurbished phones do you have under $300?&quot;</p>}
        {msgs.map((m, i) => (
          <div key={i} className={"rounded-control p-3 text-sm " + (m.role === "you" ? "bg-surface-sunken ml-8" : "bg-brand-50")}>
            <b className="mr-1">{m.role === "you" ? "You" : "Assistant"}:</b>{m.text}
            {!!m.cards?.length && (
              <div className="mt-2 space-y-2">
                {m.cards.map((c) => (
                  <a key={c.title + c.grade} href={c.url} className="block rounded-control border border-line p-2 hover:bg-brand-50 transition">
                    {c.title} · Grade {c.grade} · from {aud(c.price_cents)} · {c.units_available} in stock
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </Card>
      <div className="flex gap-2 mt-4">
        <Input className="flex-1" placeholder="what are you looking for?" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }} value={input} onChange={(e) => setInput(e.target.value)} />
        <Button onClick={send} disabled={busy}>Send</Button>
      </div>
    </main>
  );
}
