"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

export type Me = { email: string; role: string; public_id?: string; totp_enabled?: boolean };

/* There is deliberately NO middleware.ts here. The staff access token lives in
   sessionStorage["rfo_access"], which Next middleware cannot read - it only sees cookies and
   request headers. A middleware would therefore protect nothing while looking like it did,
   which is worse than having none. The durable fix would be to move the access token to an
   httpOnly cookie, but that is a backend auth change, not a UI one.

   The real wall is server-side: every /staff/* door enforces require_roles itself. What this
   hook buys is UX - not rendering an admin page (and not firing its data calls) for a session
   that is dead or under-privileged. */
export function useMe(): { me: Me | null; checked: boolean } {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    apiFetch("/staff/me")
      .then(async (r) => {
        if (!r.ok) { router.replace("/"); return; }
        const j: Me | null = await r.json().catch(() => null);
        if (alive) { setMe(j); }
      })
      .catch(() => { router.replace("/"); })
      .finally(() => { if (alive) { setChecked(true); } });
    return () => { alive = false; };
  }, [router]);

  return { me, checked };
}

/* True when `me` holds one of `roles`. Use it to gate UI only - never as the sole check,
   because `me` is client state. The API refuses the request regardless. */
export function requireRole(me: Me | null, roles: string[]): boolean {
  return !!me && roles.includes(me.role);
}
