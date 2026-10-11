import type { ReactNode } from "react";

export default function ContentPage({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <main className="max-w-3xl mx-auto pt-8 px-4 pb-12">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-slate-600 mt-2 leading-relaxed">{intro}</p>
      <div className="mt-6 space-y-5">{children}</div>
    </main>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl ring-1 ring-slate-200 bg-white p-5">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-2 space-y-2 text-sm text-slate-700 leading-relaxed">{children}</div>
    </section>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl bg-emerald-50 text-emerald-900 ring-1 ring-emerald-100 px-4 py-3 text-sm leading-relaxed">
      {children}
    </p>
  );
}
