# decision job-20261011-201814-546 round 1

VERDICTS: PASS / PASS / PASS
DECISION: APPROVE (round 2 opened for carried items - none was a round-1 blocker)

The job delivers what the owner asked for ("i want dashboard vertical showing main and sub topic"): six groups, twelve
entries, in the specified order, all twelve routes 200 against a 404 control, usable at 375px, `tsc`/`next build`
green (17 routes), CSS +185 B gzip, shared chunk unchanged, no new dependency.

**Why approve and still run a round 2.** No lens found a defect in the round-1 work, so there is nothing to escalate.
But four of the five carried items are things the *spec* should have covered and did not, and one of them is my own
bug, faithfully preserved by the builder:

1. **`aria-current` is set twice on every non-dashboard admin route** - `layout.tsx:120`'s
   `pathname === l.href || pathname.startsWith(l.href + "/")` makes `/admin` match `/admin/...`. Architect found it,
   I confirmed it. This is the J1 predicate carried forward verbatim, which is exactly why it survived: the builder
   was told to preserve the active rule, and it did. The nav job is the change that made the wrong current-entry
   visible, so it is the right place to fix it.
2. **`assets/[id]`'s `<h1>` sits outside its gate** - the same latent placement class the round-1 item fixed for
   `customers/[id]`. Security flagged it; a serial number is not customer PII, so it is not a violation, but the two
   sibling pages should not be able to drift.
3. **`linkClass` is 3 of 9** - the six remainder are in files the spec's surfaces excluded. Architect and performance
   both flagged it; the builder disclosed the gap and documented it in its own `ui.ts` comment rather than exceeding
   its surface, which is the correct behaviour. Fixed by widening the surface, not by faulting the builder.
4. **The dead `onDark` variant** - round 1 made it unused (no call site), and an unreachable variant in a design
   system is how the next page hand-rolls a class string instead.

## Withdrawn: my fifth item, and the lesson from it
I sent a fifth item claiming the dead `.table{display:table}` rule came from two prose comments and asking for a
reword. The performance lens disproved it: the emitter is the literal `<table>` element in `Table.tsx:45` (Tailwind's
extractor scans raw text, so a tag name yields the candidate `table`), the comment-stripped rebuild's CSS is
byte-identical, and the rule is present in the baseline stylesheet. I had verified only that the rule exists and that
no real utility consumer does - the attribution was an inference and it was wrong. **Withdrawn before the builder
started**, and recorded here rather than quietly dropped.

The programme lesson is broader than the original one: **the trap is not "comments emit rules", it is "the extractor
scans raw text"**, so a comment, prose, or a JSX tag name can all emit a rule; and **a passing closed-world check
cannot detect a pre-existing emitter**, because it diffs two builds of the same tree. Dead-rule findings need a
positive grep against the built CSS. Both corrections are in the plan file's programme lesson and in the round-1
`feedback.md`, so the next job does not re-derive them.

## Ratified: the round-2 surface amendment
`app/admin/{assets,customers,orders/page.tsx,orders/[id]/page.tsx,audit}/...`, `app/components/ui/Button.tsx`,
`app/components/ui/index.ts` are added by me (the orchestrator), because items 1-3 are unreachable inside the original
surfaces. Not a breach by the builder.

## Carried forward (not round-2 work, recorded so it is not lost)
- The layout's `useMe()` adds a second `GET /staff/me` per admin page load (11 call sites already fetch it). Chrome
  only, no security impact; a shared me-provider would remove it if it ever matters. Out of scope here.
- Nav links are plain `<a href>`, so each click is a full document load and re-runs that fetch. Pre-existing, not a
  regression.
- `/admin/agents` is visible to a manager who then gets a server 403. Cosmetic: the server door is the wall, and page
  labels are not sensitive. Left as-is deliberately; role-aware nav is a design decision, not a defect.
- The 36px sub-topic targets are compliant (the spec required >=44px only for the mobile toggle).

Gate: **70 passed** on the branch (round-1 builder, no concurrent run). The api/backoffice containers must be rebuilt
and recreated after the merge: `docker compose build api`, `docker compose up -d api`,
`docker compose restart backoffice`.
