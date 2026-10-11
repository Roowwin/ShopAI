# feedback - job-20261011-183210-4321 round 2 -> round 3

Builder: both round-1 items are genuinely fixed and independently verified - the kicker has one definition
(`kickerClass`, recomputed at 4.76:1, restoring the exact pre-round-1 colour on assets/intake), and the
`ink-500`-on-`surface-sunken` catch (4.34:1 fails, so you used `ink-600` = 6.92:1) was a good save that a
naive 1:1 map would have shipped as a failure. Security and performance both PASS. This is a short round.

## REQUIRED 1 - the comment invariant is false, in the paragraph that declares it
You asserted "no class-like strings leak from comments anywhere in `app/**` or `lib/**`". It is false, and the
counter-example is `Table.tsx:13`: that comment spells **`ring-2`** and **`ring-offset-2`**, which emits
`.ring-2{...}` and `.ring-offset-2{...}` into the shipped stylesheet. Every real source occurrence is
prefixed (`focus-visible:ring-2`, `focus:ring-2`), which emits different selectors - so these two rules
exist *only* because a comment supplied them. The offending line sits three lines above your own note
(`Table.tsx:18-21`) declaring that utility names are written as prose.

Impact is dead CSS only (nothing carries those classes), so nothing renders differently. But your own
round-1 argument - that stray rules corrupt the CSS *as evidence* - is exactly why this matters, and this
job's acceptance rests on source and built CSS being in step.

Fix: reword `Table.tsx:13` so the utilities are prose, e.g. "Button's 2px ring plus its 2px offset is 4px".
Then re-run the purge check and confirm `.ring-2` / `.ring-offset-2` / `.visible` are gone from the emitted CSS.

## REQUIRED 2 - a precision fix in your report
"36px is the only `min-height`" is imprecise: the built CSS also has `min-h-screen` from the cms/newsletter
`<main>`s. The true claim is "the only **control** min-height". Say it that way.

## REQUIRED 3 - three undisclosed 2.56:1 strings, inconsistent with your own fix
You raised the kicker from `ink-400` to `ink-500` specifically because `ink-400` on white is 2.56:1 (fails
AA). Three *content* strings in the same pages are still at `ink-400` on white:

- `cms/page.tsx` - `id {p.id}` and `{p.category}`
- `ai/listings/page.tsx` - `{(draft.keywords ?? []).join(" | ")}`

These are **not regressions** (1:1 value maps of the pre-images' `slate-400`), but leaving them while raising
the kicker for the identical ratio is inconsistent. Raise them to `ink-500` in this round, or add a one-line
comment saying they are deliberately exempt and why. Your call which - but do not leave it silent.

## NOT yours to fix (a separate job will handle it)
The contrast audit: primary `text-white` on `brand-600` (3.77:1) -> `brand-700`; the placeholder tones; and
the **newly introduced** non-text failures - `--line` boundaries at 1.23:1 and the `brand-500` focus ring at
2.54:1 against the 3:1 SC 1.4.11 bar. The owner has decided the primary/placeholder direction; the ring and
boundary work needs its own round because it changes visible chrome. Just do not treat those tokens as
"correct" in your report - name the ratios.

## When done
Re-run `npx tsc --noEmit && npx next build` with the worktree-mount recipe, re-do the purge check (report the
new stylesheet size and confirm the three dead rules are gone), commit, and report. Do not merge or push.
