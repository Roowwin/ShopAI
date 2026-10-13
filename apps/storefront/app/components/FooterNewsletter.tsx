"use client";

import { useState } from "react";
import { API } from "@/lib/api";
import { Button, Input } from "./ui";

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
    <div className="rounded-control bg-surface-deep/60 px-4 py-3">
      <p className="text-sm font-semibold text-ink-900">Get the drop list</p>
      <p className="text-xs text-ink-400 mt-1">Fresh stock alerts and deals - no spam.</p>
      <form className="mt-2 flex flex-wrap gap-2" onSubmit={submit}>
        <Input tone="deep" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com" aria-label="Email address"
          className="flex-1 min-w-[12rem] text-sm" />
        <Button type="submit" disabled={busy}>
          {busy ? "..." : "Subscribe"}
        </Button>
      </form>
      {msg && (<p className="text-xs text-brand-300 mt-2">{msg}</p>)}
    </div>
  );
}
