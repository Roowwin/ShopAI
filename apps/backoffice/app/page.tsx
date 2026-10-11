"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { Button, Card, Heading, Input } from "@/app/components/ui";

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
      <Card className="w-full max-w-sm p-8">
        <Heading level="h1" className="mb-1">RFO Backoffice</Heading>
        <p className="text-sm text-ink-500 mb-6">Staff sign-in</p>
        {!challenge ? (
          <div className="space-y-3">
            <Input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Button className="w-full" onClick={submit} disabled={busy}>
              Sign in
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-ink-600">Enter the 6-digit code from your authenticator:</p>
            <Input className="tracking-widest" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
            <Button className="w-full" onClick={submitMfa} disabled={busy}>
              Verify
            </Button>
          </div>
        )}
        {err && <p className="text-danger-600 text-sm mt-3">{err}</p>}
      </Card>
    </main>
  );
}
