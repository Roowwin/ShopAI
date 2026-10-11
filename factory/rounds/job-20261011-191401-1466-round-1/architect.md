VERDICT: CHANGES

Job job-20261011-191401-1466. Commit reviewed: 773f6ee.

## Ratios: the builder's table is accurate to 2 dp on all 15 pairs; MY SPEC WAS WRONG ON THREE
Recomputed independently from the channel triples. Where builder and spec differ, **the builder is right**: white/`brand-700` = **5.484** (spec said 5.55), `brand-500`/white = **2.537** (spec 2.56), `ink-500`/`surface-sunken` = **4.344** (spec 4.55). These are precisely the "mirrored without re-checking at the new application site" values the spec warned about. No pair is wrong in either direction.

## PASS
1. **Primary Button** - `bg-brand-700 hover:bg-brand-800`; base 5.48, hover 7.68, both clear 4.5:1, and hover is *darker* than base so it cannot drop below the resting state. Emitted CSS has both rules.
2. **Focus rings** - changed at `Button.tsx:17`, `Input.tsx:31`, `Select.tsx:17`, `Table.tsx:40`; `ring-brand-500` fully purged; ring widths/offsets untouched. **Keeping Table is correct**: `Table.tsx:40-43` is `tabIndex={0} role="region" aria-label`, so the ring is the region's only focus cue - without it the region is focusable but invisible. `index.ts` documents Table/Stat/Select as admin-only primitives with no storefront counterpart, so it is correctly excluded from the mirror set.
6. **Token values / surfaces** - `globals.css` diff is comment-only; `--line`/`--line-strong` unchanged; `tailwind.config.ts` untouched; only the five allowed files.

## BLOCKING (two items)
**1. A stray rule from the new comment.** `Button.tsx:20-26` spells the bare word **"ring"** twice, emitting `.ring{…}` into the CSS. Verified three ways: the parent tree has zero bare `ring` tokens in scanned files; the only bare-`ring` tokens in the job tree are those two comment lines; a pre-job build has no `.ring`. It is the repo's thrice-bitten rule and an explicit spec constraint. Fix: reword to "indicator"/"highlight" (Table already uses "focus highlight" and emits nothing).
**2. The `globals.css` exception comment's rationale is misstated.** It claims the file "is scanned as text", but `tailwind.config.ts` sets `content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"]`, so `globals.css` is **not** a content source. No class-shaped string in it emits anything - the conclusion is right, the reasoning is wrong. Correct the prose so the next reader does not generalise a false rule.

## Reachability corrections
- `muted` Button hover `ink-500`/`surface-sunken` = **4.344 ✓ and reachable** (`cms/page.tsx:121` renders `variant={p.active ? "ghost" : "muted"}`). Fix: `muted` `text-ink-500` -> `text-ink-600` (6.92:1 on sunken; 7.58:1 on white, still fine).
- `danger` hover `danger-600`/`danger-50` = **4.415 ✓ but NOT reachable** - there is no `variant="danger"` call site in the backoffice (only two error paragraphs at `assets/page.tsx:115` / `intake/page.tsx:125`, `text-danger-600` on white = 4.83, pass). The builder's report overstates it as reachable. There is no `--danger-700` token. Either close it (drop the `hover:bg-danger-50` so the 4.83 base holds, or add `--danger-700` + a config entry) or restate it as latent and say why it is left.
- Latent sunken placeholder 4.34 - confirmed latent (no `tone="sunken"` call site in the backoffice). **It matters for the mirror**: the storefront's header search uses sunken, so the paired change must give that tone a passing placeholder (e.g. `ink-600`).

## Mirror set is SMALLER than the brief assumed
`storefront-design-system` has `ui/Button.tsx`, `ui/Input.tsx` and `globals.css` - and **no `Select.tsx` and no `Table.tsx`**. So the paired change is three files, not five. Token values are genuine byte-identical sources, so the ratios transfer 1:1. Two wrinkles: the two Buttons already diverge beyond this job (36px vs 44px, extra `onDark`/`muted`/`inline`), so "diffable" holds for the token lines only; and `Input.tsx:14`'s "No backoffice field uses the sunken tone today" is true here but false if copied verbatim.
