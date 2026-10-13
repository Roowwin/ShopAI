VERDICT: PASS

Fast-lane landing (owner directive). This job changes navigation only - no route, guard, query or
payload was touched - so the security-relevant claims are narrow and are stated as such:

- No API surface changed: the diff is `app/components/nav.ts` and `app/components/SidebarNav.tsx`.
  Every `/staff/*` door keeps the roles it had, and no page gained or lost a server-side check.
- A placeholder is not a hidden route. `soon` items are drawn as a `<span>` with
  `aria-disabled="true"` and no anchor, so they are not focusable, not activatable and not announced
  as destinations. The routes they name (`/admin/returns`, `/admin/finance`, `/admin/reports`) do not
  exist, so nothing is reachable that was not reachable before.
- The sidebar is a UX affordance and never the authorisation wall - every admin page enforces its own
  role server-side, which this job did not touch. Removing an entry from the rail therefore reduces
  discoverability, never access: an orphaned page still refuses a caller without the role.
- One consequence worth recording plainly, because it is a discoverability change and not a
  security one: mapping the roadmap exactly leaves several built pages with no rail entry
  (`/admin` Overview, `/admin/intake`, `/admin/logistics`, `/admin/customers`, `/admin/agents`,
  `/admin/ai/listings`, `/admin/channels/amazon`, `/admin/channels/facebook`). They remain reachable
  by URL and still gated; the owner was told.
