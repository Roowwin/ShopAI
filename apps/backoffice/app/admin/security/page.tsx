"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";

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
      <h1 className="text-xl font-semibold mb-4">Security / TOTP</h1>
      <div className="bg-white rounded-xl shadow p-6 space-y-4">
        {!enabled && !secret && (
          <button className="bg-slate-900 text-white rounded px-4 py-2 disabled:opacity-50" onClick={setup} disabled={busy}>
            Generate TOTP secret
          </button>
        )}
        {secret && !enabled && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Add this to your authenticator app (manual entry):</p>
            <code className="block bg-slate-100 rounded p-3 break-all">{secret}</code>
            <p className="text-xs text-slate-500 break-all">{uri}</p>
            <input className="border rounded px-3 py-2 tracking-widest" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="bg-slate-900 text-white rounded px-4 py-2 disabled:opacity-50" onClick={enable} disabled={busy}>
              Enable TOTP
            </button>
          </div>
        )}
        {enabled && <p className="text-green-700">TOTP is enabled for this account.</p>}
        {msg && <p className="text-sm text-slate-600">{msg}</p>}
      </div>
    </main>
  );
}