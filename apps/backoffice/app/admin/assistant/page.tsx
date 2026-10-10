"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

type Proposal = { action: string; args: any; message: string; resolved?: any; fallback?: boolean };
type Msg = { role: "you" | "ai"; text: string; proposal?: Proposal; executed?: boolean; dismissed?: boolean; results?: any[] };
type Suggestion = { chip: string; message: string };
type StatusData = { model: string; cloud_active: boolean; fallback: boolean; turns: number; max_turns: number; role: string; can_do: string[] };
type Briefing = { intake_lots: number; intake_units: number; active_lots: number; restock: string[] };
type Activity = { at: string; entity: string; action: string };

const badgeTone: any = {
  activate_lot: "bg-emerald-50 text-emerald-700 border-emerald-200",
  create_lot: "bg-blue-50 text-blue-700 border-blue-200",
  scan_in: "bg-sky-50 text-sky-700 border-sky-200",
  test: "bg-violet-50 text-violet-700 border-violet-200",
  grade: "bg-violet-50 text-violet-700 border-violet-200",
  price: "bg-amber-50 text-amber-700 border-amber-200",
  list: "bg-teal-50 text-teal-700 border-teal-200",
  move: "bg-orange-50 text-orange-700 border-orange-200",
};
const badgeLabel: any = {
  activate_lot: "ACTIVATE LOT", create_lot: "CREATE LOT", scan_in: "SCAN IN", test: "TEST",
  grade: "GRADE", price: "PRICE", list: "LIST", move: "MOVE",
};

function units(n: number): string {
  return String(n) + (n === 1 ? " unit" : " units");
}

function previewFor(p: Proposal): string {
  const r: any = p.resolved || {};
  if (p.action === "activate_lot") {
    const lot: any = r.lot;
    if (lot) { return "Lot currently: " + lot.status + "  ->  active"; }
    return "Activate lot " + (p.args.lot_number || "?");
  }
  if (p.action === "create_lot") {
    return "Create new lot" + (p.args.warehouse ? " - warehouse: " + p.args.warehouse : "") + (p.args.notes ? " (" + p.args.notes + ")" : "");
  }
  if (p.action === "scan_in") {
    return "Scan in " + (p.args.serial_number || "?") + " into lot " + (p.args.lot_number || "?");
  }
  const labels: any = {
    test: "-> tested",
    grade: "-> graded" + (p.args.grade ? " (grade " + p.args.grade + ")" : ""),
    price: "-> priced at " + (p.args.sale_price_cents ? ((p.args.sale_price_cents / 100).toFixed(2) + " AUD") : "?"),
    list: "-> listed on storefront",
    move: "-> moved to " + (p.args.location || "?"),
  };
  return "Asset " + (p.args.serial_number || "?") + " " + (labels[p.action] || "-> " + p.action);
}

function ActionBadge({ action }: { action: string }) {
  const tone = badgeTone[action] || "bg-slate-50 text-slate-700 border-slate-200";
  return (
    <span className={"inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold tracking-wider " + tone}>
      {badgeLabel[action] || String(action).toUpperCase()}
    </span>
  );
}

export default function AssistantPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [sugg, setSugg] = useState<Suggestion[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const chatRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = chatRef.current;
    if (el) { el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); }
  }, [msgs, busy]);

  const loadSide = useCallback(async () => {
    try { const r = await apiFetch("/staff/ai/status"); if (r.ok) { setStatus(await r.json()); } } catch { void 0; }
    try { const r = await apiFetch("/staff/ai/activity"); if (r.ok) { setActivity(await r.json()); } } catch { void 0; }
  }, []);

  useEffect(() => {
    (async () => {
      try { const r = await apiFetch("/staff/ai/status"); if (r.ok) { setStatus(await r.json()); } } catch { void 0; }
      try { const r = await apiFetch("/staff/ai/briefing"); if (r.ok) { setBriefing(await r.json()); } } catch { void 0; }
      try { const r = await apiFetch("/staff/ai/suggestions"); if (r.ok) { const j: any = await r.json(); setSugg(Array.isArray(j.items) ? j.items : []); } } catch { void 0; }
      try { const r = await apiFetch("/staff/ai/activity"); if (r.ok) { setActivity(await r.json()); } } catch { void 0; }
    })();
  }, []);

  async function turn(message: string, opts?: { execute?: boolean; action?: string; args?: any; silent?: boolean }) {
    if (!message || busy) { return; }
    setMsgs((m) => (opts && opts.silent ? m : [...m, { role: "you", text: message }]));
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
        setMsgs((m) => [...m, { role: "ai", text: "Proposed action ready - nothing executes until you confirm.",
          proposal: { action: j.action, args: j.args || {}, message, resolved: j.resolved, fallback: !!j.fallback } }]);
      } else if (j.type === "executed") {
        setMsgs((m) => [...m, { role: "ai", text: "Executed " + j.action + " OK.", results: j.results || [] }]);
      } else {
        setMsgs((m) => [...m, { role: "ai", text: j.answer ?? "" }]);
      }
    } catch (e: any) {
      const em = e instanceof Error ? (e.name + " " + e.message) : String(e);
      setMsgs((m) => [...m, { role: "ai", text: "assistant unavailable: " + em }]);
    }
    setBusy(false);
    await loadSide();
  }

  async function confirm(idx: number) {
    if (busy) { return; }
    const m = msgs[idx];
    if (!m || !m.proposal || m.executed) { return; }
    setMsgs((arr) => [...arr, { role: "you", text: "[Confirm] " + m.proposal.action }]);
    await turn(m.proposal.message, { execute: true, action: m.proposal.action, args: m.proposal.args, silent: true });
    setMsgs((arr) => {
      const last = arr[arr.length - 1];
      if (last && last.results) { return arr.map((x, k) => (k === idx ? { ...x, executed: true } : x)); }
      return arr;
    });
  }

  function dismiss(idx: number) {
    setMsgs((arr) => arr.map((x, k) => (k === idx ? { ...x, dismissed: true } : x)));
  }

  async function clearMemory() {
    try { await apiFetch("/staff/ai/memory-clear", { method: "POST" }); } catch { void 0; }
    await loadSide();
  }

  function sendNow() {
    const t = input.trim();
    if (!t) { return; }
    setInput("");
    void turn(t);
  }

  const pending = msgs.filter((m) => m.proposal && !m.executed && !m.dismissed).length;
  const fb = !!status && status.fallback;

  return (
    <main className="max-w-7xl mx-auto p-4 min-h-screen">
      <div className="rounded-2xl ring-1 ring-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="bg-slate-950 px-5 py-3 flex flex-wrap items-center gap-3 text-white">
          <span className={"h-2.5 w-2.5 rounded-full " + (fb ? "bg-amber-400" : "bg-emerald-400")}></span>
          <b className="text-sm tracking-wide">Assistant</b>
          <span className="rounded-md bg-white/10 px-2 py-0.5 text-xs">{status ? status.role.toUpperCase() : "..."}</span>
          <span className={"rounded-md px-2 py-0.5 text-xs font-mono " + (fb ? "bg-amber-400/20 text-amber-200" : "bg-white/10 text-slate-200")}>
            {status ? status.model : "..."}
          </span>
          {fb && <span className="rounded-md bg-amber-400 text-amber-950 px-2 py-0.5 text-[10px] font-semibold">FALLBACK - ACTIONS READ-ONLY</span>}
          <span className="ml-auto text-xs text-slate-300">Memory {status ? status.turns : 0}/{status ? status.max_turns : 6}</span>
          <button className="text-xs rounded-md border border-white/25 px-2 py-0.5 hover:bg-white/10" onClick={clearMemory}>Clear</button>
        </div>

        <div className="grid gap-4 p-4 md:grid-cols-5">
          <aside className="md:col-span-1 space-y-4 md:self-start md:sticky md:top-4">
            <div className="rounded-xl ring-1 ring-slate-200 bg-white p-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Needs attention</h2>
              {briefing ? (
                <div className="space-y-2 text-sm">
                  <div className="rounded-lg bg-emerald-50 px-3 py-2">
                    <p className="font-semibold text-emerald-800">{briefing.intake_lots}</p>
                    <p className="text-xs text-emerald-700">intake lots - {units(briefing.intake_units)}</p>
                  </div>
                  <div className="rounded-lg bg-sky-50 px-3 py-2">
                    <p className="font-semibold text-sky-800">{briefing.active_lots}</p>
                    <p className="text-xs text-sky-700">active lots</p>
                  </div>
                  <div className="rounded-lg bg-amber-50 px-3 py-2">
                    <p className="text-xs text-amber-800">Restock: {briefing.restock.length ? briefing.restock.join(", ") : "none"}</p>
                  </div>
                </div>
              ) : (<p className="text-xs text-slate-400">loading...</p>)}
            </div>
            <div className="rounded-xl ring-1 ring-slate-200 bg-white p-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Quick actions</h2>
              <div className="space-y-1.5">
                {sugg.length === 0 && <p className="text-xs text-slate-400">nothing pending</p>}
                {sugg.map((s, i) => (
                  <button key={i} className="w-full text-left text-xs rounded-lg border border-slate-200 px-2.5 py-2 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                    disabled={busy} onClick={() => void turn(s.message)}>{s.chip}</button>
                ))}
              </div>
            </div>
          </aside>

          <section className="md:col-span-3 flex flex-col rounded-xl ring-1 ring-slate-200 bg-slate-50 h-[calc(100vh-230px)]">
            <div ref={chatRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {msgs.length === 0 && (
                <div className="text-center py-10">
                  <p className="text-slate-500">Ask anything about your stock - or open a Quick action.</p>
                  <p className="text-xs text-slate-400 mt-1">Actions always require your confirmation before touching the data.</p>
                </div>
              )}
              {msgs.map((m, i) => (
                m.role === "you" ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[80%] rounded-2xl rounded-br-md bg-indigo-600 text-white px-4 py-2.5 text-sm shadow-sm">{m.text}</div>
                  </div>
                ) : (
                  <div key={i} className="max-w-[92%] rounded-2xl rounded-bl-md bg-white ring-1 ring-slate-200 px-4 py-3 text-sm shadow-sm">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-400"></span>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Assistant</span>
                      {m.proposal && <ActionBadge action={m.proposal.action} />}
                    </div>
                    <p className="whitespace-pre-wrap">{m.text}</p>
                    {m.proposal && !m.dismissed && !m.executed && (
                      <div className="mt-3 space-y-2">
                        <pre className="text-xs bg-slate-900 text-slate-100 rounded-lg p-2.5 font-mono whitespace-pre-wrap">{previewFor(m.proposal)}</pre>
                        {m.proposal.fallback && (
                          <p className="text-xs text-amber-700">Proposed on the fallback model - Execute is disabled server-side.</p>
                        )}
                        <div className="flex gap-2">
                          <button className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                            onClick={() => void confirm(i)} disabled={busy || m.executed || !!m.proposal.fallback}>Confirm executes</button>
                          <button className="rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100" onClick={() => dismiss(i)}>Cancel</button>
                        </div>
                      </div>
                    )}
                    {m.proposal && m.dismissed && (<p className="mt-2 text-xs text-slate-400">Cancelled.</p>)}
                    {m.proposal && m.executed && (<p className="mt-2 text-xs text-emerald-600 font-medium">Confirmed and recorded.</p>)}
                    {!!m.results?.length && (
                      <div className="mt-2 space-y-1">
                        {m.results.map((r: any, k: number) => (
                          <div key={k} className="font-mono text-xs bg-slate-900 text-emerald-300 rounded-lg px-2.5 py-1.5">{JSON.stringify(r)}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              ))}
              {busy && (
                <div className="flex items-center gap-1.5 px-2">
                  <span className="h-2 w-2 rounded-full bg-slate-300 animate-pulse"></span>
                  <span className="h-2 w-2 rounded-full bg-slate-300 animate-pulse" style={{ animationDelay: "150ms" }}></span>
                  <span className="h-2 w-2 rounded-full bg-slate-300 animate-pulse" style={{ animationDelay: "300ms" }}></span>
                </div>
              )}
            </div>
            <div className="p-3 pt-2">
              <div className="flex gap-2 items-end bg-white rounded-2xl ring-1 ring-slate-300 focus-within:ring-emerald-500 p-2">
                <textarea className="flex-1 resize-none outline-none text-sm px-2 py-1.5 max-h-32" rows={1}
                  placeholder="Ask... (Enter sends - Shift+Enter newline)"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendNow(); } }} />
                <button className="rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
                  onClick={sendNow} disabled={busy || !input.trim()}>Send</button>
              </div>
              <p className="text-[10px] text-slate-400 mt-1.5 px-2">Pending proposals: {pending} - nothing executes without your confirmation.</p>
            </div>
          </section>

          <aside className="md:col-span-1 space-y-4 md:self-start md:sticky md:top-4">
            <div className="rounded-xl ring-1 ring-slate-200 bg-white p-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Context</h2>
              <p className="text-xs text-slate-500 mb-2">Pending: <b className={pending ? "text-amber-600" : ""}>{pending}</b></p>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mt-3 mb-1.5">Done today</h3>
              {activity.length === 0 ? <p className="text-xs text-slate-400">nothing yet</p> : (
                <ul className="space-y-1.5">
                  {activity.map((a, i) => (
                    <li key={i} className="text-xs border-l-2 border-slate-200 pl-2 py-0.5">
                      <span className="font-mono text-slate-400">{new Date(a.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      <span className="ml-1">{a.entity}/{a.action}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}