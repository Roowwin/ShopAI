"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { Button, Card, Input, PageHeader } from "@/app/components/ui";

export default function SecurityPage() {
  const [secret, setSecret] = useState("");
  const [uri, setUri] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  async function setup() {
    setBusy(true); setMsg("");
    const r = await apiFetch("/staff/auth/mfa/setup", { method: "POST" });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(j.detail ?? "setup failed"); setBusy(false); return; }
    setSecret(j.secret); setUri(j.uri); setBusy(false);
  }

  async function enable() {
    setBusy(true); setMsg("");
    const r = await apiFetch("/staff/auth/mfa/enable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!r.ok) { const j: any = await r.json().catch(() => ({})); setMsg(j.detail ?? "enable failed"); setBusy(false); return; }
    setEnabled(true); setMsg("TOTP enabled - next login will ask for a code."); setBusy(false);
  }

  return (
    <main className="max-w-2xl mx-auto pt-10 px-4">
      <PageHeader title={<>Security</>} className="mb-4" />
      <Card className="p-6 space-y-4">
        {!enabled && !secret && (
          <Button onClick={setup} disabled={busy}>
            Generate TOTP secret
          </Button>
        )}
        {secret && !enabled && (
          <div className="space-y-3">
            <p className="text-sm text-ink-600">Add this to your authenticator app (manual entry):</p>
            <code className="block bg-surface-sunken rounded-control p-3 break-all">{secret}</code>
            <p className="text-xs text-ink-500 break-all">{uri}</p>
            <div className="w-40">
              {/* Placeholder only, like the login screen's fields: a placeholder is not a label -
                  it vanishes on first keystroke and a screen reader never had it. */}
              <Input aria-label="Six digit code from your authenticator" autoComplete="one-time-code" inputMode="numeric"
                className="tracking-widest" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <Button onClick={enable} disabled={busy}>
              Enable TOTP
            </Button>
          </div>
        )}
        {enabled && <p className="text-brand-300">TOTP is enabled for this account.</p>}
        {msg && <p className="text-sm text-ink-600">{msg}</p>}
      </Card>
    </main>
  );
}
