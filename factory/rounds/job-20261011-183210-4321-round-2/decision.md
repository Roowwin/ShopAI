# decision job-20261011-183210-4321 round 2

VERDICTS: CHANGES / PASS / PASS
DECISION: ESCALATE

Both round-1 Required items are genuinely fixed, verified independently: the kicker has one definition
(`kickerClass`, recomputed at 4.76:1 - restoring the exact pre-round-1 colour), and the AA regression on
assets/intake is gone. Security and performance both PASS with every round-1 guarantee re-verified
(role gates intact, fetch counts identical, copy byte-identical, CSS growth held to +0.66% raw).

One blocking, one-line item remains, and it is the invariant I asked to be verified:

**"no class-like strings leak from comments" is FALSE, in the same paragraph that declares it.**
`Table.tsx:13`'s comment spells `ring-2` and `ring-offset-2`, emitting two dead rules into the shipped
stylesheet - three lines above the note warning against exactly that. Dead CSS only (nothing carries
those classes), but the builder's own round-1 argument was that stray rules corrupt the CSS *as
evidence*, and this job's acceptance rests on source and built CSS agreeing.

Also required: state item 3's finding as "the only **control** min-height" (`min-h-screen` also exists),
and raise the three undisclosed 2.56:1 content strings in `cms`/`ai-listings` to `ink-500` for
consistency with the kicker fix, or note them as deliberately exempt.

Recorded for the follow-up contrast job (owner decisions already taken):
- primary `text-white` on `brand-600` = 3.77:1 -> darken to `brand-700` (5.55:1)
- placeholder tones (light `ink-400` -> `ink-500` = 4.76:1; dark `ink-500` -> `ink-400` = 6.94:1)
- the three `ink-400` content strings -> `ink-500`
- **newly introduced non-text failures (SC 1.4.11, 3:1)**: `--line` boundaries 1.23:1 on white, and the
  `brand-500` focus ring 2.54:1 - now also applying to the newly focusable table regions. Mirrored
  tokens, so they affect the storefront too.
