VERDICT: CHANGES

Job job-20261011-183210-4321 (backoffice design system). Commit reviewed: 423ebfc.

## Fidelity: essentially perfect (verified mechanically, not by eye)
- All 42 storefront `:root` variables are value-identical; the only additions are the 30 `--status-*` (`globals.css:62-91`).
- `tailwind.config.ts` `colors` is identical apart from comments plus the additive `status` group (`:84-96`).
- `cn.ts` is **byte-identical** (same md5).
- `Button`/`Card`/`Badge`/`Input`/`Heading` differ from the storefront copies **only in comments**, except Button's `min-h`. No variant renamed, no class dropped, no different radius.
- `index.ts` legitimately diverges (adds Table/Stat, drops Eyebrow/EmptyState/ProductCard) - but its rationale is wrong (F1).
- Comment-only edits in the mirrored files mean the two copies are no longer plain-`diff`-able, which `index.ts` declares as the sync mechanism. Cosmetic.

## REQUIRED F1 - a rationale its own callers contradict
`index.ts:7-9` justifies skipping `Eyebrow` with "no backoffice page in this job's scope needs a kicker on its own (Table's header row owns that)". **False in the same commit**: `Table.tsx:27` hand-spells `text-eyebrow uppercase text-ink-400` - the storefront `Eyebrow.tsx` body verbatim - and `Stat.tsx:17` spells it again. A mirrored component was skipped on a rationale two of its own callers refute, and the same class string now lives in two primitives.
Fix: copy `Eyebrow` and use it in both, **or** export a single kicker class from `lib/ui.ts`; either way correct the comment.

## REQUIRED F2 - WCAG AA regression newly applied to two in-scope pages
The kicker colour is `ink-400` = **2.56:1** on the white card at 11px (not "large text"), so it fails AA's 4.5:1. For `assets` and `intake` this is a **regression**: their header rows were `text-slate-500` (`ink-500`) = **4.76:1, passing**, and are now `ink-400` = 2.56:1, failing. (cms/newsletter were already `slate-400`, failing, and are now also 1px smaller.) The value mirrors the storefront's `Eyebrow`, so the token layer is not at fault - the *application* to table headers is, and it newly breaks two pages.
Fix: use `ink-500` (or darker) for the header row / kicker on white, and state the resulting contrast ratio in the report.

## REQUIRED - "one control height" is not true
Three heights exist: Button 36px (`Button.tsx:12`); `Input`/`selectClass` 40px (`py-2.5`, mirrored unchanged, `lib/ui.ts:51`); and the nav **Sign out** hand-rolled at ~28px (`app/admin/layout.tsx:45`) because the Button set has no dark-surface variant. `cms:107` also keeps a raw in-cell toggle.
Fix: make Button and Input share one documented control height, and route Sign out through the Button primitive (add a documented backoffice-only dark variant if needed). The 36px rationale itself is documented correctly and loudly - keep it.

## REQUIRED - smaller a11y gaps the primitive should own
- `Table`'s `TH` does not default `scope="col"` even though every call site is a column header.
- The horizontal-scroll wrapper is not keyboard-focusable (no `tabIndex`/`role="region"`), so a keyboard user cannot reach an overflowing table.

## REQUIRED - the app frame is still outside the token system
My spec enumerated seven pages and said "Nothing else", so this is my omission, not the builder's - but every card is now inside the token system while the frame around it is not: `app/layout.tsx:9` `bg-slate-100` (byte-equal to `--surface-sunken`), and `app/loading.tsx:2` + `app/admin/loading.tsx:2` `text-slate-500`. The two error boundaries still use `bg-slate-900 text-white` buttons and `bg-white rounded-xl shadow p-6` panels. **Spec amended**: adopt tokens in `app/layout.tsx`, both `loading.tsx`, and both `error.tsx`.
Related: `cms` and `newsletter` have **no `h1` at all** - their title is a `<b>` inside the dark banner - so "every page has a 24px h1" holds on 5 of 7 pages. Put the banner title in an `h1` via the Heading primitive.

## REQUIRED - on-pattern fix
`selectClass` is used with string concatenation (`selectClass + " w-full"`, `ai/listings:42`) - the exact append idiom `cn()` exists to prevent. Use `cn()`.

## Verified correct (no action)
- **The `TH` `text-left` claim is TRUE.** The emitted CSS has `table{...}` and **no `th` selector of any kind**, so the UA's centred `th` beat the old row-level `text-left`; all six tables really were rendering centred headers and `Table.tsx:41-45` is where the authors' intent finally lands. Presentation-only, real improvement. (`THead`'s own row-level `text-left` at `:27` is now redundant.)
- All four judgment calls are in scope for "presentation only": no copy moved anywhere in the diff.
- All 8 enumerated files adopted; `git grep` for raw palette/`bg-white`/`shadow`/non-token `rounded-*` inside them returns **zero hits**. Idioms drop 5/5/7 files -> 2/0/3.
- `app/admin/layout.tsx` behaves: only classNames changed; active-link logic, `aria-current` and logout+`router.replace("/")` untouched; colour substitutions value-exact.
- Table wrapper is correct (`overflow-x-auto` outside `<table>`, so a future `<caption>` stays valid); `TR` keeps `border-t border-line`.
- Purge check holds, including `.bg-status-in_repair-soft` (underscore key compiles) - proving the widened `./lib` glob works.
- LF/no BOM in new files (0 CR bytes in the blobs).

## Recorded, not required
- `accent-700` flash moved the CMS/newsletter notice from amber-800, dropping contrast **6.37:1 -> 4.51:1** (text-sm, AA-required). Passes with zero margin; worth a comment line.
- `selectClass` is a mild stretch of `lib/ui.ts`'s stated remit; a `Select` primitive would have been the on-pattern choice.
- F3 follow-ups: the identical dark banner is hand-rolled at `cms:75`, `cms:85`, `newsletter:44` (never primitivised - and it swallows the page title, which is why those two pages have no h1); two ad-hoc flash divs with no `Alert`; `newsletter`'s error text uses the amber accent tone where the new `danger` group exists.
