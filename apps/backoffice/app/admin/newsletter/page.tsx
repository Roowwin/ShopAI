"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

type Sub = { email: string; created_at: string };

function when(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

export default function NewsletterPage() {
  const router = useRouter();
  const [subs, setSubs] = useState<Sub[]>([]);
  const [total, setTotal] = useState(0);
  const [msg, setMsg] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch("/staff/newsletter");
    if (!r.ok) {
      setMsg(r.status === 403 ? "admin or manager role required" : "Could not load subscribers");
      setLoaded(true);
      return;
    }
    const j: any = await r.json().catch(() => ({}));
    setSubs(j.subscribers ?? []);
    setTotal(j.total ?? 0);
    setLoaded(true);
  }, []);

  useEffect(() => {
    apiFetch("/staff/me").then(async (r) => {
      if (!r.ok) { router.replace("/"); return; }
      const me: any = await r.json().catch(() => null);
      if (!me || (me.role !== "admin" && me.role !== "manager")) {
        setMsg("admin or manager role required");
        setLoaded(true);
        return;
      }
      await load();
    });
  }, [router, load]);

  return (
    <main className="max-w-6xl mx-auto p-4 min-h-screen">
      <div className="bg-slate-950 text-white rounded-2xl px-5 py-3 mb-4 flex items-center gap-3">
        <b>Newsletter</b>
        <span className="text-xs text-slate-400">public signups from the storefront footer</span>
      </div>
      {msg && (<div className="rounded-xl bg-amber-100 text-amber-800 px-3 py-2 mb-3 text-sm">{msg}</div>)}

      <section className="rounded-2xl ring-1 ring-slate-200 bg-white p-4">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-sm font-semibold">Subscribers</h2>
          <span className="text-sm text-slate-500">{total} total</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
              <th className="py-1">Email</th><th>Subscribed</th>
            </tr>
          </thead>
          <tbody>
            {subs.map((s) => (
              <tr key={s.email} className="border-t border-slate-100">
                <td className="py-2 pr-2">{s.email}</td>
                <td className="text-slate-500">{when(s.created_at)}</td>
              </tr>
            ))}
            {loaded && subs.length === 0 && !msg && (
              <tr><td colSpan={2} className="text-slate-400 py-2">No subscribers yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
