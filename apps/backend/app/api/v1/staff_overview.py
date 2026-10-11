"""The staff overview: the one guarded read behind the /admin dashboard.

ONE endpoint, not several. The dashboard is one screen, so it is one guarded surface and one
round trip - a page assembled from six endpoints would be six places a read can leak and six
sequential waits before the first pixel lands.

Everything here reads the app DB (`get_db` -> rfo_app) straight off the base tables. The `ai.*`
views are deliberately NOT used: their DDL exists nowhere in version control (only their
consumers appear in the repo), and a user-facing page must not depend on unversioned DB state.

Eleven set-based aggregates, no N+1 - one statement per block, never a query per row. Nine of
them are the blocks in the response (by_status, by_grade, lots, stock_value, reservations,
orders, newsletter, audit_feed, restock); the other two are the needs_attention predicates the
nine do not cover (intake lots that actually hold units, and units stuck in repair).

INDEX REALITY (verified against the live DB, and left alone on purpose): covered today are
assets_status_idx, assets_product_idx, orders_status_idx, reservations_expires_idx and
audit_at_idx. THREE of these aggregates are sequential scans: by_grade (no index on
assets.grade), the in-repair-stale count (no index on assets.updated_at) and the orders revenue
filter (no index on orders.placed_at). At the current volume (~6.2k assets, hundreds of orders)
each is sub-millisecond, so this job adds NO index. When the tables grow, those three are the
first to want one.
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

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "inventory": {
            "by_status": by_status,
            "by_grade": by_grade,
            # sum of the status groups, not a twelfth statement: assets.status is NOT NULL, so
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
