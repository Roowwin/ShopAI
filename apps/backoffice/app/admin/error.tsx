"use client";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="max-w-2xl mx-auto p-6">
      <div className="bg-white rounded-xl shadow p-6">
        <h1 className="text-lg font-semibold">This page could not load</h1>
        <p className="text-sm text-slate-600 mt-1">{error.message || "Unexpected error."}</p>
        <button className="mt-4 bg-slate-900 text-white rounded px-4 py-2 text-sm hover:bg-slate-800" onClick={reset}>
          Try again
        </button>
      </div>
    </main>
  );
}
