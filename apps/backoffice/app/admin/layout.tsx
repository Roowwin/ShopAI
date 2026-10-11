"use client";

import { usePathname, useRouter } from "next/navigation";
import { logout } from "@/lib/api";

/* Every entry here must have a page behind it. Orders / Customers / Audit are intentionally
   absent: those pages do not exist yet, and linking them would ship three 404s. */
const LINKS = [
  { href: "/admin", label: "Home" },
  { href: "/admin/intake", label: "Intake" },
  { href: "/admin/assets", label: "Assets" },
  { href: "/admin/assistant", label: "Assistant" },
  { href: "/admin/ai/listings", label: "AI Listings" },
  { href: "/admin/cms", label: "CMS" },
  { href: "/admin/newsletter", label: "Newsletter" },
  { href: "/admin/security", label: "Security" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div>
      <nav className="bg-slate-900 text-white px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
        {LINKS.map((l) => {
          /* `=== href || startsWith(href + "/")`, not a bare startsWith: a raw prefix test also
             matches SIBLING routes, so a later /admin/intake-queue would light two entries at once.
             This form needs no `exact` flag and cannot false-positive. */
          const active = pathname === l.href || pathname.startsWith(l.href + "/");
          return (
            <a
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={active ? "text-white font-semibold" : "text-slate-300 hover:text-white"}
            >
              {l.label}
            </a>
          );
        })}
        <span className="ml-auto flex items-center gap-3">
          <span className="text-slate-400">RFO Backoffice</span>
          <button
            className="border border-slate-600 rounded px-2.5 py-1 text-slate-200 hover:bg-slate-800"
            onClick={async () => { try { await logout(); } finally { router.replace("/"); } }}
          >
            Sign out
          </button>
        </span>
      </nav>
      {children}
    </div>
  );
}
