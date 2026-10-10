from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text

from app.core.db import get_db

router = APIRouter(prefix="/store", tags=["store-catalog"])

CATALOG_SELECT = """SELECT p.id, p.public_id::text AS public_id, p.slug, p.title, p.model,
       b.name AS brand, c.name AS category, p.specs, p.image_url, p.featured,
       count(a.id) AS units_available,
       min(a.sale_price_cents) AS price_from_cents
FROM products p
JOIN brands b ON b.id = p.brand_id
JOIN categories c ON c.id = p.category_id
LEFT JOIN assets a ON a.product_id = p.id AND a.status = 'listed'
                  AND EXISTS (SELECT 1 FROM lots l WHERE l.id = a.lot_id AND l.status = 'active')
WHERE p.status = 'active' %CAT%
GROUP BY p.id, p.public_id, p.slug, p.title, p.model, b.name, c.name, p.specs, p.image_url, p.featured
HAVING count(a.id) > 0
ORDER BY p.featured DESC, p.title
LIMIT :lim OFFSET :off"""


@router.get("/catalog")
async def catalog(limit: int = Query(24, le=100), offset: int = 0,
                  category: str | None = None, sort: str | None = None, db=Depends(get_db)):
    cat_clause = "AND c.name = :cat" if category else ""
    sql_txt = CATALOG_SELECT.replace("%CAT%", cat_clause)
    params = {"lim": limit, "off": offset}
    if category:
        params["cat"] = category
    if sort == "new":
        sql_txt = sql_txt.replace("ORDER BY p.featured DESC, p.title", "ORDER BY p.created_at DESC")
    sql = text(sql_txt)
    rows = (await db.execute(sql, params)).mappings().all()
    return [{"id": r["id"], "public_id": r["public_id"], "slug": r["slug"], "title": r["title"],
             "model": r["model"], "brand": r["brand"], "category": r["category"], "specs": r["specs"],
             "image_url": r["image_url"], "featured": bool(r["featured"]),
             "units_available": int(r["units_available"]), "price_from_cents": int(r["price_from_cents"])}
            for r in rows]

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
        ORDER BY a.sale_price_cents
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
            out.update(row[0])
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
        WHERE ol.product_id IS NOT NULL
        GROUP BY p.id, p.slug, p.title, p.model, b.name
        ORDER BY sold DESC
        LIMIT :lim"""), {}).mappings().all())


    return [{"id": r["id"], "slug": r["slug"], "title": r["title"], "model": r["model"],
             "brand": r["brand"], "sold": int(r["sold"]),
             "price_from_cents": (int(r["price_from_cents"]) if r["price_from_cents"] is not None else None)}
            for r in rows]