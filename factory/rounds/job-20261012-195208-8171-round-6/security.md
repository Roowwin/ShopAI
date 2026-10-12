# security review round 6

- Value-only move of one declaration: `--tw-ring-offset-color: rgb(var(--surface))` now sits on `*, ::before, ::after` inside the existing `@layer base` (globals.css:26-34), replacing the `:root` copy that was removed (globals.css:94-99 area) - same property, same value, no new declaration besides the selector move.
- `rgb(var(--surface))` references the pre-existing `--surface` triple; no new `--*` token, no `url()`, no external reference added (risk scan of the diff for `url(`/`http`/`fetch`/`innerHTML`/`dangerouslySetInnerHTML`/`eval`/storage/cookie/`process.env`: none). The broad `*` selector sets a Tailwind custom property only, with no security effect.
- No auth/session/api/storage/dependency surface moved: the delta contains no `lib/session.ts`, `lib/api.ts`, `layout.tsx`, localStorage or `package.json`.
- Nothing outside the allowed surface: `apps/backoffice/app/globals.css` is the sole changed path.

VERDICT: PASS
