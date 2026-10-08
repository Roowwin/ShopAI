"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setErr("");
    const r = await apiFetch("/staff/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.detail ?? "login failed"); setBusy(false); return; }
    if (j.requires_mfa) { setChallenge(j.challenge); setBusy(false); return; }
    sessionStorage.setItem("rfo_access", j.access_token);
    router.push("/admin");
  }

  async function submitMfa() {
    setBusy(true); setErr("");
    const r = await apiFetch("/staff/auth/mfa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + challenge },
      body: JSON.stringify({ code }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.detail ?? "code failed"); setBusy(false); return; }
    sessionStorage.setItem("rfo_access", j.access_token);
    router.push("/admin");
  }

  return (
    <main className="flex items-center justify-center min-h-screen">
      <div className="bg-white rounded-xl shadow p-8 w-full max-w-sm">
        <h1 className="text-xl font-semibold mb-1">RFO Backoffice</h1>
        <p className="text-sm text-slate-500 mb-6">Staff sign-in</p>
        {!challenge ? (
          <div className="space-y-3">
            <input className="w-full border rounded px-3 py-2" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="w-full border rounded px-3 py-2" type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button className="w-full bg-slate-900 text-white rounded px-3 py-2 disabled:opacity-50" onClick={submit} disabled={busy}>
              Sign in
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Enter the 6-digit code from your authenticator:</p>
            <input className="w-full border rounded px-3 py-2 tracking-widest" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="w-full bg-slate-900 text-white rounded px-3 py-2 disabled:opacity-50" onClick={submitMfa} disabled={busy}>
              Verify
            </button>
          </div>
        )}
        {err && <p className="text-red-600 text-sm mt-3">{err}</p>}
      </div>
    </main>
  );
}