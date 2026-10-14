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

  /* ONE ROW, AND NO BOX AROUND IT. The box it used to sit in was `bg-surface-deep/60` INSIDE a
     `bg-surface-deep` footer - sixty percent of a colour over itself, which is that colour, so the
     panel was never visible as a panel and only ever added padding. The same was true of the
     field's `tone="deep"`: an invisible fill on an invisible box. The field is white now
     (`tone="light"`), which is what makes it read as a field on the tinted band at all.

     The label and the sub-copy are one line and the form sits beside it, so the whole block is
     the height of the input instead of four stacked lines. The confirmation is a SIBLING of the
     row rather than a child, so it appears under both halves and cannot change their alignment. */
  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs">
          <span className="font-semibold text-ink-900">Get the drop list</span>
          {" - "}fresh stock alerts and deals, no spam.
        </p>
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
          {/* The width is on a WRAPPER: Input's base carries `w-full` and this app has no
              tailwind-merge, so a width class passed to it would lose to that by stylesheet order. */}
          <div className="sm:w-56">
            <Input tone="light" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com" aria-label="Email address"
              className="text-sm" />
          </div>
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? "..." : "Subscribe"}
          </Button>
        </form>
      </div>
      {msg && (<p className="text-xs text-brand-300 mt-2">{msg}</p>)}
    </>
  );
}
