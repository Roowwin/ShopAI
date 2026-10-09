export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <nav className="bg-slate-900 text-white px-4 py-2.5 flex gap-6 text-sm">
        <a href="/admin" className="hover:text-slate-300">Home</a>
        <a href="/admin/intake" className="hover:text-slate-300">Intake</a>
        <a href="/admin/assets" className="hover:text-slate-300">Assets</a>
        <a href="/admin/assistant" className="hover:text-slate-300">Assistant</a>
        <a href="/admin/ai/listings" className="hover:text-slate-300">AI Listings</a>
        <a href="/admin/security" className="hover:text-slate-300">Security</a>
        <span className="ml-auto text-slate-400">RFO Backoffice</span>
      </nav>
      {children}
    </div>
  );
}
