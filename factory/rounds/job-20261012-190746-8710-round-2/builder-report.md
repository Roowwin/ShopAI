# builder report — job-20261012-190746-8710 (round 2, and the round that landed)

## What the two rounds were

Round 1 (`56dee7e`) built the nested menu: the curated shortcut data, the desktop fly-out with its
hover delay, the keyboard path, and the mobile accordion. Round 1 came back CHANGES from two of the
three lenses on the same defect, and it was a real one:

**`Header.tsx` bound `NavDropdown` twice** - job 20's import plus the combined one this job added -
which is TS2300 twice and cannot compile. Confirmed by running `tsc --noEmit` with no pipe: two errors,
`TSC_EXIT=1`.

The worse failure was in how that was reported. Round 1 claimed "storefront build green (exit 0)". The
build was piped to `tail`, and **a pipeline reports the LAST command's status**, so a failed compile
exited 0. Every gated command in that round was shaped that way, which is why none of them could have
reported a failure. Round 2 fixes the code and the measurement.

## Round 2 (112327d) — the four fixes, all named by the reviewers

1. the duplicate import deleted (one binding, the `NavLink` type import intact);
2. security's LOW finding, which was a crash path rather than a nit: `NAV_SHORTCUTS[c.name]` was a
   prototype-inherited read, so a staff-created category named `constructor`/`toString`/`__proto__`
   came back as an inherited function - truthy, not an array - and the header threw rendering it.
   `navMenu.ts` now exposes `shortcutsFor()`, `Object.hasOwn`-guarded, used at both call sites;
3. the fly-out list gained `aria-label="Sub-categories of <category>"` (the architect's nit);
4. the hover timer is cleared in its own unmount-only effect (the leak both reviewers named).

## Evidence, with statuses taken from the command rather than from a pipe

```
docker compose run --rm --no-deps storefront sh -c "npx tsc --noEmit"   -> EXIT=0
docker compose run --rm api pytest -q <3 deselects>                    -> 120 passed, 3 deselected (37.36s)
docker compose run --rm --no-deps storefront sh -c "npm run build"     -> status 0, "Compiled successfully"
```

The gate count is unchanged from Job A's 120/3 - this job adds no test, and deliberately: a test
asserting "every curated shortcut resolves to stock" would itself depend on the demo seeder, which is
precisely the dependence Job A's rework removed. The check is a measurement on live data instead.

## The acceptance that mattered: every shortcut resolves

Measured against the DEPLOYED api (`https://api.rfo.localhost/store/catalog?category=<slug>&q=<term>`),
counting the array:

| shortcut | n | | shortcut | n |
|---|---|---|---|---|
| Accessories/Docks | 3 | | Networking/Switches | 5 |
| Accessories/Mice (`mouse`) | 1 | | Networking/Routers | 1 |
| Accessories/Keyboards (`keyboard`) | 1 | | Laptops/Gaming | 0 - not shipped |
| Accessories/Hubs, Webcams, Headsets | 1 each | | Laptops/Business, Ultrabooks | 0 - not shipped |

## What the served page CANNOT prove here, stated rather than implied

Everything this job changed renders **inside the menu**, which exists only while it is open - the
arrow buttons, the fly-out, the accordion are all absent from the HTML at rest and are rendered
client-side (the categories themselves are fetched in an effect). So there is no served-markup check to
run for the markup itself, and the architect was right to call that an evidence gap rather than a code
defect. What is checkable on the deployed site is what matters most - that each shortcut's URL resolves
to stock, above - plus the browser-only items: the hover feel, the real focus order, and the 200ms
delay in practice.

## Non-blocking notes carried forward

- `Object.hasOwn` is not transpiled or polyfilled, so it needs Chrome 93+ / Safari 15.4+. Acceptable
  under Next 15's modern baseline; recorded because it is a real compatibility floor.
- The round-1 decision line prints its verdicts in hashtable order (the factory script joins
  `$verdicts.Values`), so "CHANGES / PASS / CHANGES" does not map to architect/security/performance in
  that order. The verdict files themselves are unambiguous.
