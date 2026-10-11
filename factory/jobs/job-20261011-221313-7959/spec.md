# storefront aesthetic pass: typography, interactive states, polish

## Context
The storefront is functional but visually basic: system-default font treatment, plain buttons, minimal hover feedback. A design system exists (CSS custom properties e.g. --status-listed-solid, contrast parity from the storefront-design-system work) - this job EXTENDS it, no overhaul, no layout redesign. No new dependencies; no backend changes; no logic changes.

## Deliverable
1. Typography: a refined scale on the CURRENT font stack (default: system stack - webfont only if the owner names one): heading tracking/weight rhythm (tighter display sizes), body size/lead rhythm, consistent text-color tokens. Every page reads visually calmer and more premium after the change.
2. Buttons: every interactive element gets the full state set - hover (subtle shade shift), active (1-2px translate or darken), focus-visible (2px emerald ring, keyboard-visible), disabled (muted). Encapsulate as shared button/interactive classes or component(s) reused everywhere - not per-page ad-hoc strings.
3. Cards and links: hover = soft lift + ring (tokens), transitions 150-200ms ease-out as CSS var, prefers-reduced-motion respected (no movement for those users).
4. Consistency sweep: no color-alone meaning anywhere touched; spacing rhythm aligned to existing scale.

## Acceptance
- Every interactive element on home / catalog / category / product / cart / content pages demonstrates all four states (owner checks in browser).
- backoffice and api untouched; storefront pages keep all functionality identical (only appearance changes).
- Gate unchanged (69/3 + the 3 selects... report the exact numbers); storefront prod build green.
- Allowed surfaces: apps/storefront/app/** (styling/css/components/layout), NO new dependencies, NO backend, NO logic rewrites of page logic (classNames + new css/component files are the expected diff; the report states any logic file touched and why).

## Constraints
- Work only on branch factory/<job-id>; LF/no-BOM; do NOT touch .env, secrets/, infra/, alembic/, factory/*.