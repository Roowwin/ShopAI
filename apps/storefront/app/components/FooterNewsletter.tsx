"use client";

import { useState } from "react";
import { API } from "@/lib/api";

export default function FooterNewsletter() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg("");
    try {
      const r = await fetch(API + "/store/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (r.ok) {
        // One message for both outcomes: the API treats a repeat signup as success and
        // deliberately does not say whether the address was already on the list.
        setMsg("Thanks - you're on the list.");
        setEmail("");
      } else {
        const j: any = await r.json().catch(() => ({}));
        setMsg(j.detail === "invalid email" ? "Please enter a valid email address." : "Signup failed - please try again.");
      }
    } catch {
      setMsg("Signup failed - please try again.");
    }
    setBusy(false);
  }

  return (
    <div className="rounded-xl bg-slate-800/60 px-4 py-3">
      <p className="text-sm font-semibold text-white">Get the drop list</p>
      <p className="text-xs text-slate-400 mt-1">Fresh stock alerts and deals - no spam.</p>
      <form className="mt-2 flex flex-wrap gap-2" onSubmit={submit}>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com" aria-label="Email address"
          className="flex-1 min-w-[12rem] rounded-lg bg-slate-900 text-slate-100 placeholder-slate-500 px-3 py-2 text-sm ring-1 ring-slate-700 focus:ring-emerald-500 outline-none" />
        <button type="submit" disabled={busy}
          className="bg-emerald-600 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50">
          {busy ? "..." : "Subscribe"}
        </button>
      </form>
      {msg && (<p className="text-xs text-emerald-300 mt-2">{msg}</p>)}
    </div>
  );
}
