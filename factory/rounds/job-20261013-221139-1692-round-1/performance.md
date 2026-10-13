VERDICT: PASS

Fast-lane landing (owner directive). This fix is neutral-to-positive on cost:

- It removes one post-hydration render that previously flipped the nested group open, so a cold load
  of a nested page paints the right tree once instead of painting the wrong one and correcting it.
  That is one fewer layout pass on the routes it affects.
- `subGroupOf(pathname)` is called once per render instead of the two calls plus the local
  recomputation the first draft had, so the work does not grow.
- No new effect, no new fetch, no new state.
- Gate: `pytest -q` with the documented deselects is **301 passed / 4 deselected / 0 failed**, with
  this tree mounted over the baked image. `npx tsc --noEmit` exit 0 and `npx next build` exit 0, both
  against THIS worktree.
