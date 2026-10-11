# decision job-20261011-191401-1466 round 1

VERDICTS: CHANGES / PASS / CHANGES
DECISION: ESCALATE

The contrast work itself is **better than the spec's**: the builder's ratio table is accurate to 2 dp on all 15
pairs, and where it disagrees with my spec it is right and I was wrong on three (white/`brand-700` = 5.48 not
5.55; `brand-500` on white = 2.54 not 2.56; `ink-500` on `surface-sunken` = 4.34 not 4.55) - the "mirrored
without re-checking at the new site" values the spec warned about. Primary button (both states clear 4.5:1, hover
darker than base), the focus rings including the 4th at `Table.tsx:40` (**ratified**: the ring is that region's
only focus cue, and Table has no storefront counterpart), the `--line` exception and surface discipline all pass.
Security PASS: no behavioural change, focus indicators recoloured not removed, LF/no-BOM.

Two blocking items, and **both are the repo's thrice-bitten comment trap. It bit twice this round.**

1. **Two stray rules from comment prose.** `Button.tsx:23`'s "focus ring" emitted `.ring{…}` and `Input.tsx:15`'s
   "hidden" emitted `.hidden{display:none}`. Neither has real source usage. A comment-stripped rebuild is
   **byte-identical to baseline**, proving the four intended class swaps cost zero bytes and the stylesheet's
   +253 B is 100% comment prose.
2. **The `globals.css` exception comment's rationale is misstated** - it claims the file "is scanned as text", but
   `content` is `./app/**` + `./lib/**` only, so `globals.css` is not a content source. Right conclusion, wrong
   reasoning; fix so the next reader does not generalise a false rule.

Plus reachability corrections (the `muted` hover at 4.34 **is** reachable at `cms:121` and needs fixing; the
`danger` hover at 4.41 is **latent**, not reachable, and the report overstated it), and the note that the mirror
set is **three** files (`Button`, `Input`, `globals.css`) - the storefront has no `Select` and no `Table`.

## Program-level lesson (folded into the remaining job specs)
This trap has now cost **four** rework findings across the program (`bg-slate-500` on the storefront, `min-h-[44px]`,
`ring-2`+`ring-offset-2`, and now `ring`+`hidden`). A rule in a spec is not enough. The **closed-world check** the
J4 builder invented - strip comments from a copy of `app/**`+`lib/**`, rebuild, and diff the emitted rule set
against a comment-free build - is now an **acceptance step for any job that writes comments in scanned source**,
not something to hope a reviewer catches.

## Noted
The performance reviewer flagged that comparing a parallel job branch against the `phase12-backoffice` **tip** is
misleading (the tip carries unrelated later work); compare against the merge-base.
