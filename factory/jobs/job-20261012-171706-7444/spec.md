# storefront header slim + catalog facet dropdowns (amazon-style)

## Context
The shop header is the tallest thing above the fold: two stacked bands (announcement strip ~32px + a control row ~68px, sticky) and, since job 17, every live category packed into that row. The catalog's filters are five stacked ChipRows (category/brand/grade/price/sort) drawn above the grid by LoadMore - five full-width bands, taller than the first page of products - and they exist only on the home catalog section, where the query string is the state (catalogFilters.ts is the single parse/serialize site; a chip click is nothing but a router.push of the canonical string).

This job is presentation only: slim the header to one tight control row plus a micro announcement line (Amazon's top-bar shape, search dominant) and replace the five chip rows with one toolbar of Amazon-style facet dropdowns. The URL contract, the API envelope, the cart/checkout behaviour and the gate are untouched.

## Deliverable
1. Header.tsx slim. The announcement sentence stays on the site - shrink the band (py-2 -> py-1, text-xs -> text-[11px]), do not delete the copy. The control row tightens (py-3 -> py-2) and keeps its four things: logo, the category strip, the search (still the dominant flex slot and the widest element), cart + mobile menu. The strip keeps EVERY live category plus Shop/FAQ/Ask AI, with its horizontal scroll and both edge fades - no slice, and no moving nav links into a menu where they can be missed. Measure the header height at 1280px before and after and report both (baseline ~100px = 32 + 68); target is a single tight band plus a micro strip, ~80px or less, with nothing dropped. Sticky/z-index, the suggestion dropdown, Enter-to-search, the cart badge and the mobile drawer (every category) behave exactly as they do now.
2. Catalog facet toolbar - a new client component (FacetDropdown.tsx) rendered where the five ChipRows are today, and only when `applied` is set (the /category/[name] grid stays filter-free):
   - one horizontal toolbar of five triggers - Category, Brand, Grade, Price, Sort - each showing its own name, or "Name: value" when a value is in force, plus a "Clear all" at the end while anything is active;
   - a trigger opens that facet's options: category and brand carry the live counts the props already have, grade/price/sort come from catalogFilters.ts, and "All"/"Any" is the clear option in every facet;
   - choosing applies at once - one router.push of the canonical query string with scroll:false, exactly as today - and closes the panel; one panel is open at a time;
   - keyboard and pointer both work: ArrowDown/Up plus Home/End move through the options, Enter/Space chooses, Escape closes with focus back on the trigger, Tab or a click outside closes; the trigger carries aria-expanded/aria-haspopup, the panel is a labelled listbox with the current value marked (check + aria-selected); every target >= 44px;
   - what is in force stays legible: each active facet is removable on the toolbar, and the empty state keeps naming the active filters; Clear all = EMPTY_FILTERS, which is what the empty state's Clear filters already applies;
   - catalogFilters.ts stays the ONE parser/serializer and no URL parameter is added.
3. Mobile: the toolbar scrolls sideways instead of stacking; a panel opens under its trigger as a full-width sheet that cannot overflow the viewport; targets stay >= 44px; the mobile drawer keeps every category.
4. If the toolbar leaves ChipRow unused, retire it in this job (the file and its index export) and say so - no dead primitive. No new npm dependency either way: house primitives and tokens only.

## Acceptance
- Owner's eye: the header is visibly slimmer (report the measured height at 1280 and at 390) and the filter block is one line instead of five; every category is still reachable; opening a facet and picking an option reads like Amazon's.
- Unchanged: each facet filters alone and composes with the rest; the URL carries the state and a pasted URL renders the same view in the first paint; Back walks the filter history; cart/checkout and the serialized reserve flow are untouched (two tabs still cannot buy the same unit); search suggestions, Enter-to-search, the cart badge and the mobile drawer all still work.
- Keyboard-only pass on all five facets: Tab to the trigger, Enter to open, arrows to move, Enter to choose, Escape to close with focus returned; focus-visible rings and reduced-motion honoured.
- Gate: report the exact count (expect 117 passed / 3 deselected, 0 new - frontend-only) after docker compose build api; storefront prod build green (report the route count) and one live round-trip through nginx on shop.rfo.localhost: header height in px at 1280 and 390, then choose a facet -> URL -> grid -> Clear all.

## Allowed surfaces
apps/storefront/app/components/Header.tsx, apps/storefront/app/components/LoadMore.tsx, apps/storefront/app/components/FacetDropdown.tsx (new), apps/storefront/app/components/ui (ChipRow retirement + its index export). apps/storefront/app/page.tsx only if a prop pass-through is genuinely required. No backend, no tests, no other route, no new dependency. Anything else = CHANGES.

## Constraints
- Work only on branch factory/<job-id>; LF/no-BOM; gates AFTER docker compose build api; never touch .env, secrets/, infra/, factory/*.