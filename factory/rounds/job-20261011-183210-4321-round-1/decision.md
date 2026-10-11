# decision job-20261011-183210-4321 round 1

VERDICTS: CHANGES / PASS / PASS
DECISION: ESCALATE

The mirror is faithful (42 storefront `:root` vars value-identical, `cn.ts` byte-identical, primitives
differing only in comments) and the security reviewer passed the "presentation only" claim outright:
client role gates byte-identical to base, `apiFetch`/`onClick` counts identical per page, endpoint
literals identical, zero user-visible copy differences, surface clean.

Two blocking defects, both verified by the architect, plus four gaps the design system should own:

1. **F1** - `index.ts` justifies skipping `Eyebrow` with a rationale its own callers refute
   (`Table.tsx:27` and `Stat.tsx:17` hand-spell the storefront `Eyebrow` body verbatim).
2. **F2** - a **WCAG AA regression newly applied to `assets` and `intake`**: their header rows went
   from `slate-500` (4.76:1, passing) to `ink-400` (2.56:1, failing) at 11px.
3. "One control height" is not true: Button 36px, Input 40px, nav Sign out ~28px hand-rolled.
4. `Table`'s `TH` does not default `scope="col"`; the scroll wrapper is not keyboard-focusable.
5. **Spec amended** - the app frame is outside the token system (`app/layout.tsx`, both `loading.tsx`,
   both `error.tsx`), and `cms`/`newsletter` have no `h1` at all. This was the orchestrator's omission
   (the spec said "Nothing else"), not the builder's.
6. `selectClass + " w-full"` uses the append idiom `cn()` exists to prevent.

Verified correct and NOT to be changed: the `TH` `text-left` claim is true (the emitted CSS has no `th`
selector, so six tables really were centred - the cell-level rule is where the authors' intent lands);
all four judgment calls are in scope; adoption is complete within the enumerated files with zero
raw-palette hits.

Performance PASSed with the growth explained rather than excused: CSS +59% raw / +36% gzip (+85 rules),
additive because the **excluded** pages still emit the old raw-palette utilities, so the sheet carries
both palettes until J5/J8 migrate them. First Load JS shared unchanged at 103 kB; per-route +1-2 kB.
Recorded follow-ups (not required): `"sideEffects": ["*.css"]` to let the barrel tree-shake, and
dropping the 20 unused `:root` vars once J5/J8 consume the headroom.
