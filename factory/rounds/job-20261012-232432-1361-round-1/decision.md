# decision job-20261012-232432-1361

MODE: FAST LANE — the owner authorised self-approval on automated gates only (2026-10-12) and directs
the ship. No architect, security or performance round ran for this job.

DECISION: APPROVE

COMMITS: c076bf6 (the job) + a41f92e (polish) on factory/job-20261012-232432-1361.

## Gates — AS REPORTED BY THE BUILDER, NOT RE-RUN BY THE ORCHESTRATOR
The owner declined the orchestrator's gate re-run (throughput first), so these are the builder's own
measurements and are recorded as such:
- npx tsc --noEmit && npx next build -> EXIT=0, 22 routes, identical route set to the baseline it built
  first at the spec commit (no route added)
- docker compose build api -> EXIT=0
- pytest -q with the three deselects -> 125 passed, 3 deselected
- LF/no-BOM verified on the 7 staged blobs (CR=0, BOM=False)

## What shipped
/admin is now the Hyper-Overview: four glass pulse cards, the operational hub (shared pipeline map +
action tiles), the distribution grid (reused StatusDonut + a new GradeStack), the orders table and a
restyled icon-rail activity feed. Components were MOVED for genuine reuse
(app/admin/dashboard/{kpi,pipeline,charts}.tsx -> app/components/dashboard/) so there is exactly one
glass tile, one pipeline map, one donut and one sparkline in the tree; /admin/dashboard's imports were
repointed and its local stage builder deleted in favour of the shared one.

## The honesty items this record exists to preserve
1. THE SPARKLINES HAVE NO SERIES, AND NONE WAS INVENTED. revenue_paid_cents_30d, at_list_cents,
   aov_cents and newsletter.total are single figures; revenue_last_7d_cents is a scalar. The two
   briefed trend slots render Sparkline's existing explicit unavailable state ("No trend line: the API
   sends no daily series."). This is the briefed element that needs backend data.
2. Every CTA points at a route that exists, verified mechanically. reservations_expiring has NO
   destination and is rendered as a non-link tile saying so, rather than a plausible link.
3. The page stays READ-ONLY (its own contract); CTAs navigate and nothing writes. ADR 0006 intact.
4. The exact numbers survive the charts: the donut legends all 10 statuses with counts; the stacked
   bar's legend prints every grade including zero-segment ones.
5. The stacked bar's whole is the ONE summed figure on the page, and it is printed as a sum because
   inventory.by_grade carries no total (inventory.by_status does). Labelled, not hidden.

## Corrections to the spec, made by the builder (recorded because the spec was mine)
The spec listed eight needs_attention kinds; the endpoint sends exactly four (intake_waiting, restock,
reservations_expiring, in_repair_stale). The other names belong to the payload's separate dashboard
block. Mapping the spec's list would have invented three tiles the API never sends.

## Known risks carried, not fixed
- The owner's open decision: /admin and /admin/dashboard now share the pipeline map and several blocks.
  The builder recommends /admin/dashboard keeps the operations view and /admin becomes the money view,
  and names the pipeline map as the block to move. Nothing was deleted, redirected or unlinked.
- restock -> /admin/cms is the one CTA the builder wants a human to confirm (no restock route exists).
- The restyled AuditFeed is shared, so /admin/assets/[id] rendered markup changes too, unverified.
- Unverified by any gate or artifact: the rendered page, the glass/blur compositing, hover and focus
  behaviour, the charts' appearance, the stacked bar at lg width, and a screen-reader pass. The
  prerendered HTML contains NONE of this job's copy (it sits behind the session branch), so the copy is
  verified only as source.
