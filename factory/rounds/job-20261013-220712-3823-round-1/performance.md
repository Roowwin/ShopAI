VERDICT: PASS

Fast-lane landing (owner directive). The change is static data plus one extra render branch:

- `routable()` is a single recursive `flatMap` over 6 groups / 18 entries, called during render and
  by `flatNav`; there is no new effect, fetch or state beyond one more `useEffect` keyed on the
  current route string that runs only on navigation.
- The nested panel is rendered into the shipped markup and closed with `hidden`, exactly as a
  category's is, so opening it costs no layout work and no second render pass.
- One more query-free `useEffect` per route change (opening the group that contains the page) - the
  same shape and the same cost as the category one that already existed.
- Gate: `pytest -q` with the documented deselects is **301 passed / 4 deselected / 0 failed**, with
  this tree mounted over the baked image. `npx tsc --noEmit` exit 0 and `npx next build` exit 0, both
  run against THIS worktree.
