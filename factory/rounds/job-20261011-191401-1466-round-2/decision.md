# decision job-20261011-191401-1466 round 2

VERDICTS: PASS (architect/a11y) / PASS (performance) - security not re-run, see below
DECISION: APPROVE

Both round-1 blockers are closed and independently verified with **reviewers' own tooling**, not the builder's:

- The comment trap is genuinely closed: each reviewer wrote its own comment-stripper, and both produced
  **byte-identical** CSS with an empty set difference (one matched the hash outright; the other, on a raw-CLI
  pipeline, showed `0 bad ranges` - every removed range began with `//` or `/*`). `.ring`/`.hidden` are 0 in the
  shipped CSS.
- The `globals.css` false claim is gone; the comment now states only the exception with no claim about how the
  file is read.
- The reachability corrections are applied: `muted` hover fixed and reachable (6.92:1); `danger` hover left as a
  **recorded latent exception in-file** - the right trade, since it needs a cross-app token to close a 0.09
  shortfall on an unreached state; the sunken placeholder split to `ink-600` with the mirror-aware rationale.
- `+227 B` CSS is exactly the two new `placeholder:text-ink-600` rules; the six intended swaps are rule-neutral.

## Review coverage - stated explicitly
The round-2 delta is **comment text plus two class-string literals** (`muted`, `sunken`). I re-solicited the
**architect/a11y** and **performance** lenses, which raised round 1's blockers. **Security was not re-run**; its
round-1 PASS covers the unchanged surface, and a delta with no behaviour, data, authz or surface change has
nothing for that lens to add. This record says so rather than implying three fresh reviews.

## Carried forward
1. **Mirror the same three edits onto `storefront-design-system`** (`ui/Button.tsx`, `ui/Input.tsx`,
   `globals.css` - the storefront has no `Select.tsx` and no `Table.tsx`). The sunken placeholder is the one that
   matters there: the storefront's header search is the caller that needs that tone to clear.
2. **Maintainer note:** comment byte volume in `app/**` perturbs webpack's `splitChunks` threshold, so comment
   edits can silently reshape chunks (benign here - a net shrink).
3. Still-below list, unchanged and accepted: the `--line`/`--line-strong` hairline exception (1.23/1.48), the
   soft boundary rings (1.08-2.36), and the raw-palette pairs on `admin/assistant/page.tsx` (out of surface;
   that page is reworked in J8).

## Program-level lesson (now an acceptance step)
This trap cost **five** findings across the program by the time it was closed (`bg-slate-500`, `min-h-[44px]`,
`ring-2`+`ring-offset-2`, `ring`+`hidden`, and the third instance the builder caught while fixing the second). A
rule in a spec does not stop it. The closed-world check - strip comments from a copy of `app/**`+`lib/**`,
rebuild, and diff the emitted rule set (or hash) against a comment-free build - is now an acceptance step for
any job that writes comments in scanned source.
