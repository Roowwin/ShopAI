VERDICT: PASS

Fast-lane landing (owner directive: gates then ship, no review rounds). Recorded honestly rather
than authored by a reviewer.

- `staff_team.py` is a new module rather than a fourth of `staff_ops`: the roster is the first
  surface in this codebase whose SUBJECT is the staff table itself. Shape copies the admin-only
  router precedent (`staff_agents.py`): `require_roles("admin")` on every route plus an in-body
  `_require_admin`, because `staff_ai.chat` dispatches into routers as plain function calls where
  `Depends` never evaluates.
- No schema change: the page reads and writes `staff_users` / `staff_passwords` / `refresh_tokens`,
  all of which already exist. No new migration, so nothing to sequence against the sibling job's
  0016+.
- The frontend reuses the existing primitives and idioms (`useMe`/`requireRole`, `apiFetch`, the
  `{detail}` error shape, `Table`/`Stat`/`Select`/`Badge`, `lib/ui` tones). No new dependency,
  frontend or backend.
- Import Center: `SheetDrop.tsx` is the drop target, `ProductImportPanel` draws the four named
  stages on one rail. The mapping/preview split moves no data handling - every figure is still the
  server's.
- Merge with the advanced base (`phase12-backoffice` at c3082c7) resolved in favour of both sides:
  the sibling's smart-pricing helpers and `PricingSection` are kept, and their two extra counters
  (Suggested, Low margin) moved onto the preview stage's stat grid rather than the mapping's.
