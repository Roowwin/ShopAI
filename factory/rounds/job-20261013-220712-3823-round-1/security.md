VERDICT: PASS

Fast-lane landing (owner directive). Navigation-only again - no route, guard, query or payload was
touched - so the claims are narrow and stated as such:

- The diff is `app/components/nav.ts` and `app/components/SidebarNav.tsx`. Every `/staff/*` door
  keeps its roles; no page gained or lost a server-side check.
- The three pages that come back into the rail are not newly reachable, only newly discoverable -
  and each already gates itself: `/admin/intake`, `/admin/ai/listings` and `/admin/customers` all
  enforce `admin`/`manager` server-side, which this job did not change.
- The nested twist is a real `<button type="button">` with `aria-expanded` and `aria-controls`, and
  its label names the entry it belongs to ("Expand Inventory Management"), so a screen-reader user
  meets two controls with two distinct purposes rather than one ambiguous row.
- A `soon` parent would hide its children rather than reveal them: `routable()` drops a placeholder
  and everything filed under it, because there would be no way to reach the parent that opens them.
  None of the three additions is a placeholder, but the rule is what keeps the shape sound.
