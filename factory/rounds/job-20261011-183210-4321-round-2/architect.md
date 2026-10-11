VERDICT: CHANGES

Job job-20261011-183210-4321 (backoffice design system). Delta reviewed: `423ebfc..22ea7b1`.

Both round-1 Required items are genuinely fixed. Everything I could test holds except one claim - the one I was asked to verify.

## F1 - VERIFIED, and the reason is now true
One definition: `kickerClass = "text-eyebrow uppercase text-ink-500"` (`lib/ui.ts:67`), used by `Table.tsx:47` and `Stat.tsx:19`. Grep for `text-eyebrow` returns only that definition plus prose - the two hand-spelled copies are gone. The stated reason is technically correct: a `<tr>`'s content model is only `<td>`/`<th>`/script-supporting content, so a `<p>`-rendering component cannot live in a header row. `index.ts:11-17` no longer repeats the false round-1 rationale.

## F2 - VERIFIED by independent computation
`--ink-500: 100 116 139` on `--surface: 255 255 255` = **4.76:1** (recomputed, not taken on trust). "Restores the pre-round-1 value" is true: `slate-500` = `#64748b` = `rgb(100 116 139)` = `--ink-500`, so assets/intake header text is byte-identical in colour to before.

## One control height - VERIFIED, with two precision caveats
Built CSS has exactly two `min-height` declarations: `min-h-[36px]` and `min-h-screen` (from cms/newsletter `<main>`s). So "36px is the only min-height" is imprecise; the true claim is "the only **control** min-height". No `44px` anywhere. Arithmetic confirmed in the emitted CSS: `text-sm` 20px box + `py-2` = 36px, matching Button's min-h, and Input/Select both land on it. `Sign out` is `<Button variant="onDark">`; the CMS toggle is `<Button size="inline">`. New variants documented; the storefront's five variants and three sizes are unchanged (additions only).

## A11y - VERIFIED; `py-1 -my-1` is sound, not a hack
`TH` defaults `scope="col"` with `{...rest}` after it (overridable). `label: string` is **required** (`Table.tsx:29-30`, no `?`), so a new call site cannot silently omit it, and all five call sites pass a distinct meaningful name. The `py-1 -my-1` geometry is exact (Button's `ring-2` + `ring-offset-2` = 4px) and layout-neutral.

## App frame - VERIFIED; nothing lost, exclusions untouched
`app/layout.tsx` adoption is value-exact. `ink-500` on `surface-sunken` = **4.34:1 (fails)**, `ink-600` = **6.92:1 (passes)** - confirmed independently; a naive 1:1 map would have shipped a failure. Error screens keep their previous typography and byte-identical copy. `cms`/`newsletter` gained a real `<h1>`, so all 7 pages now have one; `admin/page.tsx` and `admin/assistant/page.tsx` are absent from the diff.

## CHANGES - the comment invariant is FALSE, in the paragraph that declares it
"no class-like strings leak from comments anywhere in `app/**` or `lib/**`" is false. Sweeping all 32 source files and intersecting comment spellings with real selectors: **exactly two comment-only spellings emit real rules, both from `Table.tsx:13` - `ring-2` and `ring-offset-2`** (`.ring-2{...}`, `.ring-offset-2{...}` in the shipped stylesheet). Every source occurrence there is prefixed (`focus-visible:ring-2`), which emits different selectors. The offending line sits three lines above the note declaring the rule (`Table.tsx:18-21`).
Impact is dead CSS only (nothing carries those classes), but the builder's own round-1 argument was that such stray rules corrupt the CSS *as evidence*, and this job's acceptance rests on source and built CSS being in step.
Required: reword `Table.tsx:13` to prose, and state item 3's finding as "the only control min-height".

## AA sweep (recorded for the follow-up job)
- `text-white` on `--brand-600` = **3.77:1** confirmed - fails AA at 14px and 12px; covers every primary Button. Owner decision taken: darken to `brand-700`.
- `placeholder:text-ink-400` on white = **2.56:1** confirmed, mirrored from the storefront.
- **Undisclosed and inconsistent with the kicker fix**: three *content* strings still at `text-ink-400` on white = 2.56:1 - `cms/page.tsx` (`id {p.id}`, `{p.category}`) and `ai/listings/page.tsx` (keywords). Not regressions (1:1 maps of the pre-images' `slate-400`), but the kicker was raised for this exact ratio while these were left unmentioned.
- **Non-text (SC 1.4.11, 3:1)**: `--line` boundaries = **1.23:1** on white and the `brand-500` focus ring = **2.54:1**. Newly introduced (old inputs used a near-black `currentColor` border) and now also applying to the newly focusable table regions. Mirrored tokens, so they affect the storefront too.
- Everything else passes, including all 14 grade/status chip pairs (min 4.84).
