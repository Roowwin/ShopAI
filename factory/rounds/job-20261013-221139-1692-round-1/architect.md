VERDICT: PASS

Fast-lane landing (owner directive). A one-line-class defect found by reading the RENDERED output
rather than the source, and fixed where the argument already existed.

- The bug: on a cold load of a nested page, the category was open in the shipped markup but the
  nested group was not (`aria-expanded="false"`, panel `hidden=""`), so the operator's own page sat
  inside a shut disclosure at first paint and only a post-hydration effect opened it.
- The fix is the argument the component already makes for categories: both ids are pure functions of
  the pathname, so both are decided in the state initialiser and the server sends the correct tree on
  the first byte. The effect is kept for the case the initialiser cannot cover - arriving by
  navigation, where the sidebar is already mounted and there is no first draw to get right.
- No new abstraction: one `currentSub` computed once and read by both paths, replacing the local
  recomputation and the double call the first draft of this fix had.
- Verified in the SHIPPED markup rather than by reading code: `/admin/intake` now renders
  `aria-expanded="true"` with `aria-label="Collapse Inventory Management"` and a panel carrying no
  `hidden` attribute.
