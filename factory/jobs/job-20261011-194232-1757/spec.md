# docs: ADR 0008 scoped autonomous execution (supersedes ADR 0006 decision 4) + reconcile the 0006 duplicate

## Context
The owner has chosen **full autonomy within caps** for the AI tool rail: an identity may execute any action its
role permits with no per-action human click, bounded by caps and audit. That **contradicts a binding invariant**:
`docs/adr/0006-confirm-stays-human-only.md` decision 4 reads *"INVARIANT UNCHANGED: no write executes without a
human Confirm. Read-only ops may run without confirm within caps."*, and `docs/state.md:33` records it as ADOPTED
and owner-authored. ADR 0006's own open question says the alternative "would require its own ADR with its own
rehearsal evidence" - this job is that ADR.

Two related defects this job also fixes:
- **The two ADR 0006 files are byte-identical duplicates** (`0006-authorized-agent-rail.md` and
  `0006-confirm-stays-human-only.md`, both PROPOSED, both containing the agent-rail text). Neither actually
  records the invariant that was adopted, so `docs/state.md:33` cannot be made accurate until one is removed.
- ADR 0007 (the agent identity class) is still `PROPOSED` while being depended on. Its decisions are unaffected
  by this one except where they assume 0006 §4 gates every path.

## Deliverable
`docs/adr/0008-scoped-autonomous-execution.md` (new), containing:
1. **Status** - PROPOSED, awaiting owner acceptance; explicitly states that on acceptance it SUPERSEDES ADR 0006
   decision 4 for granted (identity, action) pairs, and that ADR 0006 is otherwise unchanged.
2. **Context** - what decision 4 says, that the change is at the owner's instruction (not inferred from observed
   behaviour), and the blast radius: `list` publishes a device to the LIVE storefront and `price` sets its public
   sale price.
3. **Decision** - the numbered list (see the ADR body).
4. **What does NOT change** - the invariants that survive: never auto-execute a decision made on the fallback
   model; never re-derive the action at execute time; caps; the append-only audit row per mutation; the
   role allow-list; agent tokens stay valid only on the assistant surface.
5. **Rehearsal evidence** - exactly what `scripts/rehearse_day.py` must score before autonomy is enabled.
6. **Reversibility** - removing all grants restores exact ADR 0006 behaviour with no code change.
7. **Consequences** (+/-), including the honest negatives.
8. **Out of scope** - unattended multi-step chains; agent actions in the customer zone (both inherited from 0006 §8).

And reconcile the duplicate: keep `0006-confirm-stays-human-only.md`, set its Status to ACCEPTED with a line
recording the supersession, and **delete** `0006-authorized-agent-rail.md`. Keep the remaining file's decision
text intact except for that status change - this job edits docs, not decisions.

## Acceptance
- The ADR's decision list is checked against the ACTUAL code paths it constrains: the execute gate
  (`staff_ai.py` `TOOL_ROLES` + the in-body `_require_role` guards in `staff_ops.py`), the daily cap
  (`CHAT_DAILY_CAP`), the fallback guard (`_FALLBACK_PROPOSAL`), and the audit writer
  (`app/services/audit.py`). Every claim the ADR makes about current behaviour must be true today or clearly
  marked as to-build.
- Reviewers verify the supersession is exact: it must name decision 4, not the whole of 0006, and must not
  silently supersede 0006's other six decisions (agent identity, credentials, the shared door, caps, audit, walls).
- A grep showing only ONE `0006-*.md` file remains, and that `docs/state.md`'s line about ADR 0006 is now
  accurate (update it).
- **No code, no schema, no migration, no nginx.** Docs only.
- Allowed surfaces: `docs/adr/0008-scoped-autonomous-execution.md` (new),
  `docs/adr/0006-confirm-stays-human-only.md` (status line only),
  `docs/adr/0006-authorized-agent-rail.md` (delete), `docs/state.md`. Anything else = **CHANGES**.

## Constraints
- Work only on branch `factory/<job-id>` (worktree provided) - LF / no BOM
- No test suite applies; the gate is a no-regression check only
- Do NOT touch: `.env`, `secrets/`, `infra/`, `alembic`, `factory/*`, `apps/**`
