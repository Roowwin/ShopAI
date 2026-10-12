# backoffice Midnight Emerald J1: dark token flip + contrast audit + collapsible sidebar and Cmd+K palette

## Context
First of the owner's five jobs for "RFO Backoffice 2.0" (2026-10-12). This one is the foundation every
later job hangs off: the app turns dark, and the chrome is rebuilt. J2 the dashboard, J3 the asset
workbench, J4 the intake engine and J5 the listing studio follow, each on top of this.

Two facts make this surgical rather than sprawling, and both were checked before the spec was written:

- **the whole palette is 72 token lines in `apps/backoffice/app/globals.css`** (`:root { --brand-*:
  ...; --surface: 255 255 255; --ink-*: ... }`), mapped through `tailwind.config.ts`. Flipping those
  values turns all seventeen pages dark at once.
- **the tokens are ROLE-named, not colour-named**: `ink` is documented as "slate text", and `ink-900`
  is currently the DARKEST step because it sits on white. On a dark ground the role must survive and the
  VALUE must invert - `ink-900` becomes the strongest text on the page, i.e. near-white. Renaming the
  scale would touch every page in the app; inverting it touches one file.

The owner's decisions for this run, recorded because they bound the work: keep every working flow
(scan-in, the AI drafts) and wrap it rather than replace it; go dark across ALL pages, with a real
contrast audit rather than an eyeball; hand-rolled SVG and CSS transitions, NO new dependency (deps are
`next`, `react`, `react-dom` only - there is no framer-motion and no lucide, and the brief's own
parenthetical allows CSS).

## Deliverable
1. The palette (`globals.css` + `tailwind.config.ts`), values only where the tokens already exist:
   - `surface` -> slate-950 (2 6 23) for the page ground, `surface-muted`/`surface-sunken` re-derived as
     the raised and recessed steps on it (the reference is slate-900 15 23 42 for panels);
   - `line` -> the slate-800 / emerald-tinted hairlines the brief asks for;
   - `ink` INVERTED so the role names keep their meaning: the strongest text becomes the near-white
     step, the muted steps become the mid-slate ones. Every step must still be used where it is used
     today - this job does not re-assign roles, it changes what they resolve to;
   - `brand` (emerald) and `accent` (amber) stay the accents; `status.*` and `grade.*` are re-derived for
     a dark ground, because a `-soft` that was a pale pastel behind dark ink on white becomes a glare
     behind light ink on dark: those become low-alpha fills with a light ink step that clears contrast;
   - the two new things the brief needs and Tailwind has no stock answer for: a glass surface token
     (for `backdrop-blur-md` panels and the sidebar) and a glow shadow utility. `backdrop-blur-md`
     itself is stock Tailwind and needs no config.
2. **The contrast audit, which is the owner's explicit ask.** Not an eyeball pass:
   - sweep `apps/backoffice` for light-mode assumptions - `bg-white`, `text-black`, `border-white`,
     white overlays (`bg-white/`), `ring-white`, and shadows tuned for a white page - and fix each;
   - verify every text/surface and text/brand pair the app actually uses CLEARS WCAG AA (4.5:1 body,
     3:1 for large text and UI borders), by computing the ratios from the token values. Report the
     table, including any pair that had to change because it did not clear. If a pair cannot clear
     without changing the design, say which and why rather than shipping an unreadable one.
3. The chrome (`app/admin/layout.tsx` + whatever new components it needs):
   - the sidebar becomes slim and collapsible. It keeps the SIX existing groups and all THIRTEEN
     entries exactly as they are - that taxonomy was settled deliberately in the nav job and is
     documented in the file's own comment; the brief's "Operations / Commerce / Intelligence" is a
     REGROUPING of a decision already made, so this job renames nothing. What changes is the visual
     language: glass, emerald hairlines, a collapse control, and the collapsed state remembered per
     viewer (localStorage, wrapped so a private window or blocked storage cannot break the chrome).
   - a Cmd/Ctrl+K command palette: a centred floating glass pill, opening on the keyboard shortcut,
     drawn from the SAME `GROUPS` data the sidebar renders (a second list of routes is how the chrome
     grows a 404 - the file's own rule), filtering as you type, arrow/Enter to navigate, Escape to
     close with focus returned to where it was.
4. Nothing else: no route added or removed, no API call changed, no behaviour change anywhere. The
   pages keep working exactly as they do today, in a dark skin.

## Acceptance
- **Dark and legible on every page**: the token flip plus the audit, reported with (a) the count of
  light-mode assumptions found and fixed, by literal and by file, and (b) the computed contrast table
  for the pairs the app uses. Any pair below AA is a CHANGES unless the report names it as a
  deliberate, stated exception.
- **No light-mode remnant on a real page**: check the served HTML of several pages (dashboard, assets,
  intake, orders, customers, cms, ai/listings) for the banned literals and report the counts. Say
  plainly which parts of the "dark" claim the served HTML can and cannot carry (a class name proves the
  markup, not the rendering).
- **Chrome**: the sidebar still lists thirteen entries in six groups with every link pointing at a page
  that exists (assert it, do not eyeball it); it collapses and remembers; the palette opens on
  Cmd/Ctrl+K, filters, navigates, closes on Escape and returns focus. Keyboard-only pass described.
- **Build**: `tsc --noEmit && npm run build` green - the backoffice build is green at baseline and this
  job must not regress it - reported with the route count and the REAL exit status (redirect to a file
  and read `$?`, never let a `| tail` own it).
- Gate: report the exact pytest count (expect 125 passed / 3 deselected, unchanged - this job touches
  no backend file) after `docker compose build api`.
- No new dependency (`package.json` untouched), and the storefront is not touched: it has its own
  palette and its own jobs.

## Allowed surfaces
`apps/backoffice/app/globals.css`, `apps/backoffice/tailwind.config.ts`, `apps/backoffice/app/admin/layout.tsx`,
new files under `apps/backoffice/app/components/` for the chrome, and - only for the audit's fixes -
any other file under `apps/backoffice/app/`, with each such file LISTED in the report beside the
literal that flagged it. No backend, no storefront, no dependency, no data change. Anything else =
CHANGES.

## Constraints
- Work only on branch factory/<job-id>; LF/no-BOM; gates AFTER `docker compose build api`; never touch
  .env, secrets/, infra/, factory/*.
- `tailwind.config.ts`'s `content` must keep `./lib` in the glob: `lib/ui.ts` holds status/grade class
  strings as literal text, and a glob that misses it drops those rules from the built CSS entirely.