"""Business intelligence: sales trends, top performers, and what is sitting in the warehouse.

THE FOUR DEFINITIONS EVERY NUMBER HERE RESTS ON, because a report that disagrees with the statement
is worse than no report:

  A SALE        an order in paid/shipped/delivered - the same closed set `staff_views` already uses
                for its revenue. A pending order is not income and a cancelled one never was.
  REVENUE       `subtotal + shipping`, EX-GST. This is the ledger's own rule: the GST collected is
                the tax authority's money, so it is reported BESIDE revenue and never inside it.
  COGS          sum of `COALESCE(cost_cents, settlement_cents, 0)` over the assets that actually
                sold - again the ledger's basis and the margin guard's, so a product's margin here
                and the shelf's margin verdict are computed from one number.
  DAYS IN STOCK `now - assets.intake_at`, the day the unit was received into the warehouse.

WHY `listed_at` COMES FROM THE AUDIT LOG. There is no `listed_at` column, and `assets.updated_at` is
moved by the touch trigger on ANY edit - so it answers "when was this row last touched", not "when
did this go on sale". The audit log already records every status move with its own timestamp, and
`status -> listed` is exactly the fact the dead-stock rule needs. It is read, never recomputed.

WHY CATEGORY AND CHANNEL ARE FILTERS ON THE SAME QUERY rather than post-filters in Python: the
leaderboard and the trends must agree about what "sales in Toys, through eBay, this quarter" means,
and the only way two reports cannot disagree is if one WHERE clause defines it.
"""

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import text

# The closed set that means "money was taken". Shared by every figure in this module.
PAID_STATUSES = ("paid", "shipped", "delivered")
# The stock states that mean "this unit is in the building". A sold or scrapped unit is not stock.
STOCK_STATUSES = ("received", "tested", "in_repair", "graded", "listed", "reserved", "returned")
CHANNELS = ("storefront", "ebay", "amazon")
RANGES = (30, 90, 365)
# How long a listed unit may sit before the report calls it dead. The brief's own number.
DEAD_STOCK_DAYS = 60


class ReportError(ValueError):
    """A report request the API refuses, with a message written for the person who asked."""


def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


def _window(days: int) -> datetime:
    if days not in RANGES:
        raise ReportError("days must be one of: " + ", ".join(str(d) for d in RANGES))
    return datetime.now(timezone.utc) - timedelta(days=days)


def _filters(channel: str | None, category: str | None) -> dict:
    """The one WHERE fragment every sales report shares. Validated here so both the JSON and the
    export paths refuse the same inputs the same way."""
    if channel is not None and channel not in CHANNELS:
        raise ReportError("channel must be one of: " + ", ".join(CHANNELS))
    return {"channel": channel or None, "category": category or None}


# The shared predicate. `channel` and `category` are NULL-able: NULL means "no filter", which is
# why every use is `(:x IS NULL OR ...)` rather than being assembled in Python.
#
# CAST(...) RATHER THAN A BARE `:param IS NULL`. asyncpg cannot infer a type for a parameter that
# only ever appears beside IS NULL and answers `could not determine data type of parameter $2`; the
# CAST states it. This is the same shape `ledger.py` uses for its optional date window.
_CHANNEL = "(CAST(:channel AS text) IS NULL OR o.channel = CAST(:channel AS text))"
_CATEGORY = ("(CAST(:category AS text) IS NULL OR EXISTS ("
             " SELECT 1 FROM order_lines ol2 JOIN products p2 ON p2.id = ol2.product_id"
             " JOIN categories c2 ON c2.id = p2.category_id"
             " WHERE ol2.order_id = o.id AND c2.slug = CAST(:category AS text)))")


# ---------------------------------------------------------------------------
# 1. Sales trends
# ---------------------------------------------------------------------------
async def sales_trends(db, *, days: int, channel: str | None, category: str | None) -> dict:
    """Revenue (ex-GST), GST collected, order count and units sold, bucketed by day.

    THE SERIES IS DENSE - every day in the window is present, zeros included. A time series that
    omits its empty days draws a line straight from the last sale to the next one, which reads as
    steady trade across a week the shop was shut.
    """
    since = _window(days)
    f = _filters(channel, category)
    rows = (await db.execute(text(f"""
        SELECT date_trunc('day', o.placed_at)::date AS day,
               count(*) AS orders,
               COALESCE(sum(o.subtotal_cents + o.shipping_cents), 0) AS revenue_cents,
               COALESCE(sum(o.tax_cents), 0) AS gst_cents
        FROM orders o
        WHERE o.status IN {PAID_STATUSES}
          AND o.placed_at >= :since AND {_CHANNEL} AND {_CATEGORY}
        GROUP BY 1 ORDER BY 1"""), {"since": since, **f})).mappings().all()

    units = (await db.execute(text(f"""
        SELECT date_trunc('day', o.placed_at)::date AS day, COALESCE(sum(ol.qty), 0) AS units
        FROM orders o JOIN order_lines ol ON ol.order_id = o.id
        WHERE o.status IN {PAID_STATUSES}
          AND o.placed_at >= :since AND {_CHANNEL} AND {_CATEGORY}
        GROUP BY 1"""), {"since": since, **f})).mappings().all()

    by_day = {r["day"]: {"orders": int(r["orders"]), "revenue_cents": int(r["revenue_cents"]),
                         "gst_cents": int(r["gst_cents"]), "units": 0} for r in rows}
    for r in units:
        by_day.setdefault(r["day"], {"orders": 0, "revenue_cents": 0, "gst_cents": 0,
                                     "units": 0})["units"] = int(r["units"])

    today = datetime.now(timezone.utc).date()
    series = []
    for i in range(days, -1, -1):
        day = today - timedelta(days=i)
        bucket = by_day.get(day, {"orders": 0, "revenue_cents": 0, "gst_cents": 0, "units": 0})
        series.append({"date": day.isoformat(), **bucket})

    return {"days": days, "from": (today - timedelta(days=days)).isoformat(),
            "to": today.isoformat(), "channel": f["channel"], "category": f["category"],
            "series": series,
            "totals": {"orders": sum(p["orders"] for p in series),
                       "units": sum(p["units"] for p in series),
                       "revenue_cents": sum(p["revenue_cents"] for p in series),
                       "gst_cents": sum(p["gst_cents"] for p in series)},
            "channels": list(CHANNELS)}


# ---------------------------------------------------------------------------
# 2. Top performers
# ---------------------------------------------------------------------------
async def top_performers(db, *, days: int, channel: str | None, category: str | None,
                         limit: int = 20) -> dict:
    """The product leaderboard: units, revenue, margin, and how fast each one moves.

    A LINE WITH NO PRODUCT IS ONE BUCKET, not one row per serial: a unit sold from a lot with no
    catalogue entry still has to appear (its revenue is real), but twenty such units are the same
    fact twenty times over, so they are grouped under "Unattributed stock" rather than filling the
    leaderboard with singletons.

    VELOCITY IS UNITS PER DAY OVER THE WINDOW, not over the days the product happened to sell on -
    a model that sold 10 units in one day and nothing either side is not moving at 10/day, and
    dividing by its own active days is how a leaderboard flatters a flash sale.
    """
    since = _window(days)
    f = _filters(channel, category)
    rows = (await db.execute(text(f"""
        SELECT COALESCE(p.id, 0) AS product_id,
               COALESCE(p.title, 'Unattributed stock') AS title,
               COALESCE(p.slug, '') AS slug,
               COALESCE(c.name, '') AS category,
               COALESCE(sum(ol.qty), 0) AS units,
               COALESCE(sum(ol.line_total_cents), 0) AS revenue_cents,
               COALESCE(sum(COALESCE(a.cost_cents, a.settlement_cents, 0)), 0) AS cogs_cents
        FROM order_lines ol
        JOIN orders o ON o.id = ol.order_id
        LEFT JOIN products p ON p.id = ol.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN assets a ON a.id = ol.asset_id
        WHERE o.status IN {PAID_STATUSES}
          AND o.placed_at >= :since AND {_CHANNEL} AND {_CATEGORY}
        GROUP BY 1, 2, 3, 4
        ORDER BY revenue_cents DESC
        LIMIT :limit"""), {"since": since, "limit": limit, **f})).mappings().all()

    products = []
    for r in rows:
        revenue, cogs, units = int(r["revenue_cents"]), int(r["cogs_cents"]), int(r["units"])
        products.append({
            "product_id": int(r["product_id"]), "title": r["title"], "slug": r["slug"],
            "category": r["category"], "units": units, "revenue_cents": revenue,
            "cogs_cents": cogs, "margin_cents": revenue - cogs,
            # Margin % is against revenue; with no revenue it is 0 rather than a division error.
            "margin_pct": round((revenue - cogs) / revenue * 100, 1) if revenue else 0.0,
            # Units per day across the whole window - see the docstring.
            "velocity_per_day": round(units / days, 3),
        })

    return {"days": days, "channel": f["channel"], "category": f["category"],
            "products": products,
            # The three leaderboards the screen shows, each a different order over the SAME rows:
            # one definition of a product's performance, three ways of reading it.
            "by_units": sorted(products, key=lambda p: (-p["units"], p["title"]))[:limit],
            "by_revenue": sorted(products, key=lambda p: (-p["revenue_cents"], p["title"]))[:limit],
            "by_margin": sorted(products, key=lambda p: (-p["margin_cents"], p["title"]))[:limit],
            "by_velocity": sorted(products, key=lambda p: (-p["velocity_per_day"], p["title"]))[:limit]}


# ---------------------------------------------------------------------------
# 3. Inventory turnover and dead stock
# ---------------------------------------------------------------------------
async def inventory(db, *, dead_days: int = DEAD_STOCK_DAYS, limit: int = 300) -> dict:
    """Every unit in the building, how long it has been there, and which have gone stale.

    DEAD STOCK IS `listed` AND UNMOVED FOR `dead_days`, measured from the audit log's own listing
    event (see the module docstring) - not from `updated_at`. Units that are mid-refurbishment are
    NOT dead: a unit in `in_repair` is being worked on, and calling it dead would put an operator on
    the phone about stock the workshop already has in hand.
    """
    if dead_days < 0:
        raise ReportError("dead_days must not be negative")
    cutoff = datetime.now(timezone.utc) - timedelta(days=dead_days)
    rows = (await db.execute(text("""
        WITH listed AS (
          SELECT DISTINCT ON (entity_id) entity_id AS asset_id, at AS listed_at
          FROM audit_log
          WHERE entity = 'asset' AND action = 'status' AND after->>'status' = 'listed'
          ORDER BY entity_id, at DESC
        )
        SELECT a.id, a.serial_number, a.status, a.grade, a.cost_cents, a.sale_price_cents,
               a.intake_at, COALESCE(p.title, 'Unattributed stock') AS title,
               COALESCE(c.name, '') AS category, l.listed_at,
               EXTRACT(EPOCH FROM (now() - a.intake_at)) / 86400.0 AS days_in_warehouse
        FROM assets a
        LEFT JOIN products p ON p.id = a.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN listed l ON l.asset_id = a.id
        WHERE a.status IN """ + str(STOCK_STATUSES) + """
        ORDER BY days_in_warehouse DESC
        LIMIT :limit"""), {"limit": limit})).mappings().all()

    units = []
    for r in rows:
        listed_at = r["listed_at"]
        days_listed = ((datetime.now(timezone.utc) - listed_at).total_seconds() / 86400.0
                       if listed_at is not None else None)
        units.append({
            "asset_id": r["id"], "serial_number": r["serial_number"], "status": r["status"],
            "grade": r["grade"], "title": r["title"], "category": r["category"],
            "cost_cents": int(r["cost_cents"] or 0),
            "sale_price_cents": (int(r["sale_price_cents"]) if r["sale_price_cents"] is not None else None),
            "days_in_warehouse": round(float(r["days_in_warehouse"] or 0), 1),
            "listed_at": _iso(listed_at),
            "days_listed": round(days_listed, 1) if days_listed is not None else None,
            # The rule the brief states, applied on the listing event.
            "dead": (r["status"] == "listed" and listed_at is not None and listed_at < cutoff),
        })

    # THE SUMMARY DESCRIBES THE WHOLE POPULATION, NOT THE PAGE. `units` above is capped so a screen
    # can render it; a headline computed from that list would report the PAGE SIZE as the stock level
    # - 12,091 units of stock reading as "2,000" - which is the kind of quiet lie a report must never
    # tell. So the totals are their own aggregate over every in-stock unit.
    totals = (await db.execute(text("""
        WITH listed AS (
          SELECT DISTINCT ON (entity_id) entity_id AS asset_id, at AS listed_at
          FROM audit_log
          WHERE entity = 'asset' AND action = 'status' AND after->>'status' = 'listed'
          ORDER BY entity_id, at DESC
        )
        SELECT count(*) AS units,
               COALESCE(sum(a.cost_cents), 0) AS value_cents,
               COALESCE(sum(CASE WHEN a.status = 'listed' AND l.listed_at IS NOT NULL
                                  AND l.listed_at < :cutoff THEN 1 ELSE 0 END), 0) AS dead_units,
               COALESCE(sum(CASE WHEN a.status = 'listed' AND l.listed_at IS NOT NULL
                                  AND l.listed_at < :cutoff THEN a.cost_cents ELSE 0 END), 0)
                 AS dead_value_cents
        FROM assets a LEFT JOIN listed l ON l.asset_id = a.id
        WHERE a.status IN """ + str(STOCK_STATUSES)), {"cutoff": cutoff})).mappings().one()
    by_status = (await db.execute(text(
        "SELECT a.status, count(*) AS n FROM assets a WHERE a.status IN "
        + str(STOCK_STATUSES) + " GROUP BY a.status"))).mappings().all()

    return {"dead_days": dead_days, "as_of": datetime.now(timezone.utc).isoformat(),
            "units": units,
            "summary": {
                "units_in_stock": int(totals["units"]),
                "stock_value_cents": int(totals["value_cents"]),
                "dead_units": int(totals["dead_units"]),
                "dead_value_cents": int(totals["dead_value_cents"]),
                "by_status": {s: 0 for s in STOCK_STATUSES} | {r["status"]: int(r["n"])
                                                               for r in by_status},
            }}
