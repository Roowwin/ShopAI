VERDICT: PASS

**1. Gate placement fix (customers/[id]/page.tsx) - verified correctly fixed.**
- New `const cleared = checked && allowed && c != null && data != null;` and the heading is now
  `{cleared && c ? c.email : "Customer #" + id}`. Email is rendered only under the same three facts the gate block
  uses; the fallback is the URL `id`, not customer data.
- The gate block is `{cleared && c && data && (...)}`, semantically identical to the old
  `checked && allowed && c && data`.
- No other in-diff page renders customer email/name pre-gate. The only other identity render is the layout
  sidebar's `{me.email}` - the signed-in staff member's OWN address from `/staff/me`, not customer PII; `me` stays
  null on auth failure so nothing renders. Not a leak.
- Non-blocking note: `assets/[id]/page.tsx` has the SAME structural pattern in its `<h1>`
  (`{a?.serial_number ?? "#" + id}` sits outside the `checked && allowed && a && data` gate, seeded only by gated
  state). That line is pre-existing and unchanged by this job, and a serial number is asset data, not the customer
  PII item 1 targets - so no item-1 violation, but it is the identical latent-placement class the fix addressed.

**2. No guard or fetch changed - verified.**
- `customers/[id]` and `assets/[id]`: both keep `useMe()` + `requireRole(me, ["admin","manager"])`, exactly one
  `apiFetch` in `load`, and `useEffect(..., [checked, allowed, load])` with the same early
  `if (!checked || !allowed) return;`. No early return dropped.
- `admin/page.tsx` changed only comment prose (the `.table` wording fix). `layout.tsx` is chrome and never had a
  page guard.

**3. Nav reveals nothing that matters - one cosmetic 403.**
- All 12 entries map to real pages (all confirmed present in the tree). Every nav link is rendered role-blind.
- `/admin/agents` requires `["admin"]`; the sidebar shows "Agents" to a manager, who would get a server 403.
  Cosmetic only - the server door is the wall, and page labels are not sensitive. All other nav targets are either
  admin/manager or ungated. No data revealed by the nav.

**4. No new surface - verified.**
- No new endpoint (`/staff/me` already existed), no write, no storage (`useState` is an in-memory nav toggle only),
  no logging, no `dangerouslySetInnerHTML`.
- `lib/ui.ts`'s new `linkClass = "text-brand-700 hover:underline"` is a verbatim static literal, not composed from
  caller data. `TOGGLE`'s `+` concatenation is static literals only. `cn` is the existing passthrough joiner.
- Observation, not a finding: the layout now calls `useMe()`, so the chrome issues an extra `/staff/me` request per
  admin page (each page also calls it). No security impact; pages' own fetching is unchanged.

**5. Secret-shaped comments - none.**
- Scanned the whole diff for token/password/secret/api-key/Bearer/env/cookie/URL-with-credentials shapes. Only hit
  was the pre-existing prose word "one-token divergence" in `lib/ui.ts`. New comments discuss sub-list caps
  (50/50/20) and CSS scanning only. Nothing secret-shaped for a public-ish repo.

Paths: apps/backoffice/app/admin/customers/[id]/page.tsx, apps/backoffice/app/admin/assets/[id]/page.tsx,
apps/backoffice/app/admin/layout.tsx, apps/backoffice/lib/ui.ts. Note the working tree is the base branch
(phase12-backoffice); job-branch content read via `git show factory/job-20261011-201814-546:<path>`.
