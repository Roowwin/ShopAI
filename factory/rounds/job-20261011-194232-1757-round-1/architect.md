VERDICT: CHANGES

Job job-20261011-194232-1757 (ADR 0008). Reviewed at `47d15a8`.

## Supersession exactness - sound, but the tense was wrong
The narrowness is stated in four independent places (title, Status, Decision 1, the untouched-list) and ADR 0006's
Status edit mirrors it, so it cannot be misread as "0006 is dead". Good.

**F3 (moderate):** the supersession was recorded as already in force ("Decision 4 is superseded") while ADR 0008
itself is "PROPOSED - awaiting owner acceptance". An ACCEPTED ADR should not declare itself partly superseded by a
PROPOSED one; if 0008 were rejected, 0006's Status would be false. Both should read "on acceptance".

## Claims about current behaviour - all TRUE, to-build items correctly marked
Verified against code: the plain-function dispatch and its closure (one module-level tuple consumed by both the
route dependency and the in-body guard, with `TOOL_ROLES` derived from those constants); `CHAT_DAILY_CAP`
exempting admin/manager; `_FALLBACK_PROPOSAL`; the audit writer and the DB-level append-only REVOKE;
`actor_type='agent'` correctly marked as requiring the ADR 0007 migration (the CHECK today admits only
staff/system/customer). No stale claim.

## Internal coherence - consistent
"Over-cap degrades to propose" conflicts with nothing. The grant tuple is adequate. Decision 3's `outward` =
{price, list} matches exactly the two storefront-touching dispatchable actions; the six `inventory` names are
precisely the remaining `TOOL_ROLES` keys; CMS/product writes are correctly labelled "any future". Nothing outward
missing or wrongly included.

## Duplicate reconciliation - mechanics right, survivor mis-titled
Exactly one `0006-*.md` remains; the original open-question text is preserved and annotated rather than rewritten.

**F1 (primary, blocking):** the kept file's H1 still read `# ADR 0006: authorized-agent rail (Hermes-class
agents)` - not matching its own filename or `state.md`'s name, and **word-for-word identical to ADR 0007's H1**.
Removing the duplicate *filename* left two ADRs indistinguishable by title, while ADR 0008 keys its entire
supersession on "decision 4 of ADR 0006" - a line duplicated verbatim as ADR 0007 decision 4. A reader could
apply the supersession to the wrong document. Reconciliation incomplete until 0006's H1 is retitled.

**F2 (blocking-adjacent):** ADR 0008 said "all of ADR 0007 stands", but 0007's Status asserts 0006 "gates EVERY
proposal-to-execute path in this rail **without exception**" and its decision 4 restates the superseded invariant.
Under a granted pair those are narrowed exactly as 0006's are, so "all of ADR 0007 stands" is false and would
mislead whoever implements ADR 0007's follow-up jobs.

## Non-issues checked
No dangling reference to the deleted filename; cross-references are plain-text numbers (nothing to break); every
decision number cited by ADR 0008 resolves; `scripts/rehearse_day.py`, `staff_ai.py`, `_FALLBACK_PROPOSAL`,
`CHAT_DAILY_CAP` and `TOOL_ROLES` all exist, and `/staff/assistant` is genuinely retired.
