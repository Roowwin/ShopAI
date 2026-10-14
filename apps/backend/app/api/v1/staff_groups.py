"""Product groups: one image and one hand-set price per brand + model + grade, and the door that

puts them on the shop floor.

WHY THIS EXISTS, in one sentence: an imported lot arrives with a price on every unit, and the units
of one model+grade do not agree - a box of five identical Grade A keyboards came in at $307.05,
$320.60, $269.21, $53.72 and $242.55. Deciding "what is a Grade A 125 Wired USB Keyboard worth, and
what does it look like" is a decision about the GROUP, made once, and every lot that ever contains
one inherits it. 0024 carries the table; this file is the only thing that writes it.

PRICE IS SET BY HAND AND NOTHING AUTO-APPLIES. `product_groups.price_override` is written only by
`PATCH /staff/product-groups/{id}`, from a number a person typed into a box. FMV, Resale and
"FMV + 60%" are suggestions this file COMPUTES AND RETURNS (see `_aggregates`) for the screen to
pre-fill with; none of them is written anywhere by any door here. That is not caution for its own
sake - the FMV column averages $71.44 on this data while Resale averages $732.62, so a rule that
auto-applied either would be a 90% price cut or nothing at all, decided by nobody.

PUBLISH READS `price_override` AND REFUSES WHEN IT IS NULL. There is no fallback to the unit's own
price, because a group the operator has not priced is a group nobody has made a decision about, and
silently publishing five different prices under one grade is the exact state this feature exists to
end.

WHAT PUBLISH ACTUALLY DOES, and why it is four statements rather than one:

 1. Writes the group's price onto every unit of that model+grade in every lot. `assets.sale_price_cents`
    is what the shop reads and what `chk_listed_has_price` (0006) checks, so the group price has to
    land there before anything can be listed.
 2. WALKS THE LADDER, one rung per statement. `rfo_assets_check_status` refuses `received -> graded`,
    so a single `UPDATE ... SET status='listed'` would be rejected row by row; each rung is its own
    statement so the trigger sees `received -> tested`, then `tested -> graded`, then `graded -> listed`.
    This is the same discipline `grade(test_first=True)` follows for one unit, done set-based for a lot.
 3. ACTIVATES THE LOTS. This is not housekeeping: imported lots are created `status='intake'`, the lot
    trigger (0003) only ever flips `active <-> completed`, and the shop requires `l.status='active'`.
    Without this step a "successful" publish shows nothing at all, which is the worst possible outcome
    because it looks like it worked.
 4. POINTS THE MODEL'S CARD AT THE GROUP PHOTO. `products.image_url` is what a catalogue tile renders;
    it is set only where it is empty or still a shipped `/icons/` placeholder, and only if no better
    grade of the same model already has a real photo - so a Grade D upload cannot displace the Grade A
    shot on the card. The per-grade photographs themselves ride to the product page through
    `store_catalog.catalog_item`, not through this column.

AGENTS ARE REFUSED. `_require_role` is called with an empty action name, so the ADR 0008 grant branch
has nothing to look up and an agent identity cannot reach any door in this file. The rail's granular
actions are per unit (`price`, `list`); this door is a composite that writes a price onto every unit
of a group AND walks three transitions AND activates a lot, and granting it under any one of those
names would hand an agent more than the grant says. A human role is unaffected.
"""

import json

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api.v1.deps import require_roles
from app.api.v1.staff_ops import _409, _audit_actor, _audit_execution, _require_role
from app.core.db import get_db
from app.services.media import MediaRefused, public_address, read_for_upload, store_upload
from app.services.pricing import TARGET_MARKUP_PCT

router = APIRouter(prefix="/staff", tags=["staff-product-groups"])

# Same tuple the CMS and the asset media doors use. A group is a shop-facing configuration record -
# a photo the public sees and the price they pay - so it sits with those doors rather than with the
# warehouse ones.
ROLES_GROUPS = ("admin", "manager")

PRICE_SOURCES = ("fmv", "resale", "custom")

# How many groups one bulk request may name. The screen's own button names NONE - it publishes
# everything set up - so this bound only shapes the by-selection path, and it exists so that one
# press cannot become an unbounded number of statements in a single transaction.
MAX_BULK_IDS = 500

# The three states the screen filters by, as SQL over the GROUP alone - never over its unit counts,
# because a filter that depends on an aggregate cannot be pushed into the WHERE of a paginated read
# without counting every group in the database first.
#
# `needs_setup` is "no price OR no photo", which is the operator's actual to-do list. `ready` is
# priced and photographed but not yet published; `live` has a `storefront_id`, which 0024 mints at
# first publish and which is the ONLY marker of "already in the shop" this schema has.
STATE_SQL = {
    "needs_setup": "(g.price_override IS NULL OR g.image_url IS NULL)",
    "ready": "(g.price_override IS NOT NULL AND g.image_url IS NOT NULL AND g.published_at IS NULL)",
    "live": "(g.published_at IS NOT NULL)",
}

GROUP_SELECT = """
    SELECT g.id, g.brand_id, b.name AS brand, b.slug AS brand_slug, g.model, g.grade,
           g.storefront_id::text AS storefront_id, g.product_id, g.media_id, g.image_url,
           g.price_override, g.price_source, g.published_at,
           count(a.id) AS units_total,
           count(a.id) FILTER (WHERE a.status = 'listed') AS units_listed,
           -- The dearest cost basis in the group, so the screen can say "at this price N units sell
           -- below what they cost" before anybody presses Save. COALESCE, not cost_cents alone:
           -- services/margin.py:28 defines the basis as cost when known and settlement otherwise.
           max(COALESCE(a.cost_cents, a.settlement_cents)) AS basis_max,
           count(DISTINCT a.fmv_cents) AS fmv_variants
    FROM product_groups g
    JOIN brands b ON b.id = g.brand_id
    -- A LEFT JOIN twice over, because a group is a decision that may have been taken before any
    -- stock of it arrived: `product_groups` can legitimately have zero units today.
    LEFT JOIN products p ON p.brand_id = g.brand_id AND lower(p.model) = lower(g.model)
    LEFT JOIN assets a ON a.product_id = p.id AND a.grade = g.grade
"""

# The units a group speaks for: every unit of that brand+model and grade, in ANY lot, under ANY of
# the product rows a category re-spelling may have minted. This is the join that makes "the same
# image and the same price for that product according to its grade" true across lots.
UNITS_OF_GROUP = """
    FROM assets a JOIN products p ON p.id = a.product_id
    WHERE p.brand_id = :b AND lower(p.model) = lower(:m) AND a.grade = :g
"""


def _row(r) -> dict:
    """One group row as the screen reads it, with the state derived rather than stored."""
    if r["published_at"] is not None:
        state = "live"
    elif r["price_override"] is not None and r["image_url"] is not None:
        state = "ready"
    else:
        state = "needs_setup"
    return {
        "id": r["id"], "brand": r["brand"], "brand_slug": r["brand_slug"],
        "model": r["model"], "grade": r["grade"], "state": state,
        "storefront_id": r["storefront_id"], "product_id": r["product_id"],
        "media_id": r["media_id"], "image_url": r["image_url"],
        "price_override": r["price_override"], "price_source": r["price_source"],
        "published_at": r["published_at"].isoformat() if r["published_at"] else None,
        "units_total": int(r["units_total"]), "units_listed": int(r["units_listed"]),
        "basis_max": r["basis_max"], "fmv_variants": int(r["fmv_variants"]),
        # The warning the screen shows beside Save. It is a COUNT of units that would be hidden, not
        # a refusal: the shop's own ON_SALE predicate (services/margin.py:60) hides a unit priced
        # below its basis, and hiding is a legitimate choice - it is the silence that would not be.
        "below_cost_if_priced_here": (r["price_override"] is not None
                                      and r["basis_max"] is not None
                                      and r["price_override"] < r["basis_max"]),
    }


@router.get("/product-groups")
async def list_product_groups(state: str | None = None, q: str | None = None,
                              limit: int = Query(50, le=200), offset: int = 0,
                              staff: dict = Depends(require_roles(*ROLES_GROUPS)), db=Depends(get_db)):
    """The group worklist: what is set up, what is priced but not published, and what is live."""
    await _require_role(staff, ROLES_GROUPS, "", db)
    where = ["true"]
    params: dict = {"lim": limit, "off": offset}
    if state:
        if state not in STATE_SQL:
            raise HTTPException(status_code=422,
                                detail="state must be one of: " + ", ".join(sorted(STATE_SQL)))
        where.append(STATE_SQL[state])
    if q and q.strip():
        where.append("(lower(b.name) || ' ' || lower(g.model)) LIKE :like")
        params["like"] = "%" + q.strip().lower() + "%"
    # Fragments come from STATE_SQL (constants) and the two clauses above; no caller text is ever
    # spliced - the search term rides as a bound parameter.
    rows = (await db.execute(text(
        GROUP_SELECT + " WHERE " + " AND ".join(where) +
        " GROUP BY g.id, b.name, b.slug ORDER BY b.name, g.model, g.grade, g.id LIMIT :lim OFFSET :off"
    ), params)).mappings().all()
    return [_row(r) for r in rows]


@router.get("/product-groups/{group_id}")
async def get_product_group(group_id: int, staff: dict = Depends(require_roles(*ROLES_GROUPS)),
                            db=Depends(get_db)):
    """One group, its unit counts, and the four numbers each quick-fill button needs.

    The aggregates are returned RAW and unsaved. Every one of them is a suggestion the operator may
    overrule, which is why the door computes them on read instead of storing them: a stored
    suggestion is a second price for the screen to disagree with `price_override` about.

    `variants` says how many DISTINCT values the group holds, because it is the answer to "why is
    there an aggregate selector here at all" - 284 of the 295 groups on this data have more than one
    distinct FMV, so the median is not decoration.
    """
    await _require_role(staff, ROLES_GROUPS, "", db)
    row = (await db.execute(text(GROUP_SELECT + " WHERE g.id = :id GROUP BY g.id, b.name, b.slug"),
                            {"id": group_id})).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="product group not found")
    agg = (await db.execute(text("""
        SELECT count(a.id) AS units_total,
               count(a.id) FILTER (WHERE a.status = 'listed') AS units_listed,
               count(a.id) FILTER (WHERE a.status IN ('received','tested','graded')) AS units_publishable,
               min(a.fmv_cents) AS fmv_min, max(a.fmv_cents) AS fmv_max,
               round(avg(a.fmv_cents))::bigint AS fmv_avg,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY a.fmv_cents)::bigint AS fmv_median,
               min(a.sale_price_cents) AS resale_min, max(a.sale_price_cents) AS resale_max,
               round(avg(a.sale_price_cents))::bigint AS resale_avg,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY a.sale_price_cents)::bigint AS resale_median,
               min(COALESCE(a.cost_cents, a.settlement_cents)) AS basis_min,
               max(COALESCE(a.cost_cents, a.settlement_cents)) AS basis_max,
               count(DISTINCT a.fmv_cents) AS fmv_variants,
               count(DISTINCT a.sale_price_cents) AS resale_variants
    """ + UNITS_OF_GROUP), {"b": row["brand_id"], "m": row["model"], "g": row["grade"]})).mappings().one()
    out = _row(row)
    out["aggregates"] = {
        "units_total": int(agg["units_total"]), "units_listed": int(agg["units_listed"]),
        "units_publishable": int(agg["units_publishable"]),
        "fmv": {"min": agg["fmv_min"], "max": agg["fmv_max"], "avg": agg["fmv_avg"],
                "median": agg["fmv_median"], "variants": int(agg["fmv_variants"])},
        "resale": {"min": agg["resale_min"], "max": agg["resale_max"], "avg": agg["resale_avg"],
                   "median": agg["resale_median"], "variants": int(agg["resale_variants"])},
        "basis": {"min": agg["basis_min"], "max": agg["basis_max"]},
        # The markup the FMV + N% button applies, printed from the same constant the rest of the
        # platform prices with (services/pricing.py) rather than retyped into a button label.
        "target_markup_pct": TARGET_MARKUP_PCT,
    }
    return out


class GroupPatchIn(BaseModel):
    # Nullable so a price can be TAKEN BACK, but presence is what matters: the handler reads
    # `model_fields_set`, exactly as `GradeIn` does one file over, so a body that omits the field
    # leaves it alone while an explicit null clears it. The two are very different requests.
    price_override: int | None = None
    price_source: str | None = None


@router.patch("/product-groups/{group_id}")
async def patch_product_group(group_id: int, body: GroupPatchIn,
                              staff: dict = Depends(require_roles(*ROLES_GROUPS)), db=Depends(get_db)):
    """Set (or clear) the hand-entered price for one group. THE ONLY WRITE OF `price_override`.

    No door computes this value. The screen may fill the box from FMV, from Resale or from
    FMV + 60%, but the number that arrives here is one a person put in the box and then confirmed -
    which is why `price_source` is stored beside it. The source is a note the operator may overrule,
    and it defaults to 'custom' when a price arrives without one, so an unlabelled hand-typed price
    is never mistaken for an imported one.
    """
    await _require_role(staff, ROLES_GROUPS, "", db)
    group = (await db.execute(text(
        "SELECT id, brand_id, model, grade, price_override, price_source "
        "FROM product_groups WHERE id = :i"),
        {"i": group_id})).mappings().first()
    if group is None:
        raise HTTPException(status_code=404, detail="product group not found")

    sets: list[str] = []
    params: dict = {"i": group_id}
    if "price_override" in body.model_fields_set:
        if body.price_override is None:
            # Clearing the price clears its label with it: a source that outlives the number it
            # described is a claim about nothing.
            sets += ["price_override = NULL", "price_source = NULL"]
        else:
            if body.price_override < 0:
                raise HTTPException(status_code=422, detail="a price cannot be negative")
            source = (body.price_source or "custom").strip().lower()
            if source not in PRICE_SOURCES:
                raise HTTPException(status_code=422,
                                    detail="price_source must be one of: " + ", ".join(PRICE_SOURCES))
            sets.append("price_override = :p")
            sets.append("price_source = :s")
            params["p"] = body.price_override
            params["s"] = source
    elif "price_source" in body.model_fields_set:
        source = (body.price_source or "custom").strip().lower()
        if source not in PRICE_SOURCES:
            raise HTTPException(status_code=422,
                                detail="price_source must be one of: " + ", ".join(PRICE_SOURCES))
        sets.append("price_source = :s")
        params["s"] = source
    if not sets:
        raise HTTPException(status_code=422, detail="nothing to update")

    before = {"price_override": group["price_override"], "price_source": group["price_source"]}
    await db.execute(text("UPDATE product_groups SET " + ", ".join(sets) + " WHERE id = :i"), params)
    await _audit_execution(db, staff, None, entity="product_group", entity_id=group_id,
                           action="group_price_set",
                           before=before,
                           after={"price_override": body.price_override
                                  if "price_override" in body.model_fields_set else before["price_override"],
                                  "price_source": params.get("s", before["price_source"])})
    # How many units of this group the shop would HIDE at the price just saved. Answered here rather
    # than left to the screen because it depends on every unit's own cost basis, and the screen has
    # only the aggregate. It is a number the operator sees next to the field they just filled in.
    # `CAST(:p AS bigint)` and not a bare `:p`, and not `:p::bigint`: asyncpg infers a parameter's
    # type from the Describe, and a parameter compared against a NULL-or-value test has nothing to
    # infer FROM - it fails at execution with AmbiguousParameterError rather than at import time.
    hidden = (await db.execute(text(
        "SELECT count(*) " + UNITS_OF_GROUP +
        "  AND COALESCE(a.cost_cents, a.settlement_cents) IS NOT NULL "
        "  AND CAST(:p AS bigint) IS NOT NULL "
        "  AND CAST(:p AS bigint) < COALESCE(a.cost_cents, a.settlement_cents)"),
        {"b": group["brand_id"], "m": group["model"], "g": group["grade"],
         "p": params.get("p")})).scalar_one()
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"id": group_id, "price_override": params.get("p", before["price_override"]),
            "price_source": params.get("s", before["price_source"]),
            "units_below_cost": int(hidden)}


@router.post("/product-groups/{group_id}/image", status_code=201)
async def upload_group_image(group_id: int, file: UploadFile = File(...),
                             staff: dict = Depends(require_roles(*ROLES_GROUPS)), db=Depends(get_db)):
    """Attach the ONE photograph a model+grade shows, on every lot that holds one.

    Attaching it here IS the "apply it to the whole model" action - the group is what every lot of
    that model+grade already shares, so there is no second step and no per-asset assignment rows to
    write. That is the difference between this door and `apply-to-model`: that one copies an
    assignment onto N units, this one writes the single row N units are read through.

    A second upload REPLACES the first rather than accumulating: a group has one photo, and 0024's
    `media_id` is a single column precisely so that "which one is it" has one answer. The replaced
    file is left in `media_objects` - it may still be an asset photograph, and a row this door cannot
    see the other readers of is not one it may delete.
    """
    await _require_role(staff, ROLES_GROUPS, "", db)
    group = (await db.execute(text(
        "SELECT id, model, grade, media_id, image_url FROM product_groups WHERE id = :i"),
        {"i": group_id})).mappings().first()
    if group is None:
        raise HTTPException(status_code=404, detail="product group not found")

    try:
        blob = await read_for_upload(file)
        media = await store_upload(db, filename=file.filename, content_type=file.content_type,
                                   blob=blob, uploaded_by=staff["id"])
    except MediaRefused as refusal:
        await db.rollback()
        # 413 for the cap and 422 for everything else, matching the hub's own two answers so the
        # same rejection reads the same way wherever an operator meets it.
        status = 413 if "5 MB" in str(refusal) else 422
        raise HTTPException(status_code=status, detail=str(refusal))

    address = public_address(media["public_id"])
    await db.execute(text("""
        UPDATE product_groups SET media_id = :m, image_url = :u WHERE id = :i
    """), {"m": media["id"], "u": address, "i": group_id})
    await _audit_execution(db, staff, None, entity="product_group", entity_id=group_id,
                           action="group_image_set",
                           before={"media_id": group["media_id"], "image_url": group["image_url"]},
                           after={"media_id": media["id"], "image_url": address,
                                  "filename": media["filename"], "byte_size": media["byte_size"]})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"id": group_id, "media_id": media["id"], "image_url": address,
            "filename": media["filename"], "content_type": media["content_type"],
            "byte_size": media["byte_size"]}


@router.get("/product-groups/{group_id}/image/raw")
async def get_group_image_raw(group_id: int, staff: dict = Depends(require_roles(*ROLES_GROUPS)),
                              db=Depends(get_db)):
    """The bytes of one group's photograph, so the screen can PREVIEW what it is about to publish.

    The shop fetches these same bytes from `/store/media/{public_id}` - public, on the shop's own
    origin, because a catalogue `<img>` carries no credential. THIS door is the backoffice's, and it
    exists because the admin host is a DIFFERENT origin from the shop: `/media/...` resolves against
    whatever host the page is on, so the admin screen would ask admin.<domain> for a path only the
    shop serves and get a 404 that looks exactly like a missing photo.

    Auth through the same bearer door as the page that renders it, for the same reason ImageHub
    fetches its thumbnails into blob URLs: a staff token is a header no `<img src>` can carry.
    """
    await _require_role(staff, ROLES_GROUPS, "", db)
    row = (await db.execute(text("""
        SELECT mo.content_type, mo.bytes
        FROM product_groups g JOIN media_objects mo ON mo.id = g.media_id
        WHERE g.id = :i
    """), {"i": group_id})).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="this group has no photograph")
    return Response(content=bytes(row["bytes"]), media_type=row["content_type"],
                    headers={"X-Content-Type-Options": "nosniff",
                             "Cache-Control": "private, max-age=300"})


async def _publish_group(db, staff: dict, group) -> dict:
    """Publish ONE group. Must be called inside the caller's transaction; never commits.

    See the module docstring for what each of the four statements is for and why they cannot be one.
    The refusal when `price_override` is null is the door's whole contract: a group nobody has priced
    is a group nobody has decided about.
    """
    if group["price_override"] is None:
        raise HTTPException(
            status_code=409,
            detail=f"set a price for {group['model']} / grade {group['grade']} before publishing")

    keys = {"b": group["brand_id"], "m": group["model"], "g": group["grade"]}
    price = group["price_override"]

    # What is about to change, counted BEFORE any of it changes. `skipped` is not a failure: a unit
    # already on the shop floor has a price and a status and this door is not here to overrule them.
    before_counts = (await db.execute(text("""
        SELECT count(*) FILTER (WHERE a.status IN ('received','tested','graded')) AS publishable,
               count(*) FILTER (WHERE a.status = 'listed') AS already_listed
    """ + UNITS_OF_GROUP), keys)).mappings().one()
    publishable = int(before_counts["publishable"])

    # 1. THE PRICE. Written onto every unit first, so `chk_listed_has_price` cannot fire on the walk
    #    below and so the shelf and the group cannot disagree for even one statement.
    await db.execute(text(
        "UPDATE assets a SET sale_price_cents = :p FROM products p "
        "WHERE p.id = a.product_id AND p.brand_id = :b AND lower(p.model) = lower(:m) "
        "  AND a.grade = :g AND a.status IN ('received','tested','graded')"),
        {**keys, "p": price})

    # The trail, written from the state the units were actually in. It goes in BEFORE the walk
    # because the walk destroys the answer to "where did this unit come from", and because the whole
    # publish is one transaction - a failure later rolls this back with everything else rather than
    # leaving a claim about a write that did not happen.
    actor_type, actor_id = _audit_actor(staff)
    await db.execute(text("""
        INSERT INTO audit_log (actor_type, actor_id, entity, entity_id, action, before, after, meta)
        SELECT CAST(:at AS text), CAST(:aid AS bigint), 'asset', a.id, 'publish',
               jsonb_build_object('status', a.status, 'grade', a.grade,
                                  'sale_price_cents', a.sale_price_cents),
               jsonb_build_object('status', 'listed', 'sale_price_cents', CAST(:p AS bigint),
                                  'group_id', CAST(:gid AS bigint),
                                  'storefront_id', CAST(:sid AS text)),
               CAST(:meta AS jsonb)
        """ + UNITS_OF_GROUP + " AND a.status IN ('received','tested','graded')"),
        {**keys, "at": actor_type, "aid": actor_id, "p": price, "gid": group["id"],
         "sid": group["storefront_id"], "meta": _publish_meta(group)})

    # 2. THE LADDER, one rung per statement. Three statements, because `rfo_assets_check_status`
    #    refuses a two-rung jump and fires per row inside each of them.
    for frm, to in (("received", "tested"), ("tested", "graded"), ("graded", "listed")):
        await db.execute(text(
            "UPDATE assets a SET status = :to FROM products p "
            "WHERE p.id = a.product_id AND p.brand_id = :b AND lower(p.model) = lower(:m) "
            "  AND a.grade = :g AND a.status = :frm"), {**keys, "frm": frm, "to": to})

    # 3. THE LOTS. See the module docstring: an imported lot is `intake`, and the shop shows nothing
    #    from an inactive lot, so the publish is what makes the work visible at all.
    lots = await db.execute(text(
        "UPDATE lots SET status = 'active' WHERE status = 'intake' AND id IN ("
        "  SELECT DISTINCT a.lot_id FROM assets a JOIN products p ON p.id = a.product_id "
        "  WHERE p.brand_id = :b AND lower(p.model) = lower(:m) AND a.grade = :g AND a.status = 'listed')"),
        keys)
    lots_activated = lots.rowcount or 0

    # 4. THE CARD'S PHOTO. Only where there is nothing real yet, and only if no better grade of the
    #    same model already has one. `p.image_url LIKE '/icons/%'` is the shipped placeholder - the
    #    same test `seed_demo` uses to tell "already pointed at its glyph" from "not yet".
    if group["image_url"]:
        await db.execute(text(
            "UPDATE products p SET image_url = :u "
            "WHERE p.brand_id = :b AND lower(p.model) = lower(:m) "
            "  AND (p.image_url IS NULL OR p.image_url LIKE '/icons/%') "
            "  AND NOT EXISTS (SELECT 1 FROM product_groups g2 "
            "                  WHERE g2.brand_id = p.brand_id AND lower(g2.model) = lower(p.model) "
            "                    AND g2.image_url IS NOT NULL AND g2.grade < CAST(:g AS text))"),
            {**keys, "u": group["image_url"]})

    # The group's own state: `storefront_id` is minted HERE and nowhere else, which is what makes a
    # later import's "is this model+grade already set up?" a question with an answer.
    product_id = (await db.execute(text(
        "SELECT id FROM products WHERE brand_id = :b AND lower(model) = lower(:m) ORDER BY id LIMIT 1"),
        keys)).scalar_one_or_none()
    storefront_id = (await db.execute(text("""
        UPDATE product_groups
        SET storefront_id = COALESCE(storefront_id, gen_random_uuid()),
            published_at = now(), product_id = :pid
        WHERE id = :gid
        RETURNING storefront_id::text AS storefront_id
    """), {"pid": product_id, "gid": group["id"]})).scalar_one()

    # What the shop will HIDE at this price. `ON_SALE` (services/margin.py:60) drops a unit priced
    # below its basis, so counting it here is the difference between "240 listed" and "240 listed,
    # 12 of which the shop will not show".
    hidden = (await db.execute(text(
        "SELECT count(*) " + UNITS_OF_GROUP +
        "  AND a.status = 'listed' AND COALESCE(a.cost_cents, a.settlement_cents) IS NOT NULL "
        "  AND a.sale_price_cents < COALESCE(a.cost_cents, a.settlement_cents)"), keys)).scalar_one()

    return {
        "group_id": group["id"], "brand": group["brand"], "model": group["model"],
        "grade": group["grade"], "storefront_id": storefront_id, "product_id": product_id,
        "listed": publishable, "skipped_already_listed": int(before_counts["already_listed"]),
        "hidden_below_cost": int(hidden), "lots_activated": lots_activated,
        "has_image": group["image_url"] is not None,
    }


def _publish_meta(group) -> str:
    """The `meta` jsonb for a publish audit row, as a JSON string for the CAST above."""
    return json.dumps({"group_id": group["id"], "model": group["model"], "grade": group["grade"],
                        "price_override": group["price_override"],
                        "storefront_id": group["storefront_id"]})


async def _load_group(db, group_id: int):
    return (await db.execute(text("""
        SELECT g.id, g.brand_id, b.name AS brand, g.model, g.grade, g.storefront_id::text AS storefront_id,
               g.image_url, g.price_override
        FROM product_groups g JOIN brands b ON b.id = g.brand_id WHERE g.id = :i
    """), {"i": group_id})).mappings().first()


@router.post("/product-groups/{group_id}/publish")
async def publish_group(group_id: int, staff: dict = Depends(require_roles(*ROLES_GROUPS)),
                        db=Depends(get_db)):
    """Publish one model+grade: price, walk the ladder, activate the lots, point the card at the photo."""
    await _require_role(staff, ROLES_GROUPS, "", db)
    group = await _load_group(db, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="product group not found")
    result = await _publish_group(db, staff, group)
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return result


class BulkPublishIn(BaseModel):
    # Empty/absent means "everything I have set up". The screen's "Publish remaining lots" button
    # sends no ids at all: the groups it wants are exactly those a re-import did not have to ask
    # about, and naming them client-side would be the screen re-deriving a fact the server owns.
    ids: list[int] | None = None
    # Restrict to groups already in the shop - `storefront_id IS NOT NULL`. This is the
    # "publish REMAINING lots" case: the image and the price were given on an earlier import and
    # nothing should ask for them again.
    only_published: bool = False


@router.post("/product-groups/publish")
async def publish_groups(body: BulkPublishIn, staff: dict = Depends(require_roles(*ROLES_GROUPS)),
                         db=Depends(get_db)):
    """Publish many groups in ONE transaction, and report every group held back and why.

    Held back rather than refused: an unpriced group is the normal state of a model that arrived on
    this morning's sheet, and a button that failed the whole run over it would make "publish
    remaining lots" unusable exactly when it is most wanted. The reply names them so nothing is
    silently dropped.
    """
    await _require_role(staff, ROLES_GROUPS, "", db)
    where = ["true"]
    params: dict = {}
    if body.ids is not None:
        if not body.ids:
            raise HTTPException(status_code=422, detail="ids was empty - omit it to publish everything set up")
        if len(body.ids) > MAX_BULK_IDS:
            raise HTTPException(status_code=422,
                                detail=f"at most {MAX_BULK_IDS} groups per request - omit ids to publish everything set up")
        # Placeholders generated from `range(len(ids))`, never from the caller's text, and the values
        # ride as bound parameters. A list parameter (`= ANY(:ids)`) is what this shape avoids: the
        # rest of this API binds scalars, and a list has no column to infer its element type from.
        ids = [int(i) for i in body.ids]
        where.append("g.id IN (" + ", ".join(f":i{n}" for n in range(len(ids))) + ")")
        params.update({f"i{n}": v for n, v in enumerate(ids)})
    if body.only_published:
        where.append("g.storefront_id IS NOT NULL")
    rows = (await db.execute(text("""
        SELECT g.id, g.brand_id, b.name AS brand, g.model, g.grade,
               g.storefront_id::text AS storefront_id, g.image_url, g.price_override
        FROM product_groups g JOIN brands b ON b.id = g.brand_id
        WHERE """ + " AND ".join(where) + " ORDER BY g.id"), params)).mappings().all()

    results, skipped, without_image = [], [], []
    for row in rows:
        if row["price_override"] is None:
            skipped.append({"id": row["id"], "brand": row["brand"], "model": row["model"],
                            "grade": row["grade"], "reason": "no price set"})
            continue
        result = await _publish_group(db, staff, row)
        results.append(result)
        if not result["has_image"]:
            without_image.append({"id": row["id"], "brand": row["brand"], "model": row["model"],
                                  "grade": row["grade"]})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)

    return {
        "groups": results,
        "skipped": skipped,
        "without_image": without_image,
        "totals": {
            "groups_published": len(results),
            "units_listed": sum(r["listed"] for r in results),
            "units_skipped_already_listed": sum(r["skipped_already_listed"] for r in results),
            "units_hidden_below_cost": sum(r["hidden_below_cost"] for r in results),
            "groups_skipped": len(skipped),
        },
    }
