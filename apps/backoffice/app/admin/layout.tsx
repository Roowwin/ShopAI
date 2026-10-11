"use client";

import { usePathname, useRouter } from "next/navigation";
import { logout } from "@/lib/api";
import { Button } from "@/app/components/ui";

/* Every entry here must have a page behind it - a link with no page is a 404 in the chrome.
   Orders, Customers and Audit were deliberately withheld until the ops pages existed; they land
   in the same commit as those pages, so the nav never advertised a route that was not there. */
const LINKS = [
  { href: "/admin", label: "Home" },
  { href: "/admin/intake", label: "Intake" },
  { href: "/admin/assets", label: "Assets" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/customers", label: "Customers" },
  { href: "/admin/audit", label: "Audit" },
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
      <nav className="bg-ink-900 text-white px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
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
              className={active ? "text-white font-semibold" : "text-ink-300 hover:text-white"}
            >
              {l.label}
            </a>
          );
        })}
        <span className="ml-auto flex items-center gap-3">
          <span className="text-ink-400">RFO Backoffice</span>
          {/* Through the Button primitive, not the ~28px hand-rolled control this used to be, so
              it sits on the one 36px control height. `onDark` is the documented backoffice-only
              variant for a control on the dark nav surface. */}
          <Button variant="onDark" onClick={async () => { try { await logout(); } finally { router.replace("/"); } }}>
            Sign out
          </Button>
        </span>
      </nav>
      {children}
    </div>
  );
}
