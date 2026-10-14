"""The staff overview: the one guarded read behind the /admin dashboard.

ONE endpoint, not several. The dashboard is one screen, so it is one guarded surface and one
round trip - a page assembled from six endpoints would be six places a read can leak and six
sequential waits before the first pixel lands.

Everything here reads the app DB (`get_db` -> rfo_app) straight off the base tables. The `ai.*`
views are deliberately NOT used: their DDL exists nowhere in version control (only their
consumers appear in the repo), and a user-facing page must not depend on unversioned DB state.

Eighteen set-based aggregates, no N+1 - one statement per block, never a query per row. Nine of
them are the blocks in the response (by_status, by_grade, lots, stock_value, reservations,
orders, newsletter, audit_feed, restock); the other two are the needs_attention predicates the
nine do not cover (intake lots that actually hold units, and units stuck in repair). The last
seven (pricing_pending, stuck, lots_stuck, grade_mix, category_mix, revenue_7d, team_activity)
are the `dashboard` block the /admin/dashboard page reads; they are appended to this same
endpoint rather than given a second route, because the dashboard is still ONE screen and a
second summary door would be a second place a read can leak.

INDEX REALITY (measured on the live DB with EXPLAIN ANALYZE - do not read this as "all covered"):
by_status does NOT scan the heap - it is an Index Only Scan of assets_status_idx (a few heap
fetches aside, until the table is vacuumed). The in-repair-stale count is an Index Scan of that
same index with `Index Cond: status = 'in_repair'` plus a Filter on updated_at: there is no
assets.updated_at index, and none is needed at this selectivity, because the status index already
carries the predicate (0.07 ms measured). reservations_expires_idx carries the reservations
filter, and audit_at_idx serves the audit feed - how that index copes with a *selective*
actor_type filter is J8's concern, since J8 is what starts writing actor_type='agent'.

TWO STATEMENTS ARE FULL SEQUENTIAL SCANS OF assets, and they are the ones that actually cost:
by_grade (there is no assets.grade index) at ~0.9 ms and stock_value (an unconditional aggregate
over every row, so it can use no WHERE) at ~0.9 ms. At ~0.17 us/row they are the same O(assets)
cost, so they scale together: at ~300k assets (~50x today) the pair is ~100 ms. The orders revenue
filter is unindexed too (no orders.placed_at index), but it scans a small table - it only begins
to matter around ~1M orders. At the current volume (~6.3k assets, hundreds of orders) the whole
endpoint is comfortably sub-budget (~12 ms), so this job adds NO index. When the tables grow,
assets.grade and the two full-assets scans are the first to want one.

The dashboard block adds seven more statements, and six of them are cheap because they ride
indexes that were already there (all measured at ~6.9k assets): pricing_pending, stuck and
grade_mix are Index Scans of assets_status_idx - their whole predicate is `status = ...`, with a
Filter for the price / the intake age - at 0.7 / 0.2 / 0.2 ms; category_mix is that same status
index scan hash-joined to products and categories, 0.3 ms; lots_stuck is a Seq Scan of the small
lots table (1.6k rows), 0.2 ms; and the 7-day revenue scan is the SAME unindexed small-orders
scan the 30-day block already pays for, 0.9 ms. Note grade_mix is an Index Scan, NOT the full
assets scan by_grade needs: the `status = 'listed'` predicate is what keeps it off the heap.

The seventh, team_activity, is the one statement here whose cost tracks the TABLE rather than the
predicate. Measured today it is a Seq Scan + HashAggregate over audit_log (2041 actor groups,
3.0 ms): the planner does NOT use audit_at_idx, because a 7-day window over a table whose rows are
mostly recent is not selective enough to beat a scan, and `actor_type = 'staff'` lands as a Filter
on top rather than an Index Cond. audit_log is append-only and never pruned, so this is the
statement to watch - it is the only new one that grows with everything ever audited, and it is
what a composite (at, actor_type) or a partial actor_type index would be for. Deliberately NOT
added here: at ~3 ms it is not yet worth an index, and this job adds none.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import text

from app.api.v1.deps import require_roles
from app.core.db import get_db

router = APIRouter(prefix="/staff", tags=["staff-overview"])

# The lifecycle values the DB's own CHECK constraints admit (assets_status_check,
# assets_grade_check, lots_status_check, orders_status_check). They are zero-filled into the
# grouped counts so a state with no rows reads as an explicit 0 instead of vanishing from the
# payload - the dashboard shows the whole lifecycle, not only the states that happen to be
# occupied. A value the DB admits but this list forgot is still emitted (see _counts): the
# grouped rows win over the defaults, never the other way round.
ASSET_STATUSES = ("received", "tested", "in_repair", "graded", "listed",
                  "reserved", "sold", "shipped", "returned", "scrapped")
GRADES = ("A", "B", "C", "D")
# No "cancelled": a cancelled lot is not a lot awaiting work, so it is not part of the lifecycle
# the overview reports - and if one ever exists it is still emitted by _counts.
LOT_STATUSES = ("intake", "active", "completed")
ORDER_STATES = ("pending", "paid", "shipped", "delivered", "cancelled", "refunded")


def _counts(defaults: tuple[str, ...], rows) -> dict[str, int]:
    """Grouped (key, count) rows over a zero-filled default key set - defaults first, rows win."""
    out: dict[str, int] = {k: 0 for k in defaults}
    for key, n in rows:
        out[str(key)] = int(n)
    return out


def _iso(value: datetime) -> str:
    return value.isoformat()


@router.get("/overview")
async def overview(staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
    by_status = _counts(ASSET_STATUSES, (await db.execute(
        text("SELECT status, count(*) FROM assets GROUP BY status"))).all())

    by_grade = _counts(GRADES, (await db.execute(
        text("SELECT grade, count(*) FROM assets WHERE grade IS NOT NULL GROUP BY grade"))).all())

    lots_by_status = _counts(LOT_STATUSES, (await db.execute(
        text("SELECT status, count(*) FROM lots GROUP BY status"))).all())

    stock = (await db.execute(text("""
        SELECT COALESCE(sum(cost_cents), 0),
               count(cost_cents),
               COALESCE(sum(sale_price_cents) FILTER (WHERE status = 'listed'), 0),
               count(*) FILTER (WHERE status = 'listed')
        FROM assets
    """))).one()

    resv = (await db.execute(text("""
        SELECT count(*) FILTER (WHERE status IN ('active', 'confirmed')),
               count(*) FILTER (WHERE status IN ('active', 'confirmed')
                                  AND expires_at < now() + interval '24 hours')
        FROM reservations
    """))).one()

    order_rows = (await db.execute(text("""
        SELECT status, count(*), COALESCE(sum(total_cents), 0)
        FROM orders
        WHERE placed_at >= now() - interval '30 days'
        GROUP BY status
    """))).all()
    orders_30d = sum(int(n) for _, n, _ in order_rows)
    revenue_paid = sum(int(total) for status, _, total in order_rows if status == "paid")

    newsletter_total = (await db.execute(
        text("SELECT count(*) FROM newsletter_subscribers"))).scalar_one()

    # 'agent' is admitted by the enum in the next job; including it now means this feed does not
    # silently hide agent activity the day it starts. (The DB's audit_log_actor_type_check admits
    # staff/system/customer today, so the value simply never matches yet.)
    audit_rows = (await db.execute(text("""
        SELECT at, actor_type, actor_id, entity, action, entity_id
        FROM audit_log
        WHERE actor_type IN ('staff', 'agent', 'system')
        ORDER BY at DESC
        LIMIT 20
    """))).all()

    # count(*) OVER () is the true number of out-of-stock products (computed after HAVING, before
    # LIMIT); the LIMIT keeps only the first five for the list itself.
    restock_rows = (await db.execute(text("""
        SELECT p.id, p.title, count(*) OVER () AS total
        FROM products p
        LEFT JOIN assets a ON a.product_id = p.id AND a.status = 'listed'
        GROUP BY p.id, p.title
        HAVING count(a.id) = 0
        ORDER BY p.title
        LIMIT 5
    """))).all()

    intake_waiting = (await db.execute(text("""
        SELECT count(*) FROM lots l
        WHERE l.status = 'intake' AND EXISTS (SELECT 1 FROM assets a WHERE a.lot_id = l.id)
    """))).scalar_one()

    in_repair_stale = (await db.execute(text("""
        SELECT count(*) FROM assets
        WHERE status = 'in_repair' AND updated_at < now() - interval '14 days'
    """))).scalar_one()

    restock_count = int(restock_rows[0][2]) if restock_rows else 0

    # ---------------- the /admin/dashboard block ----------------
    # Graded units that carry no price. chk_listed_has_price only stops a LISTED unit reaching the
    # storefront unpriced, so a graded unit can sit unpriced indefinitely - that gap is the whole
    # alert. No index on status+price; it rides assets_status_idx like the rest of the counts.
    pricing_pending = (await db.execute(text("""
        SELECT count(*) FROM assets WHERE status = 'graded' AND sale_price_cents IS NULL
    """))).scalar_one()

    # Stuck = still in received/tested, aged by assets.intake_at - NOT updated_at. The
    # rfo_touch_updated_at trigger rewrites updated_at on every UPDATE, so it can never answer
    # "how long has this unit sat here" (and cannot even be backdated for a test). intake_at is
    # written once at scan-in and no trigger touches it. array_agg picks the oldest serial in the
    # SAME single scan; a NULL serial is legal and sorts first, and reporting it is honest - an
    # unnamed oldest unit is still the oldest unit.
    stuck = (await db.execute(text("""
        SELECT count(*), (array_agg(serial_number ORDER BY intake_at ASC))[1]
        FROM assets
        WHERE status IN ('received', 'tested') AND intake_at < now() - interval '7 days'
    """))).one()

    # Lots received (received_at, again untriggered) and still in intake after 14 days - never
    # activated. A lot that moved on to active/completed is history, not a backlog.
    lots_stuck = (await db.execute(text("""
        SELECT count(*) FROM lots
        WHERE status = 'intake' AND received_at < now() - interval '14 days'
    """))).scalar_one()

    # Stale stock: units that have sat LISTED for over three months without selling. This is the
    # one count on the page whose date is not on the asset row, and the reason is the same trigger
    # the note above gives for `stuck`: rfo_touch_updated_at rewrites updated_at on every UPDATE, so
    # the row itself can only ever say when it was last touched, never how long it has been on sale.
    # There is no listed_at column and one could not be trusted to stay true.
    #
    # The one place a listing IS recorded is the audit trail's status transition, so the age is read
    # from there: the latest transition into 'listed' for an asset still listed today.
    #
    # MAX, not MIN, and the difference is the whole meaning of the alert. A unit that was listed,
    # pulled, and re-listed last week is a YOUNG listing; taking the earliest entry would mark it
    # stale for the rest of its life and send the operator to discount a unit that has just gone up.
    #
    # "Without a sale" needs no predicate of its own: a sale moves the unit out of `listed`, so
    # `status = 'listed'` IS the statement that it has not sold. A unit with no listing transition in
    # the trail is NOT counted - the subquery returns NULL, the comparison is NULL, and the row falls
    # out. That is deliberate: 146 of today's 4368 listed units are in that position (listed before
    # the trail reached them), and for those the payload genuinely cannot tell. Guessing at them from
    # updated_at would invent the exact fact the alert exists to report.
    #
    # Cost, measured at ~6.9k assets: 7.5 ms. The aggregate rides audit_entity_idx (entity, entity_id)
    # and filters to ~6k status->listed rows before grouping, so it is one index scan plus a
    # hash-join onto assets, not a correlated subquery per listed unit.
    stale_listed = (await db.execute(text("""
        SELECT count(*)
        FROM assets a
        JOIN (SELECT entity_id, max(at) AS listed_at
              FROM audit_log
              WHERE action = 'status' AND entity = 'asset' AND after->>'status' = 'listed'
              GROUP BY entity_id) e ON e.entity_id = a.id
        WHERE a.status = 'listed' AND e.listed_at < now() - interval '90 days'
    """))).scalar_one()

    # grade_mix is LISTED units only - the storefront-facing mix, not every graded unit (that is
    # inventory.by_grade). The DB pins listed => grade IS NOT NULL, so the status filter is the
    # whole predicate.
    grade_mix = _counts(GRADES, (await db.execute(text(
        "SELECT grade, count(*) FROM assets WHERE status = 'listed' GROUP BY grade"))).all())

    # category_mix: the same listed population, by product category. An asset with no product_id
    # cannot have a category, so the JOINs drop it - the mix reports what is ON SALE, and an
    # unassigned unit is not. Ordered by size so the list reads largest first.
    category_rows = (await db.execute(text("""
        SELECT c.name, count(*)
        FROM assets a
        JOIN products p ON p.id = a.product_id
        JOIN categories c ON c.id = p.category_id
        WHERE a.status = 'listed'
        GROUP BY c.name
        ORDER BY count(*) DESC, c.name
    """))).all()
    category_mix = {str(name): int(n) for name, n in category_rows}

    # Paid revenue/orders over 7 days, the same "paid only" rule orders_30d already uses.
    rev7 = (await db.execute(text("""
        SELECT count(*), COALESCE(sum(total_cents), 0) FROM orders
        WHERE status = 'paid' AND placed_at >= now() - interval '7 days'
    """))).one()

    # team_activity: staff-authored audit rows of the last 7 days, grouped by actor, top five.
    # LEFT JOIN, not JOIN: audit_log keeps no FK either way, so an actor whose staff row was
    # deleted keeps its activity with a NULL email instead of vanishing - the trail outlives the
    # account. `actor_type = 'staff'` is load-bearing: actor_id is a staff_users id only for
    # staff rows (customer rows hold a users id, system rows hold none), so grouping without it
    # would silently merge two different id spaces.
    team_rows = (await db.execute(text("""
        SELECT a.actor_id, s.email, count(*)
        FROM audit_log a
        LEFT JOIN staff_users s ON s.id = a.actor_id
        WHERE a.actor_type = 'staff' AND a.actor_id IS NOT NULL
          AND a.at >= now() - interval '7 days'
        GROUP BY a.actor_id, s.email
        ORDER BY count(*) DESC, a.actor_id ASC
        LIMIT 5
    """))).all()

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "inventory": {
            "by_status": by_status,
            "by_grade": by_grade,
            # sum of the status groups, not a statement of its own: assets.status is NOT NULL, so
            # the group counts sum to exactly count(*) FROM assets.
            "total_units": sum(by_status.values()),
        },
        "lots": {"by_status": lots_by_status},
        "stock_value": {
            "at_cost_cents": int(stock[0]),
            "at_list_cents": int(stock[2]),
            "listed_units": int(stock[3]),
            "cost_known_units": int(stock[1]),
        },
        "reservations": {"active": int(resv[0]), "expiring_24h": int(resv[1])},
        "orders": {
            "by_state": _counts(ORDER_STATES, [(status, n) for status, n, _ in order_rows]),
            "revenue_paid_cents_30d": revenue_paid,
            "orders_30d": orders_30d,
            "aov_cents": round(revenue_paid / orders_30d) if orders_30d else 0,
        },
        "newsletter": {"total": int(newsletter_total)},
        # The /admin/dashboard page's own block. Field names are the page's contract - the counts
        # the page shows as KPI tiles and alerts, plus the two mixes and the leaderboard its two
        # hand-rolled SVG charts read.
        "dashboard": {
            "pricing_pending": int(pricing_pending),
            "revenue_last_7d_cents": int(rev7[1]),
            "orders_last_7d": int(rev7[0]),
            "stuck_assets": {"count": int(stuck[0]), "oldest_serial_number": stuck[1]},
            "lots_stuck": {"count": int(lots_stuck)},
            # `days` is the threshold the count was taken at, carried in the payload so the page can
            # write "over 3 months" without hard-coding 90 next to a number it did not compute. The
            # two must not be able to disagree.
            "stale_listed": {"count": int(stale_listed), "days": 90},
            "grade_mix": grade_mix,
            "category_mix": category_mix,
            "team_activity": [
                {"actor_id": r[0], "actor_email": r[1], "actions": int(r[2])} for r in team_rows
            ],
        },
        "audit_feed": [
            {"at": _iso(r[0]), "actor_type": r[1], "actor_id": r[2],
             "entity": r[3], "action": r[4], "entity_id": r[5]}
            for r in audit_rows
        ],
        "needs_attention": [
            {"kind": "intake_waiting", "count": int(intake_waiting), "label": "Lots in intake"},
            {"kind": "restock", "count": restock_count, "label": "Products out of stock",
             "items": [{"id": int(r[0]), "title": r[1]} for r in restock_rows]},
            {"kind": "reservations_expiring", "count": int(resv[1]),
             "label": "Reservations expiring in 24h"},
            {"kind": "in_repair_stale", "count": int(in_repair_stale),
             "label": "In repair > 14 days"},
        ],
    }
