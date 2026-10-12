# builder report - job-20261012-203438-4770 round 2

Round 1 came back CHANGES from two lenses and PASS from one. Both findings are addressed; neither
touched the legibility of a text pair, and the architect's own summary was that the job needed "at most
a one-line change".

## 1. ARCHITECT - the audit's enumeration was incomplete (the spec makes that binary)

The two glow variants this job adds each introduce a 1px hairline, and round 1's audit paired neither.
They are now STATED EXCEPTIONS, on the same footing as `shadow-glow-sm`'s inner hairline (1.37:1, a J1
token used unchanged), and measured:

| token | over the feed card | over the row's hover fill |
|---|---|---|
| `danger-600/40` (glow-danger hairline) | 2.00:1 | 1.97:1 |
| `accent-400/40` (glow-warning hairline) | 2.68:1 | 2.62:1 |
| their 0.55 bloom, at peak | 2.75:1 | - |

Why the exception is honest rather than a shrug: each is decoration around a dot whose opaque fill
clears 6.45:1 (danger) and 11.67:1 (accent), and the state each one marks is also carried in text at
5.25-19.28:1. Nothing a reader must act on depends on either hairline. The alternative fix - dropping
the `0 0 0 1px` layer and keeping only the bloom - was declined because that 1px IS the border the brief
asks for ("subtle, glowing borders"), so removing it would trade a documented exception for a lost
briefed element.

Also corrected from that review: the route count is **17 pages**, not 18 - `/icon.svg` was double-
counted in round 1's figure.

## 2. PERFORMANCE - a bare utility noun in prose emitted a real rule

`kpi.tsx`'s comment said "a light-mode box shadow ... shadow is invisible ... no light-mode shadow
utility". Tailwind scans TEXT, and a standalone `shadow` is a candidate of its own, so the built
stylesheet carried `.shadow{--tw-shadow:0 1px 3px 0 rgb(0 0 0/0.1),0 1px 2px -1px rgb(0 0 0/0.1);...}` - a
light-mode black elevation rule in the CSS every backoffice route loads.

Reworded, and the fix is verified in the BUILT artifact rather than argued - `grep -c '\.shadow{'` on
the fresh build is **0**, while `.shadow-glow-danger`, `.shadow-glow-warning` and `.shadow-glow-sm` are
all still emitted. The distinction that matters for the next reader: `box-shadow` is one candidate and
emits nothing, a standalone `shadow` emits the utility. This is the first case in this repo of the
comment-scanning trap firing without any class-shaped string.

## Numbers

- Build: `npx tsc --noEmit && npx next build`, **status 0**, "Compiled successfully".
- Gate: **125 passed, 3 deselected**, unchanged - this job touches no backend file, and round 2 touched
  one comment in one dashboard component.

## Still not verified, and not claimed

The rendered dashboard: `/admin/dashboard` is behind auth and paints after a logged-in session plus a
successful payload fetch, so no served-markup check can read it; the pipeline geometry, the glass tiles
and the timeline rail have been seen by nobody. The Sparkline's drawn branch remains unexercised (no
7-day series exists in the payload). No browser session was run.
