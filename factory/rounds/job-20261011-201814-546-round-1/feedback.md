# feedback

Job job-20261011-201814-546, round 1 -> round 2. All three lenses: architect PASS, security PASS, performance
pending (if it lands with an item I will follow up). Nothing in round 1 is wrong; these five are the carried items
the reviews produced, and four of them are things the spec should have covered and did not. **Surface amendment
ratified below - the files it adds are mine to widen, not a breach by you.**

## 1. `aria-current` is set twice on every non-dashboard admin route (blocking - my bug)
`layout.tsx:120` reads `const active = pathname === l.href || pathname.startsWith(l.href + "/")`. The Dashboard
entry's href is `/admin`, so on `/admin/orders` **both** Dashboard and Orders carry `aria-current="page"`.

This rule is a faithful preservation of the pre-existing predicate - that is exactly why it survived round 1 - but
it is a real defect, and this job is the one that made the nav a grouped list where the wrong current-entry is
visible. Make the root entry exact-match and keep the prefix rule for every other entry (a child route should still
light up its own section):

    const active = l.href === "/admin"
      ? pathname === "/admin"
      : pathname === l.href || pathname.startsWith(l.href + "/");

Then prove it: `/admin/orders` must yield exactly **one** `aria-current="page"` (Orders), `/admin` exactly one
(Dashboard), and `/admin/agents` one (Agents). Do not fix it by dropping `aria-current` - it is the screen-reader
contract the round-1 reviewer verified.

## 2. The `assets/[id]` heading has the same latent placement the round-1 fix addressed
`app/admin/assets/[id]/page.tsx` renders `{a?.serial_number ?? "#" + id}` in its `<h1>` **outside** the
`checked && allowed && a && data` gate. The round-1 fix gave `customers/[id]` a
`const cleared = checked && allowed && c != null && data != null;` and moved its heading behind it. Apply the same
shape here so the two sibling detail pages cannot drift apart. Pre-existing, unchanged by you, and a serial number
is not the customer-PII the item targeted - so it is not a round-1 violation, but it is the identical class.

## 3. Finish `linkClass` (3 of 9) and drop the dead `onDark` variant
Six hand-rolled `text-brand-700 hover:underline` sites remain, in four files the spec's surfaces excluded:
`app/admin/assets/page.tsx:72`, `app/admin/customers/page.tsx:85`, `app/admin/orders/page.tsx:144`,
`app/admin/orders/[id]/page.tsx:58,83,101`. Route them through `linkClass`. Your ui.ts comment documenting the gap
can then go.

Also delete the `onDark` variant: `app/components/ui/Button.tsx:4` (the type) and `:43` (the value). Round 1 made it
dead - there is no call site left - and remove its mention from the `app/components/ui/index.ts:7` comment. Leaving
an unreachable variant in a design system is how the next page hand-rolls a class string instead.

## 4. WITHDRAWN - `.table` is NOT comment-derived, so do not chase it
I sent this to you as an item and the performance lens disproved it after the fact. **There is nothing to do here** -
it is recorded only so you do not take on a task that cannot succeed.

What I claimed: that `.table { display: table; }` is emitted by the prose comments at
`app/admin/audit/page.tsx:13` and `app/admin/orders/page.tsx:88`. What is true: the rule is emitted by Tailwind's
extractor reading the literal element in `app/components/ui/Table.tsx:45`
(`<table className={cn("w-full border-collapse text-sm", className)}>`) - the raw text `<table` yields the candidate
`table`. Confirmed three ways: the comment-stripped rebuild's CSS is byte-identical (so no comment contributes), the
only remaining `table` token anywhere in the scanned tree is that JSX tag name, and the rule is present in the
**baseline** stylesheet too, so the nav job neither added nor could have removed it. No comment reword can drop it;
only not rendering a literal `<table>` would, which is not worth doing.

Your `app/admin/page.tsx` reword was done as asked and is correct hygiene - keep it. Do not reword the other two
comments for CSS reasons.

The lesson, recorded for the programme rather than as work: **Tailwind's extractor scans raw text, so a
utility-shaped token emits a rule from any source at all - a comment, prose, or a JSX tag name.** The closed-world
check cannot catch a pre-existing emitter, because it diffs two builds of the same tree and the offending source is
present in both. A positive grep against the built CSS is the instrument that settles it, and it is what disproved
this item.

## 5. Minor: the audit cap note sits outside its Card
`app/admin/page.tsx` renders the audit sub-list cap note in a bare `<div>` while the movements and reservations
notes sit inside their Cards. Cosmetic, non-blocking - align it if the change is trivial, and say so either way.

**Not in scope** (do not "fix" these): the 36px sub-topic link targets (the spec required >=44px only for the
mobile toggle, so they are compliant), and the extra `/staff/me` the layout's `useMe()` adds (no impact, chrome
only).

## Surface amendment (ratified - added by the orchestrator, not a breach)
`app/admin/assets/page.tsx`, `app/admin/customers/page.tsx`, `app/admin/orders/page.tsx`,
`app/admin/orders/[id]/page.tsx`, `app/admin/audit/page.tsx`, `app/components/ui/Button.tsx`,
`app/components/ui/index.ts`. Everything else from the original surfaces still stands.

## Acceptance for round 2
- Edit **only** inside the worktree `factory/worktrees/job-20261011-201814-546` on branch
  `factory/job-20261011-201814-546`. Check `git status` in the main tree before you finish - this program has twice
  had a builder write the main tree by accident, both times for nginx.
- Closed-world check as before (`bfe3b3fc3265fd91.css`, 373 rules - a change here means you emitted a rule).
  **Compare the CSS only**: stripping comments perturbs webpack's SplitChunks heuristic, so a stripped rebuild reports
  inflated route `Size` numbers (e.g. `/admin` 4.5 kB). Route size is only comparable between same-source builds;
  the stylesheet is byte-stable and is the thing under test.
- `npx tsc --noEmit` exit 0; `next build` exit 0; the 12 admin routes 200 with the 404 control.
- The gate. Do not run it concurrently with anything else.
- Report the `aria-current` counts for the three routes in item 1.
