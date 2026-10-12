# storefront header: central Shop dropdown + refreshed price bands

## Context
Owner brief 2026-10-12: the header should read [Logo] ---- [Shop (dropdown) | FAQ | Ask AI] ---- [Search | Cart], with the flat list of categories replaced by a central "Shop" dropdown holding every category.

That is a DELIBERATE REVERSAL of a rule two jobs protected: job 17 replaced `slice(0, 6)` with a scrolling strip precisely so no category was hidden, and job 19's spec forbade "moving nav links into a menu where they can be missed". The owner has now seen the strip and asked for a menu. Record it as a redesign, not as a fix - and the requirement that has to survive is that EVERY live category stays reachable on the same click budget as today (one click to the menu, one to the category), not that they are all on screen at once.

The nine names in the brief are not a literal list. `/store/categories` returns them live - today exactly those nine, with unit counts (Phones 467, Laptops 10, Accessories 10, Desktops/Monitors/Networking/Parts/Processors 6, Tablets 2). The menu renders what the API lists; a hardcoded nine would silently break the first time a category is added, renamed or retired, and would contradict the CMS-driven catalog.

Item 2 of the brief (dropdown filters in the catalog) SHIPPED last job - the toolbar is already one line of facet dropdowns (Category, Brand, Grade, Price, Sort) over the URL state, with counts from the API. What remains of it is the price-band vocabulary.

## Deliverable
1. Header (`Header.tsx`): the category strip becomes ONE "Shop" disclosure in the centre group - [Shop v | FAQ | Ask AI] - logo left, search + cart right, per the brief's layout. The menu lists every category the API returns, plus Shop (the catalog) itself.
   - Disclosure semantics, NOT facet semantics: a button with `aria-expanded`/`aria-controls` and a real `<ul>` of `<a>` links. Do not reuse `FacetDropdown` - a facet sets a value and needs listbox/option roles plus a value in force; a nav menu navigates and has neither.
   - Keyboard: Enter/Space opens; Escape closes AND returns focus to the trigger; Tab closes; a click outside closes; only one header panel open at a time.
   - Styling: floating panel, subtle shadow + ring, motion tokens (duration-fast/ease-out, reduced-motion honoured), all targets >= 44px. Place it with the same viewport clamp the facet panel uses (never off the right or bottom edge) and make sure it escapes the sticky header's stacking/clip context rather than being cut off by it.
   - Below md the centre group stays hidden: the burger drawer already carries every category plus Shop/FAQ/Ask AI, so the collapse the brief asks for already exists - verify it, don't rebuild it.
   - Remove the strip and its edge-fade machinery with it (the `measure()` callback, the `edges` state, the two gradient spans, the `strip` ref). The search-suggestions dropdown, Enter-to-search and the cart badge stay exactly as they are.
2. Price bands (`catalogFilters.ts` - the ONE parse/serialize site): Under $200 / $200-$500 / $500-$1,000 / $1,000+. Every band matches live stock today (31 / 20 / 5 / 1 products across a $13-$1,104 range, median $164), so no band is a dead end. Nothing else in that file's contract changes: same param names, same compose semantics, and the API needs no change at all (it already accepts min_cents/max_cents).
3. Band parity for old links. A shared URL can carry a min/max pair matching no preset - every band in the previous set is one. The grid must still filter by it (it will: the API takes the raw pair), but the Price trigger must still SAY something. Today it would fall through to a bare "Price" while the grid behind it is filtered. Show the unmatched pair as a band (for example "$120 - $250") instead of pretending no price filter is in force, and keep the empty state naming it.

## Acceptance
- Owner's eye: the header reads as the brief's layout; the Shop menu lists every category with its count; picking one lands on that category page.
- Parity: a pasted link carrying an old band (`?min_cents=10000&max_cents=30000`) still filters, and its band is legible on the trigger; the empty state still names the filters in force; Back still walks filter history; Category, Brand, Grade and Sort are unchanged in behaviour.
- Keyboard-only pass on the Shop menu: Tab to the trigger, Enter to open, Tab/arrows through the links, Enter to navigate, Escape to close with focus returned to the trigger.
- Mobile: below md there is no Shop trigger, and the burger drawer still carries every category.
- Gate: report the exact count (expect 117 passed / 3 deselected) after `docker compose build api`; storefront prod build green (report the route count); and a live check through nginx: the served HTML carries the Shop trigger and no category strip, and `/category/<name>` still returns 200.
- Header height arithmetic before/after. There is no browser in the worktree, so say plainly that the figure is COMPUTED from the class values, not measured - and report it at both 1280px and 390px widths.

## Allowed surfaces
`apps/storefront/app/components/Header.tsx`, `apps/storefront/app/components/NavDropdown.tsx` (new, if the disclosure is its own component), `apps/storefront/app/components/catalogFilters.ts` (PRICE_BANDS and the band-label helper only), `apps/storefront/app/components/LoadMore.tsx` (only if the unmatched-band display needs it). No backend, no tests, no data change, no other route, no new dependency. Anything else = CHANGES.

## Constraints
- Work only on branch factory/<job-id>; LF/no-BOM; gates AFTER `docker compose build api`; never touch .env, secrets/, infra/, factory/*.
- Do NOT rename product data: the "Refurbished " prefix cleanup is a separate job (and is to be a render-time strip there, not a data change).