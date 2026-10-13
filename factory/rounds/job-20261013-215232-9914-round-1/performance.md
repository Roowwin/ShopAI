VERDICT: PASS

Fast-lane landing (owner directive). The nav is a static data change plus one render list, so there
is nothing to profile - what is worth recording is that nothing got slower:

- `GROUPS` is a module-level literal of 6 groups / 15 items; `flatNav()` and `allNav()` are one
  `flatMap` each over it, called once per render. No new effect, no new fetch, no new state.
- The sidebar still renders every category's panel into the shipped markup (`hidden` closes it), so
  there is no layout shift on open and no second render pass.
- The command palette's list got SHORTER (3 placeholders filtered out), so its filter loop is
  marginally cheaper than before.
- Gate: `pytest -q` with the documented deselects is **301 passed / 4 deselected / 0 failed**, with
  this tree mounted over the baked image. `npx tsc --noEmit` exit 0 and `npx next build` exit 0 (run
  against THIS worktree - an earlier run in this job pointed at the main tree by mistake, which is
  worth stating since a build result is only meaningful with the tree it came from).
