# security review round 2

- Portal does not widen the trust boundary: `createPortal(..., document.body)` (CommandPalette.tsx:109,149) renders the same static list - `flatNav()` from the one `GROUPS` table (CommandPalette.tsx:28, nav.ts:12-38) - client-side, for the same authenticated user, with no new import beyond `react-dom` (already a dep) and no request (`fetch(`/`api`/`dangerouslySetInnerHTML` absent from the whole delta).
- localStorage flag and its guards untouched: round 2 does not modify `layout.tsx` at all (8 changed files listed; layout.tsx absent), so `COLLAPSE_KEY`/`readCollapsed`/`writeCollapsed` with both try/catch ends remain as round 1 (layout.tsx:38,44,47) - boolean flag only, nothing else stored.
- No auth/session/api surface moved: delta touches no `lib/session.ts`, `lib/api.ts`, or the Sign out handler; the cms banner edit is in the banner markup only, the client role-gate branch around it is unchanged (cms/page.tsx:71-74).
- No user-typed text reaches the DOM as markup: filter is still plain `String.includes` (CommandPalette.tsx:32, no regex), labels render as JSX children `{h.label}`/`{h.heading}` (CommandPalette.tsx:138-139); the key handler moved to the wrapper div (CommandPalette.tsx:112) and `aria-modal` was dropped - UI/a11y only, no security effect.
- No dependency or out-of-scope file entered the diff: all 8 files are under `apps/backoffice/` (no `package.json`, backend, storefront, `.env`, `factory/`); remaining edits are class strings (`text-ink-inverse`, `hover:bg-brand-800`, banner tones) and two `--line`/`--line-strong` token values in globals.css.

VERDICT: PASS
