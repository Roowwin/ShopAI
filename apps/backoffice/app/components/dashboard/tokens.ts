/* The two token pairs the dashboard's cards and the page's notice share.

   Centralised for the same reason lib/ui.ts centralises the status/grade tones: a pair duplicated
   across files drifts - one copy quietly gets a darker ink and two surfaces that were meant to
   agree stop agreeing. lib/ui.ts holds an identical neutral pair privately as NEUTRAL, but it is
   not exported and lib/ is outside this job's surfaces, so the pair is named here rather than
   reached across a boundary.

   Both pairs are written verbatim: Tailwind scans source TEXT (content covers ./app/** and
   ./lib/**), so composing them from a prefix would emit no rule at all. */
export const NOTICE_TONE = "bg-accent-100 text-accent-700";
export const MUTED_TONE = "bg-surface-sunken text-ink-600";
