# backoffice a11y: contrast audit (primary CTA, focus ring, placeholders)

## Context
The design-system job (J4) produced a full text/UI colour-token audit. Several pairs fail WCAG AA, and the owner has decided the direction for the first two. This job applies them to the **backoffice** and reports the complete ratio table. A **paired change on `storefront-design-system`** will follow (the two apps' tokens are byte-identical), so keep every edit here minimal and mirror-exact - the orchestrator will reproduce it on the storefront branch and the two should be diffable.

The token values are in `apps/backoffice/app/globals.css` as channel triples; compute every ratio from those, do not take a number on trust (mine are below, but verify them yourself).

## Decisions already taken (do not re-litigate)
- **Primary CTA: darken.** White on `--brand-600` (5 150 105) = **3.77:1**, which fails AA for the 14px/12px label text on every primary button. White on `--brand-700` (4 120 87) = **5.55:1**, passing comfortably.
- **Placeholders: fix.** `ink-400` (148 163 184) on white = **2.56:1**, fails.
- **`--line` boundaries: KEEP as-is.** `--line` (226 232 240) on white = **1.23:1**, below SC 1.4.11's 3:1 for component boundaries. This is a **deliberate, recorded exception**: raising it would put mid-grey borders on every card and input in both apps, which is a visible design change the owner has chosen against. Record it in a comment - see the constraint below on how to write that comment.

## Deliverable
1. **`app/components/ui/Button.tsx`** - `primary` variant: base `bg-brand-600` -> **`bg-brand-700`**, and hover `hover:bg-brand-500` -> **`hover:bg-brand-800`**.

   **Both states must clear 4.5:1**, not just the resting state - that is why the hover shade moves too. Do not set hover to `brand-600` (white on it is 3.77:1, so hovering would drop below AA). `--brand-800` is (6 95 70) = **7.67:1**; verify.

2. **Focus rings must clear SC 1.4.11's 3:1.** `--brand-500` (16 185 129) on white = **2.56:1**, below it. Change the focus ring from `brand-500` to **`brand-700`** (5.55:1) in:
   - `Button.tsx` (`focus-visible:ring-brand-500`)
   - `Input.tsx` (`focus:ring-brand-500`)
   - `Select.tsx` (`focus:ring-brand-500`)
   Report every occurrence you change with file:line. Do not change ring *widths* or offsets.

3. **`app/components/ui/Input.tsx`** - swap the placeholder tones (they are currently the wrong way round for their backgrounds):
   - `light` (and `sunken`): `placeholder:text-ink-400` -> **`placeholder:text-ink-500`** (4.76:1 on white; on `surface-sunken` it is 4.55:1 - verify it still clears)
   - `dark`: `placeholder:text-ink-500` -> **`placeholder:text-ink-400`** (6.96:1 on `ink-900`; the current value is 3.74:1, which fails).

4. **Sweep for any other white-on-brand-600 surface.** White on `brand-600` fails at any normal text size, so any badge, chip or pill using `bg-brand-600 text-white` must move to **`bg-brand-700`** (e.g. an "Eco choice"-style badge). Grep for it, fix what you find, and list each with file:line - or state that you found none.

5. **Report the full ratio table** for every text-on-token pair actually used in the backoffice (buttons' variants, badges/pills, status/grade chips, nav, banners, error text, loading text, table cells, placeholders, focus rings as non-text). For each: the two channel triples, the computed ratio, and pass/fail against 4.5:1 (text) or 3:1 (non-text). **Flag any pair still failing** rather than rounding it away - a short honest "still below" list is the point of the job.

6. **Record the `--line` exception in a comment.** It must be prose, not class syntax: Tailwind scans comments as text and a class-shaped string in a comment emits a real rule (this has bitten three times in this repo - `apps/backoffice/app/components/ui/Button.tsx` currently has a note about it). Write e.g. "the hairline boundary is deliberately left below the 3:1 non-text bar - recorded exception, see ADR" without spelling a utility.

## Acceptance
- `npx tsc --noEmit` and `npx next build` green in the worktree:
  `docker run --rm -v "<worktree>/apps/backoffice:/app" -v rfo_backoffice_modules:/app/node_modules -w /app node:20-alpine sh -c "npx tsc --noEmit && npx next build"`
- **Your own ratio computations**, shown as working (channel triple -> relative luminance -> ratio). Do not cite the numbers above without recomputing: two of them exist because a value was mirrored without re-checking contrast at its new application site.
- **Purge check** on the built CSS: confirm `bg-brand-700`, `ring-brand-700` and `text-ink-500` are emitted, and report whether `bg-brand-600` still appears anywhere and what still uses it.
- Gate no-regression: `docker compose build api` + `docker compose run --rm api pytest -q` (nothing backend changes). Report the count.
- Allowed surfaces: `apps/backoffice/app/components/ui/**`, `apps/backoffice/app/globals.css` (only if you add the exception comment there instead), `apps/backoffice/tailwind.config.ts` (only if a token value genuinely must change - it should not). Anything else = **CHANGES**.
- Do **not** change `--line`/`--line-strong` values, do not touch `apps/storefront/**` (different branch, orchestrator handles it), and do not edit the dashboard or any page.

## Constraints
- Work only on branch `factory/<job-id>` (worktree provided) - LF / no BOM; PS 5.1 write rules
- Do NOT touch: `.env`, `secrets/`, `infra/`, `alembic`, `factory/*`, `apps/backend/**`, `apps/storefront/**`
- The storefront mirrors these files. Where you make a deliberate divergence, say so in a comment as the existing 36px-min-height note does.
