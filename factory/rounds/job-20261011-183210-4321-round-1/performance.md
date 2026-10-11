VERDICT: PASS

Job job-20261011-183210-4321 (backoffice design system). Commit reviewed: 423ebfc. Client-side cost only.

Method: both builds measured directly - the parent commit (`3d93845`) built in a temp dir using the same `node:20-alpine` + `rfo_backoffice_modules` volume, and the job build in its worktree.

## 1. Client boundaries - nothing gained "use client" that needed it; the barrel is NOT tree-shaken
- `git grep '"use client"'` over `app/components/ui` = zero hits; the storefront originals carry none either, so it is a faithful mirror, not an omission. Every consumer is a client page, so these modules land in the client bundle regardless. The diff adds zero `"use client"` lines.
- **Real finding:** the barrel (`app/components/ui/index.ts`) drags EVERY primitive into EVERY page chunk. Proof: `Badge.tsx:18`'s unused `tile` shape (`h-9 w-9 rounded-control`), `Button.tsx:11-12`'s `min-h-[36px]` and Table's `border-collapse text-sm` all appear in the **login** chunk and the **newsletter** chunk, though login imports neither Badge nor Table. Only `Stat` fell out.
- Measured cost: shared "First Load JS shared by all" **unchanged at 103 kB**; per-route Size +1.1-1.4 kB; per-route First Load +1-2 kB. Not a meaningful regression, but avoidable.

## 2. CSS size - proportionate, and additive rather than substitutive
- Parent 17,468 B / 258 rules -> job 27,750 B / 343 rules: **+10,282 B raw (+58.9%)**, gzip 3,996 -> 5,442 B (**+36%**). The delta is exactly +85 newly-emitted utility rules (~10 kB), not bloat.
- It does not net out smaller because the old raw-palette utilities (`bg-slate-900/950/50/100/200`, `bg-emerald-600`, `bg-indigo-600`, `ring-slate-200`, ...) are **still emitted** - the excluded pages still use them: `admin/assistant/page.tsx` (55 hits), `admin/page.tsx` (5), `admin/error.tsx` (2). In-scope pages have zero raw-palette matches. **The sheet carries both palettes today and shrinks as J5/J8 migrate those files** - do not read this growth as a regression.
- Over-generation: of 70 declared `:root` vars, 20 are referenced by no emitted utility (~600 B raw, 2.2%): the entire `*.solid` shape (`--grade-{a..d}-solid`, `--status-*-solid` x10) plus `--brand-200/800/950`, `--accent-50/500`, `--line-strong`. `brand` declares a full 10-shade scale while only 50/100/600 are emitted. The spec asked for the solid/soft/ink shape as headroom for J5/J6, so this is deliberate.
- Purge check on the built CSS passes, including `.bg-status-in_repair-soft` (underscore key escaping works) - the widened `./lib` glob is proven.

## 3. Render/behaviour - unchanged
`apiFetch` 35 -> 35 across the touched tree. The diff adds zero `useEffect`/`useState`/`useCallback`/`useMemo`/`useRef` lines and zero changed dependency arrays; `cms/page.tsx:31` and `newsletter/page.tsx:38` still `useEffect(..., [checked, allowed, load])`. No new fetch, no extra render pass.

## 4. Table wrapper - no forced reflow
`w-full overflow-x-auto` involves no JS layout read; one extra static DOM node per table. No nested-scroll conflict on in-scope pages. Minor non-perf note: `overflow-x-auto` alone makes overflow-y compute to `auto`, so a focus ring on the top/bottom edge cells can be clipped - worth knowing when the focusable-scroll fix lands.

## 5. Misc
Zero inline `style={{}}` added; zero template-literal classNames added; no object/array re-created per render. `statusTone`/`gradeTone` return module-level literals (property lookup, no allocation). Inline arrow `onClick`s are the pre-existing pattern.

## Follow-ups (recorded, NOT required of this job)
- `"sideEffects": ["*.css"]` in `apps/backoffice/package.json` would let the unused primitives fall out of page chunks (bare `false` is the footgun - it can drop the CSS import, so the array form is the safe one). ~1.2 kB/route; not worth build-config risk inside a design-system job.
- Drop the 20 unused `:root` vars once J5/J8 land and the headroom has been consumed.
