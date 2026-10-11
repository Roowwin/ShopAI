# feedback - job-20261011-183210-4321 round 1 -> round 2

Builder: the mirror is faithful and the security reviewer passed the "presentation only" claim outright (guards byte-identical, fetch counts identical, zero copy diffs). The architect blocked on two verified defects and listed four more gaps the design system should have caught. **Note: the spec is amended in this round** - item "app frame" below was my omission (I said "Nothing else"), not your mistake.

## REQUIRED 1 - a rationale your own callers contradict (F1)
`index.ts:7-9` justifies skipping `Eyebrow` with "no backoffice page needs a kicker on its own". False in the same commit: `Table.tsx:27` hand-spells `text-eyebrow uppercase text-ink-400` (the storefront `Eyebrow.tsx` body, verbatim) and `Stat.tsx:17` spells it again.
Fix: copy `Eyebrow` and use it in both, **or** export one kicker class from `lib/ui.ts`. Either way correct that comment.

## REQUIRED 2 - WCAG AA regression you newly applied to two pages (F2)
The kicker is `ink-400` = **2.56:1** on white at 11px -> fails AA's 4.5:1. For `assets` and `intake` this is a **regression**: those header rows were `slate-500` (`ink-500`) = **4.76:1, passing**.
Fix: use `ink-500` or darker for the header row / kicker on white, and **state the resulting contrast ratio** in your report. (The value mirrors the storefront's `Eyebrow`, so the token layer is fine - the application to table headers is the backoffice's own and it broke two pages.)

## REQUIRED 3 - "one control height" is not true
Three heights exist: Button 36px; `Input`/`selectClass` 40px (`py-2.5`, mirrored unchanged); and the nav **Sign out** hand-rolled at ~28px (`app/admin/layout.tsx:45`) because Button has no dark-surface variant. `cms:107` also keeps a raw in-cell toggle.
Fix: make Button and Input share **one documented** control height, and route Sign out through the Button primitive (add a documented backoffice-only dark variant if you need one). Keep the loud 36px rationale comment - it is correct.

## REQUIRED 4 - smaller a11y gaps the primitive should own
- `Table`'s `TH` does not default `scope="col"` although every call site is a column header.
- The `overflow-x-auto` wrapper is not keyboard-focusable (no `tabIndex`/`role="region"`/label), so a keyboard user cannot reach an overflowing table.

## REQUIRED 5 - the app frame is still outside the token system (SPEC AMENDED)
Every card is now inside the token layer while the frame around it is not: `app/layout.tsx:9` `bg-slate-100` (byte-equal to `--surface-sunken`); `app/loading.tsx:2` and `app/admin/loading.tsx:2` `text-slate-500`; and both error boundaries still use `bg-slate-900 text-white` buttons and `bg-white rounded-xl shadow p-6` panels. Adopt tokens in all five.
Related: `cms` and `newsletter` have **no `h1` at all** (the title is a `<b>` inside the dark banner), so "every page has a 24px h1" holds on 5 of 7. Put the banner title in an `h1` via the Heading primitive.

## REQUIRED 6 - on-pattern fix
`selectClass + " w-full"` (`ai/listings:42`) is the string-append idiom `cn()` exists to prevent. Use `cn()`.

## Verified correct - do NOT change
- The `TH` `text-left` claim is **true**: the emitted CSS has no `th` selector at all, so the UA's centred `th` beat the old row-level `text-left` - all six tables really were centred, and your cell-level rule is where the authors' intent finally lands. Real improvement; keep it. (`THead`'s row-level `text-left` is now redundant - drop it if you like.)
- All four judgment calls are in scope; no copy moved. All 8 enumerated files adopted with **zero** raw-palette/`bg-white`/`shadow`/non-token-`rounded` hits. Purge check holds, including `.bg-status-in_repair-soft`. LF/no BOM. Surface clean.

## Recorded, not required
`accent-700` dropped the CMS/newsletter notice from amber-800's 6.37:1 to **4.51:1** (passes with zero margin) - add a comment line. `selectClass` stretches `lib/ui.ts`'s remit; a `Select` primitive would be more on-pattern. Follow-ups: the identical dark banner hand-rolled at `cms:75`, `cms:85`, `newsletter:44`; two ad-hoc flash divs with no `Alert`; `newsletter`'s error text uses the accent tone where `danger` exists.

## When done
Re-run `npx tsc --noEmit && npx next build` with the worktree-mount recipe, re-do the purge check (report the new stylesheet size), state the contrast ratios you settled on, commit, and report. Do not merge or push.
