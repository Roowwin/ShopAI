# nested Shop menu: fly-out sub-categories as live filter shortcuts, plus a mobile accordion

## Context
Job B of the owner's nested-navigation brief, to be built on top of Job A (the category-scoped `q`
parameter). The Shop dropdown (job 20) is one flat list of the live categories from
`/store/categories`. The owner wants the categories that have a viable split to open a sub-menu, and
- the part that decided the whole shape - EVERY link in it must lead to stock. Seven of the ten
sub-categories first proposed matched nothing at all (Mice/RAM/Cables/Gaming/Business/Ultrabooks/
Servers), which is why Job A exists: a shortcut is category + term, and the term only means anything
if it is scoped.

These labels were verified through Job A's endpoint against the live catalogue. Two of them read
differently from the word actually searched, so a shortcut carries a LABEL and a TERM rather than
deriving one from the other:

| menu | label | term | n | what it finds |
|---|---|---|---|---|
| Accessories | Docks | `dock` | 3 | Dell WD19S, HP USB-C G5, ThinkPad Thunderbolt 4 |
| Accessories | Mice | `mouse` | 1 | Logitech M720 Mouse |
| Accessories | Keyboards | `keyboard` | 1 | Logitech K380 Keyboard |
| Accessories | Hubs | `hub` | 1 | ASUS USB-C 3-Port Hub |
| Accessories | Webcams | `webcam` | 1 | Logitech C920 Webcam |
| Accessories | Headsets | `headset` | 1 | Logitech Zone 300 Headset |
| Networking | Switches | `switch` | 5 | the five switches |
| Networking | Routers | `router` | 1 | TP-Link Archer AX55 |
| Laptops | *no sub-menu* | - | - | `gaming`, `business` and `ultrabook` all return 0, so Laptops stays a single link (the owner's call) |

Several counts are 1: the shortcut is a keyword, not a taxonomy - "Mice" finds the M720 but not the
MX Master 3S, which never says "mouse". That is accepted; the bar is "greater than zero".

## Deliverable
1. `navMenu.ts` (new): the shortcuts as data - for each parent category, a list of `{ label, term }` -
   with a comment saying plainly that this is a CURATED list that must each resolve to stock, and that
   the categories themselves still come from the API (this file adds a second level; it does not
   replace the live list, and it must not become a second source of category names).
2. `NavDropdown.tsx` gains the sub-level:
   - desktop: hovering (or focusing) a parent with children opens a fly-out to its right, with a close
     delay of ~200ms so a slip of the pointer does not dismiss it; a parent with NO children stays a
     plain link with no arrow;
   - the fly-out is clamped to the viewport the way the main panel is (no height floor, flips to the
     left when the right edge is short, never off the bottom) - the arithmetic the last three jobs were
     held to;
   - keyboard: a parent with children is an `aria-expanded` control; Right or Enter opens the sub-level
     and moves focus into it, Tab walks its links, Escape closes the sub-level and returns focus to
     that parent, and a second Escape closes the menu with focus on the Shop trigger;
   - ARIA: the parent carries `aria-haspopup`/`aria-expanded`; the sub-list is a labelled list of links -
     the disclosure shape again, never listbox (these navigate, they do not set a value);
   - the parent's own link must remain reachable: clicking the category name goes to the category page,
     while the arrow/hover opens the sub-menu. State the choice in a comment; do not make the parent an
     unclickable button.
3. Mobile (`Header.tsx`'s drawer): the categories that have children become an accordion - the parent is
   a button with `aria-expanded`, its children listed beneath - and every other category stays a plain
   link. Tap and keyboard both work, and the drawer still lists EVERY live category (job 20's rule).
4. Links are `/?category=<slug>&q=<term>` - Job A's vocabulary, so the term is category-scoped and the
   toolbar shows its pill. Nothing else about the URL contract changes.

## Acceptance
- EVERY shortcut resolves to stock. Report the per-shortcut count, measured through the API (Job A's
  endpoint) or a check that does so. A shortcut returning 0 is CHANGES, not a note - this was the
  reason the brief was split.
- No regression in reach: every live category is still one click from the header, with or without
  children, and the drawer still lists them all.
- Keyboard-only pass with no mouse: open Shop, step into a sub-menu, choose a child, land on a filtered
  catalog showing the pill; Escape steps back one level then closes, focus on the trigger.
- The fly-out and accordion behave as described, including the close delay, and the parent's category
  link stays reachable by click and by keyboard.
- Gate: report the exact count (expect 120 passed / 3 deselected - this job adds no backend tests; if it
  adds any they must be hermetic, no dependence on seeded stock); storefront `tsc --noEmit && npm run
  build` green with the route count; and a live check of the served HTML after deploy: each parent's
  `aria-expanded`, and the child hrefs carrying `category=` and `q=`.
- No pixel or rendering claims: whether the fly-out "feels" right is browser-only; say so.

## Allowed surfaces
`apps/storefront/app/components/NavDropdown.tsx`, `apps/storefront/app/components/Header.tsx`,
`apps/storefront/app/components/navMenu.ts` (new). No backend (Job A did that), no other route, no
database or data change, no new dependency. Anything else = CHANGES.

## Constraints
- Work only on branch factory/<job-id>; LF/no-BOM; gates AFTER `docker compose build api`; never touch
  .env, secrets/, infra/, factory/*.