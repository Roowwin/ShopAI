import re

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text

from app.core.db import get_db

router = APIRouter(prefix="/store", tags=["store-catalog"])

# ---------------------------------------------------------------------------
# The catalog list, and the filters the storefront's chip rows are built from.
#
# The two placeholders keep every optional filter out of the query TEXT: with none set they expand
# to empty strings, so the statement is byte-for-byte the one this endpoint has always run (there is
# a test that says so). Every value that reaches the database is a bound parameter - no ::TYPE cast
# in text() anywhere, which is also what asyncpg's prepared-statement path needs.
#
# The unit-level filters (grade, price band) hang off the LEFT JOIN's ON clause rather than the
# WHERE, deliberately: the joined set is then exactly "the shopper's units", so units_available and
# price_from_cents describe the stock the filter selected ("3 in stock" for grade A means three
# grade-A units, not three units of a product that happens to have one) and HAVING count(a.id) > 0
# keeps only products that really have one. Category and brand are facts of the PRODUCT, so they
# stay in the WHERE.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# THE MARGIN FLOOR - the shop must not offer a unit priced below what it cost.
#
# Selling under cost loses money on every order, and the loss is invisible on a product page that
# shows only the price. So the predicate is part of "which units are the shopper's" and rides on the
# ASSETS JOIN, exactly like the grade and price-band filters and for the reason stated above: the
# joined set IS the sellable stock, so `units_available` and `price_from_cents` describe only that,
# and HAVING count(a.id) > 0 then takes a product whose every listed unit is under water off the
# catalogue entirely rather than showing it with a count of none.
#
# THE COST BASIS IS `COALESCE(cost_cents, settlement_cents)`. `cost_cents` is the schema's canonical
# cost and the supplier workbook's Settlement is the same fact for stock that arrived on a sheet, so
# the shop reads them as one number in the order the app already prefers - `services.pricing`'s
# `margin_verdict` makes the identical choice, which is what keeps the guard that lets a unit be
# LISTED and the guard that PUBLISHES it from ever disagreeing.
#
# NULL COST PUBLISHES. An absent cost is a fact about the workbook ("this sheet never carried one"),
# not a claim that the unit is a loss-maker, so hiding it would empty the shop of everything the
# supplier did not price. Only a KNOWN cost below the price is a refusal.
#
# Written once and spliced into each statement at import time rather than duplicated per query: the
# six statements below have to agree on this rule, and a second copy of it is a second thing to keep
# true. It is spliced into the CONSTANT (not a new placeholder) so the unfiltered statement remains
# byte-for-byte what it always was, which is what the catalog query's own test asserts.
# ---------------------------------------------------------------------------
ON_SALE = ("AND (COALESCE(a.cost_cents, a.settlement_cents) IS NULL"
           " OR a.sale_price_cents >= COALESCE(a.cost_cents, a.settlement_cents)) ")

CATALOG_SELECT = """SELECT p.id, p.public_id::text AS public_id, p.slug, p.title, p.model,
       b.name AS brand, c.name AS category, p.specs, p.image_url, p.featured,
       count(a.id) AS units_available,
       min(a.sale_price_cents) AS price_from_cents
FROM products p
JOIN brands b ON b.id = p.brand_id
JOIN categories c ON c.id = p.category_id
LEFT JOIN assets a ON a.product_id = p.id AND a.status = 'listed'
                  AND EXISTS (SELECT 1 FROM lots l WHERE l.id = a.lot_id AND l.status = 'active')""" \
    + ON_SALE + """%UNIT%
WHERE p.status = 'active' %CAT%
GROUP BY p.id, p.public_id, p.slug, p.title, p.model, b.name, c.name, p.specs, p.image_url, p.featured
HAVING count(a.id) > 0
ORDER BY p.featured DESC, p.title
LIMIT :lim OFFSET :off"""

CATALOG_SORTS = {
    "featured": "ORDER BY p.featured DESC, p.title",
    "new": "ORDER BY p.created_at DESC",
    "price_asc": "ORDER BY min(a.sale_price_cents), p.title",
    "price_desc": "ORDER BY min(a.sale_price_cents) DESC, p.title",
    "name": "ORDER BY p.title",
}

GRADES = ("A", "B", "C", "D")
BRAND_SLUG = re.compile(r"[a-z0-9][a-z0-9-]{0,79}\Z")
MAX_CENTS = 100_000_000     # $1,000,000 - a ceiling for the parameter, not a business rule
MAX_Q = 100                 # a search term, not a paragraph; the URL layer drops anything longer

# The brands a shopper can filter by, and how many products each actually has BEHIND IT - where
# "behind it" means inside what the shopper is looking at, not across the whole shop. This query
# carries the list's own placeholders: the same product-level clauses in its WHERE and the same
# unit-level ones on its assets join, so both statements are built from ONE description of the
# filters and cannot drift apart when a filter is added.
#
# The one filter deliberately absent is the BRAND itself. A facet that filtered itself would shrink
# to the brand already chosen and leave the shopper no way to switch, so the caller passes the other
# filters in force and never this one - and the parameter is simply None, which needs no flag.
CATALOG_BRANDS = """
SELECT b.slug, b.name, count(DISTINCT p.id) AS n
FROM brands b
JOIN products p ON p.brand_id = b.id
JOIN categories c ON c.id = p.category_id
JOIN assets a ON a.product_id = p.id AND a.status = 'listed'
             AND EXISTS (SELECT 1 FROM lots l WHERE l.id = a.lot_id AND l.status = 'active')""" \
    + ON_SALE + """%UNIT%
WHERE p.status = 'active' %CAT%
GROUP BY b.slug, b.name
HAVING count(DISTINCT a.id) > 0
ORDER BY b.name"""


def _product_clauses(category: str | None, brand: str | None, q: str | None) -> list[str]:
    """The predicates that decide WHICH PRODUCTS exist. The list and the facet both build from these.

    The predicate is written once and used by both, because the failure mode is not a wrong clause -
    it is one query learning a filter the other never hears about. `brand=None` is how the facet
    excludes itself: no flag to remember, no branch to forget.
    """
    where = []
    if category:
        where.append("AND (c.name = :cat OR c.slug = :cat)")
    if brand:
        where.append("AND b.slug = :brand")
    if q:
        where.append("AND p.search_vec @@ websearch_to_tsquery('english', :q)")
    return where


def _unit_clauses(grade: str | None, min_cents: int | None, max_cents: int | None) -> str:
    """The predicates that decide WHICH UNITS count. They hang off the assets join rather than the
    WHERE, so the joined set is exactly "the shopper's units" and the counts describe those."""
    unit = ""
    if grade:
        unit += " AND a.grade = :grade"
    if min_cents is not None:
        unit += " AND a.sale_price_cents >= :min_cents"
    if max_cents is not None:
        unit += " AND a.sale_price_cents <= :max_cents"
    return unit


def _brand_facet_sql(category: str | None, q: str | None, grade: str | None,
                     min_cents: int | None, max_cents: int | None) -> str:
    """The Brand facet's statement for the filters in force.

    Unfiltered this is CATALOG_BRANDS with both placeholders expanded to nothing - the statement this
    endpoint has always run for the facet, character for character.
    """
    return (CATALOG_BRANDS.replace("%CAT%", " ".join(_product_clauses(category, None, q)))
            .replace("%UNIT%", _unit_clauses(grade, min_cents, max_cents)))


async def _brand_facets(db, *, category: str | None, q: str | None, grade: str | None,
                        min_cents: int | None, max_cents: int | None) -> list:
    sql = _brand_facet_sql(category, q, grade, min_cents, max_cents)
    params: dict = {}
    if category:
        params["cat"] = category
    if q:
        params["q"] = q
    if grade:
        params["grade"] = grade
    if min_cents is not None:
        params["min_cents"] = min_cents
    if max_cents is not None:
        params["max_cents"] = max_cents
    rows = (await db.execute(text(sql), params)).mappings().all()
    return [{"slug": r["slug"], "name": r["name"], "n": int(r["n"])} for r in rows]


def _catalog_sql(category: str | None, brand: str | None, grade: str | None,
                 min_cents: int | None, max_cents: int | None, sort: str | None,
                 *, q: str | None = None) -> str:
    """The statement for one catalog page. Every filter is a bound parameter; none is ever text.

    Unfiltered this returns CATALOG_SELECT with both placeholders expanded to nothing - the
    statement this endpoint has always run, byte for byte. That is what the placeholders exist for:
    a filter may change which rows come back, never the shape of the query.

    `q` is keyword-only and last on purpose: the six filters before it are the ones this endpoint has
    always had, in the order its callers and its test have always passed them, and adding a term must
    not move them. It rides in the same WHERE as the category, which is what makes the term
    category-SCOPED: the two predicates are ANDed, so a term matching something outside the category
    cannot pull it in. `websearch_to_tsquery` is the function for raw shopper input - it is built to
    take whatever they type and never raises, which `to_tsquery` would.
    """
    where = _product_clauses(category, brand, q)
    unit = _unit_clauses(grade, min_cents, max_cents)
    return (CATALOG_SELECT.replace("%CAT%", " ".join(where)).replace("%UNIT%", unit)
            .replace(CATALOG_SORTS["featured"], CATALOG_SORTS.get(sort, CATALOG_SORTS["featured"])))


@router.get("/catalog")
async def catalog(limit: int = Query(24, le=100), offset: int = 0,
                  category: str | None = None, sort: str | None = None,
                  brand: str | None = None, grade: str | None = None, q: str | None = None,
                  min_cents: int | None = Query(None, ge=0, le=MAX_CENTS),
                  max_cents: int | None = Query(None, ge=0, le=MAX_CENTS),
                  with_filters: bool = False, db=Depends(get_db)):
    """Listed stock, optionally filtered by category, brand, unit grade, price band and a text term.

    The response is the same bare array it has always been unless `with_filters=1` asks for the
    envelope - the backoffice reads this endpoint as an array, and an unfiltered request has to stay
    byte-identical for it. With the envelope the caller also gets `applied` (the filter set as the
    SERVER resolved it, so a UI can show what is really in force rather than what it hoped) and
    `brands` (the chip row's live options).

    `q` searches the product's own vector (title + model, see migration 0007) and is ANDed with every
    other filter, so `?category=laptops&q=dock` can only ever return laptops - which is the whole
    point of it: the Shop menu's shortcuts are category + term, and a shortcut that leaked across
    categories would be worse than no shortcut.
    """
    category = (category or "").strip() or None
    brand = (brand or "").strip().lower() or None
    grade = (grade or "").strip().upper() or None
    q = (q or "").strip() or None
    if grade is not None and grade not in GRADES:
        raise HTTPException(status_code=422, detail="grade must be one of " + ", ".join(GRADES))
    if brand is not None and not BRAND_SLUG.fullmatch(brand):
        raise HTTPException(status_code=422, detail="brand must be a brand slug")
    if q is not None and len(q) > MAX_Q:
        # The only bound on the term: websearch_to_tsquery takes any syntax, so length is the one
        # thing this parameter can be abused with.
        raise HTTPException(status_code=422, detail="q must be at most " + str(MAX_Q) + " characters")
    if min_cents is not None and max_cents is not None and min_cents > max_cents:
        raise HTTPException(status_code=422, detail="min_cents must not be greater than max_cents")

    params: dict = {"lim": limit, "off": offset}
    if category:
        # The URL state writes the slug ("laptops"); this parameter has always taken the display
        # name ("Laptops"). Both name the same row, so a pasted URL works either way, and every
        # category's name is its slug capitalised, so nothing else can match.
        params["cat"] = category
    if brand:
        params["brand"] = brand
    if grade:
        params["grade"] = grade
    if q:
        params["q"] = q
    if min_cents is not None:
        params["min_cents"] = min_cents
    if max_cents is not None:
        params["max_cents"] = max_cents

    applied_sort = sort if sort in CATALOG_SORTS else "featured"
    sql_txt = _catalog_sql(category, brand, grade, min_cents, max_cents, applied_sort, q=q)
    rows = (await db.execute(text(sql_txt), params)).mappings().all()
    items = [{"id": r["id"], "public_id": r["public_id"], "slug": r["slug"], "title": r["title"],
              "model": r["model"], "brand": r["brand"], "category": r["category"], "specs": r["specs"],
              "image_url": r["image_url"], "featured": bool(r["featured"]),
              "units_available": int(r["units_available"]), "price_from_cents": int(r["price_from_cents"])}
             for r in rows]
    if not with_filters:
        return items
    return {"items": items,
            "applied": {"category": category, "brand": brand, "grade": grade, "q": q,
                        "min_cents": min_cents, "max_cents": max_cents, "sort": applied_sort},
            "brands": await _brand_facets(db, category=category, q=q, grade=grade,
                                          min_cents=min_cents, max_cents=max_cents)}

@router.get("/catalog/{slug}")
async def catalog_item(slug: str, db=Depends(get_db)):
    row = (await db.execute(text("""
        SELECT p.id, p.public_id::text AS public_id, p.slug, p.title, p.model, p.description,
               p.specs, p.image_url, b.name AS brand, c.name AS category
        FROM products p JOIN brands b ON b.id = p.brand_id JOIN categories c ON c.id = p.category_id
        WHERE p.slug = :s AND p.status = 'active'
    """), {"s": slug})).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="product not found")
    units = (await db.execute(text("""
        SELECT a.id, a.public_id::text AS public_id, a.grade, a.sale_price_cents,
               right(a.serial_number, 4) AS serial_tail
        FROM assets a JOIN lots l ON l.id = a.lot_id
        WHERE a.product_id = :p AND a.status = 'listed' AND l.status = 'active'
        """ + ON_SALE + """ORDER BY a.sale_price_cents
    """), {"p": row["id"]})).mappings().all()
    return {"id": row["id"], "public_id": row["public_id"], "slug": row["slug"], "title": row["title"],
            "model": row["model"], "description": row["description"], "specs": row["specs"],
            "image_url": row["image_url"], "brand": row["brand"], "category": row["category"],
            "units": [{"id": u["id"], "grade": u["grade"],
                       "sale_price_cents": int(u["sale_price_cents"]),
                       "serial_tail": u["serial_tail"]} for u in units]}


@router.get("/search")
async def search(q: str = Query(min_length=2), limit: int = Query(24, le=100), offset: int = 0, db=Depends(get_db)):
    rows = (await db.execute(text("""
        SELECT p.id, p.slug, p.title, p.model, b.name AS brand,
               count(a.id) AS units_available, min(a.sale_price_cents) AS price_from_cents
        FROM products p
        JOIN brands b ON b.id = p.brand_id
        LEFT JOIN assets a ON a.product_id = p.id AND a.status = 'listed'
                          AND EXISTS (SELECT 1 FROM lots l WHERE l.id = a.lot_id AND l.status = 'active')
                          """ + ON_SALE + """
        WHERE p.status = 'active' AND p.search_vec @@ websearch_to_tsquery('english', :q)
        GROUP BY p.id, p.slug, p.title, p.model, b.name
        ORDER BY p.title LIMIT :lim OFFSET :off
    """), {"q": q, "lim": limit, "off": offset})).mappings().all()
    return [{"id": r["id"], "slug": r["slug"], "title": r["title"], "model": r["model"],
             "brand": r["brand"], "units_available": int(r["units_available"]),
             "price_from_cents": (int(r["price_from_cents"]) if r["price_from_cents"] is not None else None)}
            for r in rows]


@router.get("/promotions")
async def promotions(db=Depends(get_db)):
    try:
        rows = (await db.execute(text("SELECT name, kind, value FROM promotions WHERE active = true"))).mappings().all()
    except Exception:
        return []
    return [{"name": r["name"], "kind": r["kind"], "value": int(r["value"])} for r in rows]


@router.get("/categories")
async def categories(db=Depends(get_db)):
    rows = (await db.execute(text("""
        SELECT c.name, count(p.id) AS n
        FROM categories c JOIN products p ON p.category_id = c.id
        WHERE p.status = 'active'
        GROUP BY c.name HAVING count(p.id) > 0
        ORDER BY c.name
    """))).mappings().all()
    return [{"name": r["name"], "n": int(r["n"])} for r in rows]


@router.get("/home-content")
async def home_content(db=Depends(get_db)):
    out = {"hero_title": "Renewed tech. Zero waste.",
           "hero_sub": "Certified refurbished devices - serialised, graded, warehouse-tracked.",
           "cta_label": "Shop devices"}
    try:
        row = (await db.execute(text("SELECT value FROM site_settings WHERE key = 'home'"))).first()
        if row is not None and row[0]:
            stored = dict(row[0])
            deal = stored.pop("deal_of_month", None)
            out.update(stored)
            slug = str((deal or {}).get("product_slug") or "").strip() if isinstance(deal, dict) else ""
            if slug:
                # INNER JOIN on purpose: the deal card may only publish when the product has at
                # least one listed asset in an active lot. A LEFT JOIN would still return the
                # product row (null price) for a stockless product and publish an empty card.
                # The margin floor rides in the same join, so a pinned product that has become a
                # loss-maker takes its card off the home page in exactly the same way - the pin is
                # a wish, and this join is what decides whether the shop can honour it.
                prod = (await db.execute(text("""
                    SELECT p.title, p.image_url, min(a.sale_price_cents) AS price_from_cents
                    FROM products p
                    JOIN assets a ON a.product_id = p.id AND a.status = 'listed'
                                 AND EXISTS (SELECT 1 FROM lots l WHERE l.id = a.lot_id AND l.status = 'active')
                                 """ + ON_SALE + """
                    WHERE p.slug = :s AND p.status = 'active'
                    GROUP BY p.title, p.image_url
                """), {"s": slug})).mappings().first()
                if prod is not None:
                    out["deal_of_month"] = {
                        "title": str(deal.get("title") or "").strip() or prod["title"],
                        "product_slug": slug,
                        "badge": str(deal.get("badge") or "").strip() or "Deal of the Month",
                        "image_url": prod["image_url"],
                        "price_from_cents": (int(prod["price_from_cents"])
                                             if prod["price_from_cents"] is not None else None)}
    except Exception:
        pass
    return out

@router.get("/best-sellers")
async def best_sellers(limit: int = Query(4, le=12), db=Depends(get_db)):
    rows = (await db.execute(text("""
        SELECT p.id, p.slug, p.title, p.model, b.name AS brand,
               sum(ol.qty) AS sold, min(a.sale_price_cents) AS price_from_cents
        FROM order_lines ol
        JOIN orders o ON o.id = ol.order_id AND o.status = 'paid'
        JOIN products p ON p.id = ol.product_id
        JOIN brands b ON b.id = p.brand_id
        LEFT JOIN assets a ON a.product_id = p.id AND a.status = 'listed' AND
               EXISTS (SELECT 1 FROM lots l WHERE l.id = a.lot_id AND l.status = 'active')
               """ + ON_SALE + """
        WHERE ol.product_id IS NOT NULL
        GROUP BY p.id, p.slug, p.title, p.model, b.name
        ORDER BY sold DESC
        LIMIT :lim"""), {"lim": limit})).mappings().all()


    return [{"id": r["id"], "slug": r["slug"], "title": r["title"], "model": r["model"],
             "brand": r["brand"], "sold": int(r["sold"]),
             "price_from_cents": (int(r["price_from_cents"]) if r["price_from_cents"] is not None else None)}
            for r in rows]