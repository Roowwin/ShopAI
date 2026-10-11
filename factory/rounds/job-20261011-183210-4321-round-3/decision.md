# decision job-20261011-183210-4321 round 3

VERDICTS: PASS / PASS / PASS
DECISION: APPROVE

Round 2's blocking item is closed and proven closed-world rather than by spot check: strip block comments
from a copy of `app/**` + `lib/**`, test every single-word class selector in the shipped CSS against it -
**13 selectors, 0 absent**; the hyphenated direction gives 0; and `.ring-2`, `.ring-offset-2`, `.ring` all
went 1 -> 0. The stylesheet dropped 611 B with **zero added selectors**, and the six contrast strings moved
2.56 -> 4.76:1 with their text byte-identical.

Recorded with approval, including one correction to what I told the owner earlier:
- **`.table` is NOT absent.** It is still emitted, unchanged since round 1, and it is **not** comment-sourced -
  it comes from the `<table className=...>` element, because `table` is also a utility. The builder's negative
  control (`.div`/`.thead`/`.section` absent) was unsound: those words are not utility names. Accurate
  statement: ".table is emitted by the `<table>` element, not by any comment." Not actionable in code.
- The NOTE's comment rule is keepable and mechanically checkable. Optional addendum: it should also say that
  scanned *data* (option values, prop values) and utility-shaped element names emit rules, so "no comment
  leaks" is not read as "no dead rules".

Recorded for the follow-up contrast job (owner decisions already taken): primary `text-white` on `brand-600`
= 3.77:1 -> `brand-700`; placeholder tones (light `ink-400` -> `ink-500`; dark `ink-500` -> `ink-400`); and
the newly introduced **non-text** failures - `--line` boundaries 1.23:1 and the `brand-500` focus highlight
2.54:1 against SC 1.4.11's 3:1 bar, now also applying to the newly focusable table regions.

Two sub-kB perf follow-ups recorded, not required: the `app/components/ui/index.ts` barrel defeats per-page
tree-shaking (and `kickerClass` in `lib/ui.ts` now pulls the whole status/grade map into login/newsletter/
security), and `Select` duplicates `Input`'s control string. The safe barrel fix is `"sideEffects": ["*.css"]`,
which is build-config risk and does not belong in a design-system job.

Gate: 38 passed / 4 deselected (nothing backend changed across all three commits).
