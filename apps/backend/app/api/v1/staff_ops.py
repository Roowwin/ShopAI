import re

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import selectinload

from app.api.v1.deps import require_roles
from app.core.db import get_db
from app.models import Asset, Lot, StockMovement
from app.models.catalog import Product
from app.services.audit import audit

router = APIRouter(prefix="/staff", tags=["staff-ops"])

# ---------------------------------------------------------------------------
# Role tuples: ONE source of truth for "which role may do X".
#
# The chat door (`staff_ai.py`) dispatches into the functions below as PLAIN FUNCTION CALLS, so
# the routes' `Depends(require_roles(...))` never evaluates on that path. Two consequences, both
# closed here and in the sibling file:
#   * `staff_ai.TOOL_ROLES` derives from these same constants instead of carrying its own
#     literals, so the chat allow-list cannot drift from the door it dispatches into.
#   * each handler re-checks its tuple in-body via `_require_role`, so the guard holds however
#     the function is invoked (the route's `Depends` stays as well - belt and braces, and it
#     preserves the 403 for the HTTP door).
# For these seven routes the IN-BODY guard is the authoritative one: `Depends` is the weaker twin,
# so editing only the route decorator is a dead edit (the body check runs regardless). Change both,
# from the one constant - do not "fix" the wrong one.
# Keep every set otherwise unchanged: these values ARE live authorization.
#
# ADR 0008 decision 9 adds a SECOND way past the in-body guard, for agent identities only: an
# enabled agent grant for the action the handler is performing. That branch is keyed on the
# ACTION constants below, which are the `staff_ai.TOOL_ROLES` keys - so the grantable set is closed
# to what the rail can actually dispatch (a handler passes its OWN action name; no caller supplies
# one), and `test_autonomy_execute.py` pins GUARDED_ACTIONS equal to TOOL_ROLES so a future action
# cannot be granted without a door behind it (or a door added without a name to grant).
# ---------------------------------------------------------------------------
ACTION_CREATE_LOT = "create_lot"
ACTION_ACTIVATE_LOT = "activate_lot"
ACTION_SCAN_IN = "scan_in"
ACTION_GRADE = "grade"
ACTION_PRICE = "price"
ACTION_MOVE = "move"
# One door serves two chat actions: received->tested is `test`, graded->listed is `list`, and
# `set_status` names them from the status it is actually writing (see `_STATUS_ACTIONS` below).
ACTION_TEST = "test"
ACTION_LIST = "list"
GUARDED_ACTIONS = frozenset((ACTION_CREATE_LOT, ACTION_ACTIVATE_LOT, ACTION_SCAN_IN, ACTION_GRADE,
                             ACTION_PRICE, ACTION_MOVE, ACTION_TEST, ACTION_LIST))
ROLES_CREATE_LOT = ("admin", "manager", "warehouse")
ROLES_ACTIVATE_LOT = ("admin", "manager")
ROLES_SCAN_IN = ("admin", "manager", "warehouse", "technician")
ROLES_GRADE = ("admin", "manager", "technician")
ROLES_MOVE = ("admin", "manager", "warehouse")
ROLES_PRICE = ("admin", "manager", "sales")
# The door behind the chat `test` (received->tested) and `list` (graded->listed) transitions.
# One tuple for both transitions, aligned DOWN to this endpoint's stricter set - the chat
# allow-list no longer grants `test` to technicians or `list` to sales.
ROLES_SET_STATUS = ("admin", "manager", "warehouse")


async def enabled_agent_grant(db, identity_id: int | None, action: str):
    """The ENABLED grant that authorises `action` for this AGENT identity, or None.

    identity_type is the literal 'agent' and not a parameter: an agent execution may only ever be
    authorised by an agent grant (ADR 0008 decision 9), so a staff grant cannot reach this branch
    even if one exists. A staff grant additionally may only be created for an action the role
    already permits, which is why the role path below is untouched - a grant never widens a tuple.

    `action` is always one of the GUARDED_ACTIONS names: it is a handler's own name for what it is
    about to do, never anything client-supplied. Callers check that closure before calling.
    """
    if identity_id is None:
        return None
    return (await db.execute(text(
        "SELECT id, action_class, daily_cap FROM autonomy_grants"
        " WHERE identity_type = 'agent' AND identity_id = :i AND action = :a AND enabled"),
        {"i": identity_id, "a": action})).mappings().first()


async def _require_role(staff: dict, roles: tuple[str, ...], action: str, db=None):
    """In-body twin of the route's ``Depends(require_roles(*roles))``, widened per ADR 0008 d.9.

    `staff_ai.chat` calls these handlers as plain functions, which skips every FastAPI
    dependency, so the guard has to live in the body however the function is reached. Two ways
    past it, and only two:

    * the ROLE permits it - the staff rail, unchanged, and the only branch a staff identity or a
      hand-built dict can take (the grant branch is skipped outright for `identity_type != 'agent'`,
      before any database access); or
    * the identity is an AGENT and an enabled agent grant exists for `action`. Never a role: the
      delegated agent role is one no tuple admits, and that is the point.

    Returns the authorising grant row (None on the role path) so the caller can write
    `meta.autonomy` from the row that actually authorised the write, instead of re-reading
    anything. The refusal is byte-identical to `deps.require_roles`' - an identity with no grant
    and an identity with the wrong role are indistinguishable from outside.

    Deliberately async and session-taking: the grant lookup is the only reason, and a caller with
    no session (a plain call from a test, a future non-request dispatch) is refused rather than
    trusted.
    """
    if staff["role"] in roles:
        return None
    if staff.get("identity_type") != "agent" or db is None or action not in GUARDED_ACTIONS:
        raise HTTPException(status_code=403, detail="insufficient role")
    grant = await enabled_agent_grant(db, staff.get("identity_id"), action)
    if grant is None:
        raise HTTPException(status_code=403, detail="insufficient role")
    return grant


def _audit_actor(staff: dict) -> tuple[str, int]:
    """(actor_type, actor_id) for the mutation audit row this identity's execution writes.

    A staff turn is ('staff', staff_users.id) exactly as before. An agent execution is 'agent'
    (ADR 0008 decision 5) and its actor_id is the AGENT's own id, not the sponsor's: the overview
    reads `actor_type = 'staff'` precisely because actor_id is a staff_users id only for staff
    rows, and filing an autonomous publish under the sponsoring admin's id is the misattribution
    ADR 0008 exists to make visible. Note `stock_movements.actor_staff_id` is NOT changed - it is
    a foreign key to staff_users, so it keeps the sponsor there; the ledger entry that identifies
    the acting identity is this audit row, plus `meta.autonomy`.
    """
    if staff.get("identity_type") == "agent":
        return "agent", staff["identity_id"]
    return "staff", staff["id"]


async def _audit_execution(db, staff: dict, grant, *, entity: str, action: str,
                           entity_id: int | None = None, before: dict | None = None,
                           after: dict | None = None, meta: dict | None = None) -> None:
    """The audit row for a write this identity performed, for the seven guarded handlers.

    Same row as a human execution, with the actor class taken from the identity context and, when
    an agent grant authorised it, `meta.autonomy = {grant_id, identity}` (ADR 0008 decision 5).
    The grant comes from the guard that just ran, so the id recorded is the id that authorised -
    there is no request field anywhere in this path for a client to forge an autonomy mark with.
    """
    actor_type, actor_id = _audit_actor(staff)
    if grant is not None:
        meta = {**(meta or {}),
                "autonomy": {"grant_id": grant["id"], "identity": staff.get("identity_name")}}
    await audit(db, actor_type, entity=entity, action=action, entity_id=entity_id,
                actor_id=actor_id, before=before, after=after, meta=meta)


class LotIn(BaseModel):
    lot_number: str | None = None
    warehouse: str | None = None
    notes: str | None = None

class ScanIn(BaseModel):
    serial_number: str
    lot_id: int | None = None
    lot_number: str | None = None
    product_id: int | None = None
    imei: str | None = None
    notes: str | None = None

class GradeIn(BaseModel):
    grade: str
    cost_cents: int | None = None
    condition_report: dict | None = None
    # Opt-in, and only meaningful for a unit that has not been tested yet: see the ladder note in
    # `grade`. Default False keeps every existing caller's behaviour byte-identical.
    test_first: bool = False

class StatusIn(BaseModel):
    status: str
    note: str | None = None

class MoveIn(BaseModel):
    location: str


def _409(e: Exception) -> None:
    """409 for a commit the database refused.

    Always called AFTER `await db.rollback()`, and never after our own commit of a write that
    stands - which is what makes a 409 (like this file's 403/404/422) a failure the autonomy rail
    can refund a cap for: it provably wrote nothing. See `staff_ai._NOTHING_WRITTEN`.
    """
    orig = getattr(e, "orig", None)
    msg = str(orig).replace("\n", " ")[:200] if orig is not None else str(e)[:200]
    raise HTTPException(status_code=409, detail=msg)


async def _gen_lot_number(db) -> str:
    res = await db.execute(text("SELECT 'LOT-' || to_char(now(),'YYYY') || '-' || lpad(nextval('lot_number_seq')::text, 5, '0')"))
    return res.scalar_one()


@router.post("/lots", status_code=201)
async def create_lot(body: LotIn, staff: dict = Depends(require_roles(*ROLES_CREATE_LOT)), db=Depends(get_db)):
    grant = await _require_role(staff, ROLES_CREATE_LOT, ACTION_CREATE_LOT, db)
    ln = body.lot_number or await _gen_lot_number(db)
    lot = Lot(lot_number=ln, status="intake", warehouse=body.warehouse, notes=body.notes)
    db.add(lot)
    await _audit_execution(db, staff, grant, entity="lot", action="lot_create",
                           meta={"lot_number": ln})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"id": lot.id, "lot_number": lot.lot_number, "status": lot.status}


@router.post("/lots/{lot_id}/activate")
async def activate_lot(lot_id: int, staff: dict = Depends(require_roles(*ROLES_ACTIVATE_LOT)), db=Depends(get_db)):
    grant = await _require_role(staff, ROLES_ACTIVATE_LOT, ACTION_ACTIVATE_LOT, db)
    lot = await db.get(Lot, lot_id)
    if lot is None:
        raise HTTPException(status_code=404, detail="lot not found")
    before = {"status": lot.status}
    lot.status = "active"
    await _audit_execution(db, staff, grant, entity="lot", entity_id=lot.id, action="lot_activate",
                           before=before, after={"status": "active"})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"id": lot.id, "status": lot.status}


@router.post("/assets/scan-in", status_code=201)
async def scan_in(body: ScanIn, staff: dict = Depends(require_roles(*ROLES_SCAN_IN)), db=Depends(get_db)):
    grant = await _require_role(staff, ROLES_SCAN_IN, ACTION_SCAN_IN, db)
    if (body.lot_id is None) == (body.lot_number is None):
        raise HTTPException(status_code=422, detail="provide exactly one of lot_id / lot_number")
    lot = (await db.execute(select(Lot).where(Lot.id == body.lot_id) if body.lot_id
                            else select(Lot).where(Lot.lot_number == body.lot_number))).scalars().first()
    if lot is None:
        raise HTTPException(status_code=404, detail="lot not found")
    asset = Asset(serial_number=body.serial_number, imei=body.imei, product_id=body.product_id,
                  notes=body.notes, status="received", lot_id=lot.id)
    db.add(asset)
    try:
        await db.flush()
        db.add(StockMovement(asset_id=asset.id, qty=1, reason="intake_scan", actor_staff_id=staff["id"]))
        await _audit_execution(db, staff, grant, entity="asset", entity_id=asset.id, action="scan_in",
                               after={"serial": body.serial_number, "lot": lot.lot_number})
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"id": asset.id, "public_id": str(asset.public_id), "serial_number": asset.serial_number,
            "lot_number": lot.lot_number, "status": asset.status}


@router.post("/assets/{asset_id}/grade")
async def grade(asset_id: int, body: GradeIn, staff: dict = Depends(require_roles(*ROLES_GRADE)), db=Depends(get_db)):
    grant = await _require_role(staff, ROLES_GRADE, ACTION_GRADE, db)
    asset = await db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")
    before = {"status": asset.status, "grade": asset.grade}

    # THE LADDER IS REAL. The DB trigger (`rfo_assets_check_status`) admits `tested -> graded` and
    # refuses `received -> graded`, so a unit that has never been tested cannot be graded in one
    # move - the constraint is the domain model saying a unit is inspected before it is graded.
    #
    # A workbench that grades a whole fresh lot would otherwise 409 on every row. `test_first` walks
    # the one rung the ladder requires, and writes that rung its OWN audit row, so the trail shows
    # the path the unit really took instead of a jump it never made.
    #
    # This widens no permission. It is available only to a role-holder acting on its own behalf -
    # `_require_role` already admitted them for `ACTION_GRADE` - and the unit never RESTS in
    # `tested`: the same request continues to `graded`, so the write cannot be used to park a unit
    # in a state the caller's role could not otherwise produce. An AGENT is refused outright: for
    # an agent the `test` transition is a separately grantable, separately audited action, so it
    # must be taken explicitly rather than as a side effect of a `grade` grant.
    stepped = False
    if body.test_first and asset.status == "received":
        if staff.get("identity_type") == "agent":
            raise HTTPException(status_code=403,
                                detail="an agent identity must test a unit before grading it")
        asset.status = "tested"
        await db.flush()   # its own UPDATE, so the trigger sees received -> tested, not -> graded
        await _audit_execution(db, staff, grant, entity="asset", entity_id=asset.id, action="test",
                               before={"status": "received"},
                               after={"status": "tested", "note": "step of grading an untested unit"})
        stepped = True

    asset.status = "graded"
    asset.grade = body.grade
    if body.cost_cents is not None:
        asset.cost_cents = body.cost_cents
    if body.condition_report is not None:
        asset.condition_report = body.condition_report
    await _audit_execution(db, staff, grant, entity="asset", entity_id=asset.id, action="grade",
                           before=before, after={"status": "graded", "grade": body.grade})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"id": asset.id, "status": asset.status, "grade": asset.grade, "stepped_through_tested": stepped}


# The chat actions this one door performs, named by the status it is asked to write. A status that
# is not here (any hand-made call, or a transition the rail does not carry) names no action, so the
# agent branch of `_require_role` has nothing to look a grant up against and refuses: the grantable
# set stays closed to the actions the rail actually dispatches.
_STATUS_ACTIONS = {"tested": ACTION_TEST, "listed": ACTION_LIST}


@router.post("/assets/{asset_id}/status")
async def set_status(asset_id: int, body: StatusIn, staff: dict = Depends(require_roles(*ROLES_SET_STATUS)), db=Depends(get_db)):
    grant = await _require_role(staff, ROLES_SET_STATUS, _STATUS_ACTIONS.get(body.status, ""), db)
    if body.status == "graded":
        raise HTTPException(status_code=422, detail="use /grade to enter graded state")
    asset = await db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")
    before = {"status": asset.status}
    asset.status = body.status
    await _audit_execution(db, staff, grant, entity="asset", entity_id=asset.id, action="status",
                           before=before, after={"status": body.status, "note": body.note})
    try:
        await db.commit()   # trigger enforces legal transitions; lot auto-complete/reopen fires here
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"id": asset.id, "status": asset.status}


@router.post("/assets/{asset_id}/move")
async def move(asset_id: int, body: MoveIn, staff: dict = Depends(require_roles(*ROLES_MOVE)), db=Depends(get_db)):
    grant = await _require_role(staff, ROLES_MOVE, ACTION_MOVE, db)
    asset = await db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")
    before = {"location": asset.location}
    asset.location = body.location
    await _audit_execution(db, staff, grant, entity="asset", entity_id=asset.id, action="move",
                           before=before, after={"location": body.location})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"id": asset.id, "location": asset.location}


# Read walls: lot numbers, serials, grades and storage locations are inventory intelligence, so
# these reads take the same guard as the sibling staff reads (the CMS and newsletter ones) instead
# of being open to everyone. Before job 8 a customer bearer - or no credential at all - answered
# 200 with the inventory.
@router.get("/lots")
async def list_lots(limit: int = Query(20, le=100), offset: int = 0,
                    staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
    rows = (await db.execute(select(Lot).options(selectinload(Lot.assets))
                             .order_by(Lot.id.desc()).limit(limit).offset(offset))).scalars().all()
    return [{"id": l.id, "lot_number": l.lot_number, "status": l.status,
             "warehouse": l.warehouse, "asset_count": len(l.assets)} for l in rows]


@router.get("/assets")
async def list_assets(status: str | None = None, lot_number: str | None = None,
                      product_id: int | None = None, limit: int = Query(20, le=100), offset: int = 0,
                      staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
    q = select(Asset).options(selectinload(Asset.lot))
    if status:
        q = q.where(Asset.status == status)
    if lot_number:
        q = q.where(Asset.lot.has(Lot.lot_number == lot_number))
    if product_id:
        q = q.where(Asset.product_id == product_id)
    rows = (await db.execute(q.order_by(Asset.id.desc()).limit(limit).offset(offset))).scalars().all()
    return [{"id": a.id, "public_id": str(a.public_id), "serial_number": a.serial_number,
             "status": a.status, "grade": a.grade, "lot_number": a.lot.lot_number} for a in rows]


# How many awaiting-grade units the workbench returns at once. A corporate lot runs to a few
# hundred; beyond this the payload says it was cut rather than silently showing a prefix.
WORKLIST_MAX = 500
# The statuses a unit can be graded FROM. `rfo_assets_check_status` admits tested/graded and
# in_repair/graded, and `received` gets there through the one rung `grade(test_first=True)` walks.
# A null-graded unit sitting in `scrapped` or `sold` is not awaiting anything, so listing it with
# grade buttons would only offer an action that 409s.
_AWAITING_GRADE_STATUSES = ("received", "tested", "in_repair")


@router.get("/lots/worklist")
async def lot_worklist(lot_number: str | None = None, lot_id: int | None = None,
                       staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
    """One lot's grading progress plus the units still awaiting a grade.

    The Lot Process workbench's read. Progress counts EVERY unit in the lot - "3 of 10 units
    graded" has to mean the lot, not the slice on screen - while `assets` carries only the ones
    still to do. A lot is addressed by number (what the operator has) or by id (what a link has),
    never by both, so an ambiguous call is a 422 rather than a guess.
    """
    if (lot_id is None) == (lot_number is None):
        raise HTTPException(status_code=422, detail="provide exactly one of lot_id / lot_number")
    lot = (await db.execute(select(Lot).where(Lot.id == lot_id) if lot_id is not None
                            else select(Lot).where(Lot.lot_number == lot_number))).scalars().first()
    if lot is None:
        raise HTTPException(status_code=404, detail="lot not found")

    counts = (await db.execute(text("""
        SELECT count(*) AS total,
               count(*) FILTER (WHERE grade IS NOT NULL) AS graded,
               count(*) FILTER (WHERE grade IS NULL
                                  AND status IN ('received','tested','in_repair')) AS awaiting
        FROM assets WHERE lot_id = :i
    """), {"i": lot.id})).mappings().one()

    # One row over the cap, so "was it cut?" is answered by the data rather than by `len == cap`.
    rows = (await db.execute(text("""
        SELECT a.id, a.public_id::text AS public_id, a.serial_number::text AS serial_number,
               a.status, a.grade, a.product_id, p.title AS product_title
        FROM assets a LEFT JOIN products p ON p.id = a.product_id
        WHERE a.lot_id = :i AND a.grade IS NULL
          AND a.status IN ('received','tested','in_repair')
        ORDER BY a.id LIMIT :lim
    """), {"i": lot.id, "lim": WORKLIST_MAX + 1})).mappings().all()
    truncated = len(rows) > WORKLIST_MAX
    rows = rows[:WORKLIST_MAX]

    return {
        "lot": {"id": lot.id, "lot_number": lot.lot_number, "status": lot.status,
                "warehouse": lot.warehouse, "received_at": lot.received_at.isoformat()},
        "progress": {"total_units": int(counts["total"]), "graded_units": int(counts["graded"]),
                     "awaiting_grade_units": int(counts["awaiting"])},
        "assets": [{"id": r["id"], "public_id": r["public_id"], "serial_number": r["serial_number"],
                    "status": r["status"], "grade": r["grade"], "product_id": r["product_id"],
                    "product_title": r["product_title"]} for r in rows],
        "truncated": truncated,
        "limit": WORKLIST_MAX,
    }


@router.get("/movements")
async def list_movements(asset_id: int | None = None, limit: int = Query(50, le=200), offset: int = 0,
                         staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
    q = select(StockMovement).order_by(StockMovement.id.desc()).limit(limit).offset(offset)
    if asset_id:
        q = q.where(StockMovement.asset_id == asset_id)
    rows = (await db.execute(q)).scalars().all()
    return [{"id": m.id, "moved_at": m.moved_at.isoformat(), "asset_id": m.asset_id,
             "qty": m.qty, "reason": m.reason, "actor_staff_id": m.actor_staff_id} for m in rows]
class PriceIn(BaseModel):
    sale_price_cents: int = Field(ge=0)


@router.post("/assets/{asset_id}/price")
async def set_price(asset_id: int, body: PriceIn, staff: dict = Depends(require_roles(*ROLES_PRICE)), db=Depends(get_db)):
    grant = await _require_role(staff, ROLES_PRICE, ACTION_PRICE, db)
    asset = await db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")
    before = {"sale_price_cents": asset.sale_price_cents}
    asset.sale_price_cents = body.sale_price_cents
    await _audit_execution(db, staff, grant, entity="asset", entity_id=asset.id, action="price",
                           before=before, after={"sale_price_cents": body.sale_price_cents})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"id": asset.id, "sale_price_cents": asset.sale_price_cents}
# ------------- Promotion guards (ADR 0008 Precondition 4) -------------
# Every handler below was route-`Depends`-only, and the ADR's own premise is that a plain-function
# dispatch skips `Depends` entirely - so none of them had the in-body twin the seven railway doors
# carry, and promoting one into the rail later would have needed it first. It is here now, for all
# six, ahead of any promotion: cms_put_home, cms_edit_product, approve_listing and create_product
# were the four the ADR names, and cms_add_promotion / cms_edit_promotion were found by sweeping
# this file for the same shape (a write reachable without the role check).
#
# These are ROLE-ONLY paths, and that is structural rather than stated: none of the action names
# below is in GUARDED_ACTIONS, so `_require_role`'s grant branch refuses an agent identity before it
# looks anything up - a grant can never authorise a path the rail cannot dispatch. `None` is passed
# for the session on purpose: this guard must not be able to reach a grant row even by accident.
#
# The role tuples are constants used by BOTH the decorator and the body, so the two cannot drift
# apart - which is the rule the header of this file sets for the seven railway doors, applied here
# from the start rather than after the fact. Keep every set otherwise unchanged: these ARE live
# authorization.
ROLES_APPROVE_LISTING = ("admin", "manager", "sales")
ROLES_CMS = ("admin", "manager")
ROLES_CREATE_PRODUCT = ("admin", "manager")
ACTION_APPROVE_LISTING = "approve_listing"
ACTION_CMS_PUT_HOME = "cms_put_home"
ACTION_CMS_ADD_PROMOTION = "cms_add_promotion"
ACTION_CMS_EDIT_PROMOTION = "cms_edit_promotion"
ACTION_CMS_EDIT_PRODUCT = "cms_edit_product"
ACTION_CREATE_PRODUCT = "create_product"


class ProductListingIn(BaseModel):
    title: str = Field(max_length=140)
    description: str = Field(max_length=4000)


@router.post("/products/{product_id}/listing")
async def approve_listing(product_id: int, body: ProductListingIn,
                          staff: dict = Depends(require_roles(*ROLES_APPROVE_LISTING)),
                          db=Depends(get_db)):
    await _require_role(staff, ROLES_APPROVE_LISTING, ACTION_APPROVE_LISTING, None)
    prod = await db.get(Product, product_id)
    if prod is None:
        raise HTTPException(status_code=404, detail="product not found")
    before = {"title": prod.title, "description": prod.description}
    prod.title = body.title
    prod.description = body.description
    await audit(db, "staff", entity="product", entity_id=prod.id, action="listing_approved",
                actor_id=staff["id"], before=before, after={"title": body.title})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"id": prod.id, "title": prod.title, "description": prod.description}


# ------------- CMS: website content / offers / featured products -------------
import json
from datetime import datetime, timedelta, timezone

HOME_DEFAULTS = {"hero_title": "Renewed tech. Zero waste.",
                 "hero_sub": "Certified refurbished devices - serialised, graded, warehouse-tracked.",
                 "cta_label": "Shop devices"}

DEAL_BADGE = "Deal of the Month"


def _clean_deal_of_month(raw):
    """Normalise the CMS deal_of_month record; None when unset/blank (block off)."""
    if not isinstance(raw, dict):
        return None
    slug = str(raw.get("product_slug") or "").strip()
    if not slug:
        return None
    return {"title": str(raw.get("title") or "").strip()[:140],
            "product_slug": slug[:140],
            "badge": str(raw.get("badge") or "").strip()[:40] or DEAL_BADGE}


@router.get("/cms/home")
async def cms_get_home(staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
    row = (await db.execute(text("SELECT value FROM site_settings WHERE key = 'home'"))).first()
    out = dict(HOME_DEFAULTS)
    if row is not None:
        out.update(row[0])
    if _clean_deal_of_month(out.get("deal_of_month")) is None:
        out.pop("deal_of_month", None)
    return out


@router.put("/cms/home")
async def cms_put_home(body: dict, staff: dict = Depends(require_roles(*ROLES_CMS)), db=Depends(get_db)):
    await _require_role(staff, ROLES_CMS, ACTION_CMS_PUT_HOME, None)
    val = {"hero_title": str(body.get("hero_title") or HOME_DEFAULTS["hero_title"])[:120],
           "hero_sub": str(body.get("hero_sub") or HOME_DEFAULTS["hero_sub"])[:240],
           "cta_label": str(body.get("cta_label") or HOME_DEFAULTS["cta_label"])[:40]}
    deal = _clean_deal_of_month(body.get("deal_of_month"))
    if deal is not None:
        val["deal_of_month"] = deal
    await db.execute(text("INSERT INTO site_settings (key, value) VALUES ('home', CAST(:v AS jsonb)) ON CONFLICT (key) DO UPDATE SET value = CAST(:v AS jsonb), updated_at = now()"), {"v": json.dumps(val)})
    await db.commit()
    await audit(db, "staff", entity="cms", action="home_updated", actor_id=staff["id"], after=val)
    await db.commit()
    return val


@router.get("/cms/promotions")
async def cms_list_promotions(staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
    rows = (await db.execute(text("SELECT id, name, kind, value, active, starts_at, ends_at FROM promotions ORDER BY id DESC"))).mappings().all()
    return [{"id": r["id"], "name": r["name"], "kind": r["kind"], "value": int(r["value"] or 0),
             "active": bool(r["active"]), "starts_at": r["starts_at"].isoformat(), "ends_at": r["ends_at"].isoformat()} for r in rows]


@router.post("/cms/promotions")
async def cms_add_promotion(body: dict, staff: dict = Depends(require_roles(*ROLES_CMS)), db=Depends(get_db)):
    await _require_role(staff, ROLES_CMS, ACTION_CMS_ADD_PROMOTION, None)
    name = str(body.get("name") or "New offer")[:80]
    kind = body.get("kind") or "percent"
    if kind not in ("percent", "fixed"):
        raise HTTPException(status_code=422, detail="kind must be percent or fixed")
    value = int(body.get("value") or 0)
    if value <= 0 or (kind == "percent" and value > 90):
        raise HTTPException(status_code=422, detail="value out of range")
    row = (await db.execute(text("INSERT INTO promotions (name, kind, value, active, starts_at, ends_at) VALUES (:n, :k, :v, true, now(), now() + INTERVAL '30 days') RETURNING id"), {"n": name, "k": kind, "v": value})).first()
    await db.commit()
    await audit(db, "staff", entity="promotion", action="created", entity_id=row[0], actor_id=staff["id"], after={"name": name})
    await db.commit()
    return {"id": row[0], "name": name, "kind": kind, "value": value, "active": True}


@router.patch("/cms/promotions/{pid}")
async def cms_edit_promotion(pid: int, body: dict, staff: dict = Depends(require_roles(*ROLES_CMS)), db=Depends(get_db)):
    await _require_role(staff, ROLES_CMS, ACTION_CMS_EDIT_PROMOTION, None)
    changed = {}
    for k in ("name", "kind", "value", "active"):
        if k in body:
            changed[k] = body[k]
            if k == "name":
                await db.execute(text("UPDATE promotions SET name = :v WHERE id = :i"), {"v": str(body[k])[:80], "i": pid})
            elif k == "kind":
                if str(body[k]) not in ("percent", "fixed"):
                    raise HTTPException(status_code=422, detail="bad kind")
                await db.execute(text("UPDATE promotions SET kind = :v WHERE id = :i"), {"v": str(body[k]), "i": pid})
            elif k == "value":
                await db.execute(text("UPDATE promotions SET value = :v WHERE id = :i"), {"v": int(body[k]), "i": pid})
            else:
                await db.execute(text("UPDATE promotions SET active = :v WHERE id = :i"), {"v": bool(body[k]), "i": pid})
    await db.commit()
    await audit(db, "staff", entity="promotion", action="edited", entity_id=pid, actor_id=staff["id"], after=changed)
    await db.commit()
    return {"ok": True, "changed": changed}


@router.get("/cms/products")
async def cms_list_products(staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
    rows = (await db.execute(text("""
        SELECT p.id, p.title, p.slug, p.image_url, p.featured, c.name AS category,
               count(a.id) FILTER (WHERE a.status = 'listed') AS units
        FROM products p JOIN categories c ON c.id = p.category_id
        LEFT JOIN assets a ON a.product_id = p.id
        GROUP BY p.id, p.title, p.slug, p.image_url, p.featured, c.name
        ORDER BY p.featured DESC, p.title"""))).mappings().all()
    return [{"id": r["id"], "title": r["title"], "slug": r["slug"], "category": r["category"],
             "image_url": r["image_url"], "featured": bool(r["featured"]), "listed_units": int(r["units"])} for r in rows]


@router.patch("/cms/products/{pid}")
async def cms_edit_product(pid: int, body: dict, staff: dict = Depends(require_roles(*ROLES_CMS)), db=Depends(get_db)):
    await _require_role(staff, ROLES_CMS, ACTION_CMS_EDIT_PRODUCT, None)
    upd = []
    params: dict = {"i": pid}
    if "image_url" in body:
        img = str(body["image_url"]).strip()
        upd.append("image_url = :img")
        params["img"] = (img or None)
    if "featured" in body:
        upd.append("featured = :feat")
        params["feat"] = bool(body["featured"])
    if "title" in body:
        upd.append("title = :t")
        params["t"] = str(body["title"])[:140]
    if "description" in body:
        upd.append("description = :d")
        params["d"] = str(body["description"])[:4000]
    if not upd:
        raise HTTPException(status_code=422, detail="nothing to update")
    await db.execute(text("UPDATE products SET " + ", ".join(upd) + ", updated_at = now() WHERE id = :i"), params)
    await db.commit()
    await audit(db, "staff", entity="cms", action="product_updated", entity_id=pid, actor_id=staff["id"], after={k: str(body[k])[:60] for k in body})
    await db.commit()
    return {"ok": True}


# ------------- Newsletter: public signups, admin read-only list -------------
@router.get("/newsletter")
async def newsletter_list(limit: int = Query(100, le=500), offset: int = 0,
                          staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
    total = (await db.execute(text("SELECT count(*) FROM newsletter_subscribers"))).scalar_one()
    rows = (await db.execute(text("""
        SELECT email, created_at FROM newsletter_subscribers
        ORDER BY created_at DESC, id DESC LIMIT :lim OFFSET :off
    """), {"lim": limit, "off": offset})).mappings().all()
    return {"total": int(total),
            "subscribers": [{"email": r["email"], "created_at": r["created_at"].isoformat()} for r in rows]}


# ------------- Catalog: create a product (used by the demo seeder) -------------
def _slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")[:160]


class ProductIn(BaseModel):
    brand_slug: str = Field(min_length=1, max_length=80)
    category_slug: str = Field(min_length=1, max_length=80)
    model: str = Field(min_length=1, max_length=140)
    title: str = Field(min_length=1, max_length=160)
    slug: str | None = Field(default=None, max_length=160)
    description: str = Field(default="", max_length=4000)
    specs: dict = Field(default_factory=dict)


def _product_json(row) -> dict:
    return {"id": row["id"], "public_id": row["public_id"], "brand_id": row["brand_id"],
            "category_id": row["category_id"], "model": row["model"], "title": row["title"],
            "slug": row["slug"], "description": row["description"], "specs": row["specs"],
            "status": row["status"], "created_at": row["created_at"].isoformat()}


@router.post("/products", status_code=201)
async def create_product(body: ProductIn, staff: dict = Depends(require_roles(*ROLES_CREATE_PRODUCT)), db=Depends(get_db)):
    await _require_role(staff, ROLES_CREATE_PRODUCT, ACTION_CREATE_PRODUCT, None)
    brand_id = (await db.execute(text("SELECT id FROM brands WHERE slug = :s"),
                                {"s": body.brand_slug})).scalar_one_or_none()
    if brand_id is None:
        raise HTTPException(status_code=422, detail="unknown brand slug")
    category_id = (await db.execute(text("SELECT id FROM categories WHERE slug = :s"),
                                    {"s": body.category_slug})).scalar_one_or_none()
    if category_id is None:
        raise HTTPException(status_code=422, detail="unknown category slug")
    slug = (body.slug or "").strip() or _slugify(body.title)
    if not slug:
        raise HTTPException(status_code=422, detail="slug required (not derivable from title)")
    try:
        # status 'active': a product only reaches the storefront once it has listed stock in an
        # active lot (the catalog query requires it), so going live here cannot publish an
        # empty product - it just lets the intake flow that follows surface it.
        row = (await db.execute(text("""
            INSERT INTO products (brand_id, category_id, model, title, slug, description, specs, status)
            VALUES (:b, :c, :m, :t, :s, :d, CAST(:sp AS jsonb), 'active')
            RETURNING id, public_id::text AS public_id, brand_id, category_id, model, title, slug,
                      description, specs, status, created_at
        """), {"b": brand_id, "c": category_id, "m": body.model, "t": body.title, "s": slug,
               "d": body.description, "sp": json.dumps(body.specs)})).mappings().one()
        await audit(db, "staff", entity="product", entity_id=row["id"], action="product_create",
                    actor_id=staff["id"], after={"slug": slug, "title": body.title})
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="slug already exists")
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return _product_json(row)