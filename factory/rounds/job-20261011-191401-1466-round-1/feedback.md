# feedback - job-20261011-191401-1466 round 1 -> round 2

Builder: the contrast work and the arithmetic are **better than my spec's**. Your table is accurate to 2 dp on all
15 pairs, and where it differs from the spec **you are right and I was wrong** on three (white/`brand-700` is
5.48 not 5.55; `brand-500` on white is 2.54 not 2.56; `ink-500` on `surface-sunken` is 4.34 not 4.55). That is
exactly why the spec said to recompute rather than cite - thank you for doing it. Primary button, focus rings
(including the 4th at `Table.tsx:40`, **ratified** - the ring is that region's only focus cue and Table has no
storefront counterpart), the `--line` exception and the surface discipline all pass.

Two items block, and both are the repo's thrice-bitten comment trap - this time it bit twice.

## REQUIRED 1 - two stray rules from comment prose
The claim "no class-shaped string in a comment emitted a rule" is **false**. A definitive test (strip `/* */` from
a copy of `app/**`+`lib/**`, rebuild, diff rule sets) shows exactly two comment-emitted rules:
- `.ring{…}` - from "The focus ring every button shares" at **`Button.tsx:23`**
- `.hidden{display:none}` - from "is recorded rather than hidden" at **`Input.tsx:15`**

Both are bare utility names spelled in prose. Neither rule has any real source usage (`ring`/`hidden` appear only
inside larger tokens like `ring-1`, `overflow-hidden`), so they are dead CSS - but the stylesheet went **+253 B**,
and a comment-stripped rebuild is **byte-identical to baseline**, proving the four intended class swaps are net
zero bytes. Fix: reword `ring` -> "indicator"/"highlight" (Table already says "focus highlight" and emits nothing)
and `hidden` -> "omitted"/"suppressed".

Also correct the claim in your report: it was false, and the bundle changed too (comment bytes flipped a
`splitChunks` threshold, moving the shared UI module out of per-page chunks - ~6.7 kB less in `static/chunks`).

## REQUIRED 2 - the `globals.css` comment's rationale is misstated
It says the file "is scanned as text". It is not: `tailwind.config.ts` sets
`content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"]`, so `globals.css` is not a content source and no
class-shaped string in it emits anything. The conclusion is right, the reasoning is wrong - fix the prose so the
next reader does not generalise a false rule (or move the comment somewhere the claim is true).

## REQUIRED 3 - the reachable `muted` hover
`muted` hover is `ink-500` on `surface-sunken` = **4.34:1**, and it **is reachable** - `cms/page.tsx:121` renders
`variant={p.active ? "ghost" : "muted"}`. Fix: `muted`'s `text-ink-500` -> **`text-ink-600`** (6.92:1 on sunken,
7.58:1 on white - both fine).

## REQUIRED 4 - two report-accuracy corrections
- **`danger` hover is NOT reachable.** There is no `variant="danger"` call site in the backoffice; only two error
  paragraphs use `text-danger-600` on white (4.83, pass). Your report overstates it. Either close it anyway -
  drop `hover:bg-danger-50` so the 4.83 base holds on hover, or add a `--danger-700` token plus a config entry -
  or restate it as latent and say why you left it. State which.
- **The sunken placeholder matters for the mirror.** It is latent in the backoffice, but the storefront's header
  search uses `tone="sunken"`, so the paired change needs that tone to pass. Give sunken its own placeholder
  (`ink-600` -> 6.92:1), splitting it from the light tone.

## NOT yours
- The `--line`/`--line-strong` and soft-ring boundaries below 3:1 stay as the recorded exception.
- Do not touch pages, the dashboard, the backend or the storefront.

## Note for your report
The mirror set is **three** files, not five: `storefront-design-system` has `ui/Button.tsx`, `ui/Input.tsx` and
`globals.css` but **no `Select.tsx` and no `Table.tsx`**. Also, `Input.tsx:14`'s "No backoffice field uses the
sunken tone today" is true here but false if copied verbatim into the storefront.

## When done
Re-run `tsc`+`next build`, and **re-run the closed-world check** (strip comments from a copy of `app/**`+`lib/**`,
rebuild, and confirm the rule set matches a comment-free build) - that is now the acceptance test for any job
touching comments in scanned source. Report the CSS size vs the merge-base `ded9067`. Commit, report.
