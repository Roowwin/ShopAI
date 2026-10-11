VERDICT: PASS

Job job-20261011-183210-4321 (backoffice design system) round 2. Delta reviewed: `423ebfc..22ea7b1`. Both states built fresh with `node:20-alpine` + `rfo_backoffice_modules`.

## 1. CSS size - proportionate; the round-1 strays are gone (net win), and round 2 added three of its own
27,750 -> 27,933 B raw (**+0.66%**); gzip 5,442 -> 5,459 B (**+0.31%**); rules 343 -> 344.
CONFIRMED removed: `min-height:44px` 1 -> 0, plus `.border-slate-100`, `.bg-slate-100`, `.text-slate-900`, `.hover\:bg-slate-800` (the round-1 comment had emitted `border-t border-slate-100`, Button's comment the 44px rule, and the pre-token `layout.tsx` body + hand-rolled error buttons the slate classes). The surviving `.border-slate-200/300` come only from the excluded `assistant/page.tsx`.
**NEW (small, ironic):** round 2 ADDS `.ring-2`, `.ring-offset-2` and `.visible` - dead rules emitted by `Table.tsx:13`'s comment prose, i.e. the round-2 fix reproduces in its own comment the trap its neighbouring note warns about. ~90 B raw, ~30 B gzip. Immaterial, trivially fixed by writing the names as prose.

## 2. New primitives
`Select.tsx` duplicates the ~100-char control string from `Input.tsx` base (differing only by Input's `w-full` and its `TONES` map). Two near-identical control classes in two files **will** drift; a shared `controlClass` in `lib/ui.ts` would prevent it. Low cost, real maintenance risk.
`Input` `py-2.5` -> `py-2` does NOT break layout: every call site wraps the input in a fixed-width, auto-height div, and the change now lands Input/Select on Button's `min-h-[36px]`, aligning the assets/cms rows rather than breaking them. Remaining `py-2.5` in the sheet is only the excluded assistant page and the nav's own padding.

## 3. `py-1 -my-1` on the Table wrapper - no reflow, no nested scroll, no shift
No JS reads layout in the component, so no forced reflow. The 4px padding is offset by the -4px margin, so the wrapper's margin box equals the table height: no shift, and Card padding unchanged. Height is auto (content + padding), so the computed `overflow-y:auto` produces no scrollbar.

## 4. Client cost - no hooks/fetch, one new small leak
Delta adds zero `useEffect`/`useState`/`useCallback`/`useMemo`/`useRef` and zero fetch calls. Shared First Load JS unchanged at 103 kB. Route Size: +0.11 kB for pages that already imported `lib/ui`, but **+0.37-0.38 kB for login/newsletter/security**.
New finding: `Table.tsx` and `Stat.tsx` now `import { kickerClass } from "@/lib/ui"`, and because the barrel drags Table into every page (round-1 finding, still present), every page importing anything from `@/app/components/ui` now pulls the whole `lib/ui.ts` - verified by `bg-status-listed-soft` (the STATUS_TONE map) appearing in the round-2 login and newsletter chunks and not the round-1 equivalents. So those pages carry 10-status + 4-grade colour maps they never use. ~0.37 kB raw / ~0.15 kB gzip per page; avoidable by moving `kickerClass` to its own tiny module, or by the round-1 `"sideEffects": ["*.css"]` suggestion.
The three new Button variants add ~0.1 kB/page - not significant.

## 5. Other
All `Table` call sites pass the now-required `label`; no undefined aria-label. `tabIndex={0}` + `role="region"` add tab stops, not render cost. No inline `style={{}}`, no per-render object/array re-creation, no template-literal classNames.

Net: the rework is cheaper than round 1 (it removed the 44px and slate strays), holds CSS growth to +0.66% raw / +0.31% gzip, and changes no render behaviour.
