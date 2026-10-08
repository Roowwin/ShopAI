"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, logout } from "@/lib/api";

type Me = { email: string; role: string };

export default function AdminHome() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    apiFetch("/staff/me").then(async (r) => {
      if (!r.ok) { router.replace("/"); return; }
      setMe(await r.json());
    });
  }, [router]);

  return (
    <main className="max-w-3xl mx-auto pt-10 px-4">
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-xl font-semibold">RFO Backoffice</h1>
        <button className="text-sm border rounded px-3 py-1.5" onClick={async () => { await logout(); router.replace("/"); }}>
          Sign out
        </button>
      </header>
      <div className="bg-white rounded-xl shadow p-6">
        {me ? (
          <div>
            <p className="text-sm text-slate-500">Signed in as</p>
            <p className="text-lg font-medium">{me.email} <span className="ml-2 text-xs bg-slate-200 rounded px-2 py-0.5">{me.role}</span></p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <a className="border rounded-lg p-4 hover:bg-slate-50" href="/admin/security">Security / TOTP setup</a>
              <a className="border rounded-lg p-4 hover:bg-slate-50" href="/admin/intake">Intake (Phase 6b)</a>
            </div>
          </div>
        ) : (
          <p className="text-slate-500">Loading...</p>
        )}
      </div>
    </main>
  );
}