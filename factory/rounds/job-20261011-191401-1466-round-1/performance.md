VERDICT: CHANGES

Job job-20261011-191401-1466. Commit reviewed: 773f6ee.

## CSS grew, and the growth is entirely spurious
Merge-base `ded9067` CSS = 27,322 B; HEAD = 27,575 B (**+253 B**, +28 B gzipped). A **comment-stripped rebuild of HEAD is 27,322 B - byte-identical to baseline** - so the four intended class swaps (`bg-brand-600`->700, `hover:bg-brand-500`->800, `ring-brand-500`->700 x2) are net **zero bytes**. 100% of the growth is two rules emitted from comment prose.

## Claim "no class-shaped string in a comment emitted a rule" is FALSE
Definitive test (strip `/* */` from a copy of `app/**`+`lib/**`, rebuild, diff rule sets) shows exactly **two** rules added by comments and nothing else:
- `.ring { --tw-ring-shadow: ... calc(3px + ...) }` - from the prose "The focus ring every button shares" at `Button.tsx:23`.
- `.hidden { display:none }` - from the prose "is recorded rather than hidden" at `Input.tsx:15`.
Both are bare Tailwind utility names, i.e. exactly the "spelling a utility in prose" the spec forbids. It also perturbs `.ring-1` (its declaration merges into `.ring,.ring-1`). Neither rule has any real source usage - `ring`/`hidden` appear only inside larger tokens (`ring-1`, `overflow-hidden`) - so both are dead CSS.
**The `.hidden` one was missed by the other lenses** - two stray rules, not one.

## Claim "no bundle change beyond inlined class strings" is FALSE (measured, reproducible)
Comment bytes (present in the webpack module graph, stripped only at minify) flip a `splitChunks` threshold: the shared UI module moves out of per-page chunks into a common chunk. `app/admin/cms` page chunk 13,521 -> 6,795 B; `newsletter` 8,917 -> 2,191; total `static/chunks` 919,702 -> 912,994 B (~6.7 kB less). Shared `First Load JS` stays 103 kB and shared chunk hashes are unchanged. The direction is a shrink, but it is a real, unintended bundle change driven by **comment bytes**, not by the class edits - a comment-free build with the same class swaps reproduces baseline chunking exactly.

## Confirmed
No hook/fetch/import change (numstat 39/9; no `import`, state, `fetch`, `"use client"` or `dynamic()` lines). Emitted: `bg-brand-700`, `focus:ring-brand-700`, `focus-visible:ring-brand-700`, `hover:bg-brand-800`, `placeholder:text-ink-400`, `placeholder:text-ink-500`, `text-ink-500`. Gone as rules: `bg-brand-600`, `.ring-brand-500`, `.hover:bg-brand-500` (`--brand-600` survives only as the `:root` token / `brand.DEFAULT`, correctly). The `globals.css` comment is not scanned and shipped CSS is minified, so it costs nothing.

## Rerun note
Comparing against the `phase12-backoffice` **tip** is misleading - that tip is ahead of this job branch's base and carries unrelated dashboard work. Compare against the merge-base (`ded9067`).

Net: no correctness or runtime regression, but the report's central "no comment emitted a rule" claim is demonstrably false and the stylesheet grew rather than shrank. Fix: one word each in `Button.tsx:23` ("ring") and `Input.tsx:15` ("hidden").
