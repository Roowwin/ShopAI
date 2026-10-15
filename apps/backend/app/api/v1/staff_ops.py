import re

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import selectinload

from app.api.v1.deps import require_roles
from app.core.db import get_db
from app.models import Asset, Lot, StockMovement
from app.models.catalog import Brand, Product
from app.services.audit import audit
from app.services.margin import margin_refusal
# The one definition of what an upload may be. Re-exported (see GRADE_TEMPLATE_GRADES below) because
# this module is where `store_returns` has always imported them from.
from app.services.media import (IMAGE_MAX_BYTES, IMAGE_TYPES, MediaRefused,  # noqa: F401 (re-export)
                                read_for_upload, safe_filename as _safe_filename, store_upload)

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
    # Nullable so a grade can be TAKEN BACK, but the field must be PRESENT either way: the handler
    # reads `model_fields_set` and refuses a body that simply omits it. That keeps the old contract
    # (a caller that forgets the grade is refused) while letting an explicit null clear it - the
    # two are very different requests and must not collapse into one.
    grade: str | None = None
    cost_cents: int | None = None
    condition_report: dict | None = None
    # Opt-in, and only meaningful for a unit that has not been tested yet: see the ladder note in
    # `grade`. Default False keeps every existing caller's behaviour byte-identical.
    test_first: bool = False

class NotesIn(BaseModel):
    """A description edit. Null or blank clears the description rather than storing empty text."""
    notes: str | None = None

class UpgradeDescIn(BaseModel):
    """An upgrade-description edit. Blank clears it rather than storing empty text, exactly as
    NotesIn does - "no description" gets one representation, not two."""
    upgrade_desc: str | None = None

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
    if "grade" not in body.model_fields_set:
        raise HTTPException(status_code=422, detail="grade is required (send null to clear it)")
    if body.grade is not None:
        body.grade = body.grade.strip().upper()
        if body.grade not in ("A", "B", "C", "D"):
            raise HTTPException(status_code=422, detail="grade must be one of A, B, C, D, or null")
    asset = await db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")
    before = {"status": asset.status, "grade": asset.grade}

    # TAKING A GRADE BACK. A null grade is a correction, not a demotion: the unit has been found
    # to need another look, so it drops out of the graded set and back into the queue - which is
    # exactly what "reappears in Unfinished" means (that view is `grade IS NULL`).
    #
    # The STATUS is deliberately left where it is. The trigger has no `graded -> tested` edge, so
    # there is no legal demotion to write; inventing one here would be this handler pretending to
    # a transition the domain does not have. The unit therefore reads `graded` with no grade until
    # it is graded again, and `ready_for_pricing` (status graded AND a grade present) correctly
    # drops to false in the same breath. The workbench labels that state rather than hiding it.
    if body.grade is None:
        asset.grade = None
        await _audit_execution(db, staff, grant, entity="asset", entity_id=asset.id, action="grade",
                               before=before, after={"status": asset.status, "grade": None,
                                                     "note": "grade cleared"})
        try:
            await db.commit()
        except SQLAlchemyError as e:
            await db.rollback(); _409(e)
        return {"id": asset.id, "status": asset.status, "grade": None, "stepped_through_tested": False}

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


# Who may correct a unit's description. The same people who may grade it: the description is the
# note the grader writes about what they found, so splitting the two would let one role write a
# finding it could not act on. Deliberately NOT in GUARDED_ACTIONS / TOOL_ROLES - this is an HTTP
# door the chat rail does not dispatch into, so it passes `db=None` and an agent identity is
# refused rather than admitted through a grant for an action the rail cannot run.
ROLES_EDIT_NOTES = ("admin", "manager", "technician")
ACTION_EDIT_NOTES = "edit_notes"


@router.post("/assets/{asset_id}/notes")
async def edit_notes(asset_id: int, body: NotesIn, staff: dict = Depends(require_roles(*ROLES_EDIT_NOTES)), db=Depends(get_db)):
    """Correct the unit's description - the merged Audit/Cosmetic/Functional note the import wrote.

    The before/after pair is the point of this door existing at all: a description that can be
    edited without a trail is a description nobody can be held to, and the grader's note is
    evidence about a unit that will be sold. Blank clears it rather than storing an empty string,
    so "no description" has one representation instead of two.
    """
    await _require_role(staff, ROLES_EDIT_NOTES, ACTION_EDIT_NOTES, None)
    asset = await db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")
    before = {"notes": asset.notes}
    cleaned = (body.notes or "").strip()
    asset.notes = cleaned or None
    await _audit_execution(db, staff, None, entity="asset", entity_id=asset.id, action="edit_notes",
                           before=before, after={"notes": asset.notes})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"id": asset.id, "notes": asset.notes}


# The unit's upgrade description: what was fitted or replaced, as the supplier's workbook recorded
# it, and the one free-text field on the record a technician is asked to correct on the bench.
#
# THE ROLE SET IS MIRRORED FROM `edit_notes`, NOT INVENTED. Nowhere in this repo states who may edit
# an upgrade description, and the closest thing is the field beside it - both are descriptive text
# about the same unit, both are filled by the same import, and the person who may write the finding
# ("the screen was replaced") is the person who knows what was fitted. If the owner wants a narrower
# set, this constant is the one line to change.
#
# Not in GUARDED_ACTIONS / TOOL_ROLES, for edit_notes' own reason: this is an HTTP door the chat rail
# does not dispatch into, so it passes db=None and an agent identity is refused rather than admitted
# through a grant for an action the rail cannot run.
ROLES_EDIT_UPGRADE = ("admin", "manager", "technician")
ACTION_EDIT_UPGRADE = "edit_upgrade_desc"


@router.post("/assets/{asset_id}/upgrade")
async def edit_upgrade_desc(asset_id: int, body: UpgradeDescIn,
                            staff: dict = Depends(require_roles(*ROLES_EDIT_UPGRADE)), db=Depends(get_db)):
    """Correct the unit's upgrade description.

    The before/after pair is the point of the door existing, exactly as on the notes door: a
    description that can be edited without a trail is a description nobody can be held to, and it is
    printed on the condition report a buyer reads.
    """
    await _require_role(staff, ROLES_EDIT_UPGRADE, ACTION_EDIT_UPGRADE, None)
    asset = await db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")
    before = {"upgrade_desc": asset.upgrade_desc}
    cleaned = (body.upgrade_desc or "").strip()
    asset.upgrade_desc = cleaned or None
    await _audit_execution(db, staff, None, entity="asset", entity_id=asset.id,
                           action=ACTION_EDIT_UPGRADE, before=before,
                           after={"upgrade_desc": asset.upgrade_desc})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"id": asset.id, "upgrade_desc": asset.upgrade_desc}


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
    # MARGIN GUARD (staff layer). Listing is the moment a unit becomes purchasable, so this is where
    # a loss-maker is stopped: the shop hides one anyway (store_catalog), but a unit that can never
    # be sold at a profit must not be walked into `listed` in the first place.
    if body.status == "listed":
        refusal = margin_refusal(asset.sale_price_cents, asset.cost_cents, asset.settlement_cents)
        if refusal:
            raise HTTPException(status_code=422, detail=refusal)
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
             "warehouse": l.warehouse, "load_id": l.load_id, "account": l.account, "zone": l.zone,
             "asset_count": len(l.assets)} for l in rows]


# THE INVENTORY READ, described ONCE so the list, its total and every facet are built from the same
# clauses. This is `store_catalog._product_clauses`' rule applied one layer down: a facet computed
# from a different description of the filters than the list is a facet that quietly disagrees with
# it, and the disagreement surfaces as a filter count that does not match what the filter returns.
#
# The joins are LEFT except for `lots`, which is INNER because `assets.lot_id` is NOT NULL: a unit
# without a product is still a unit and must not drop out, but a unit without a lot cannot exist.
ASSET_FROM = """
    FROM assets a
    LEFT JOIN products p ON p.id = a.product_id
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN categories c ON c.id = p.category_id
    JOIN lots l ON l.id = a.lot_id
"""

ASSET_SELECT = """
    SELECT a.id, a.public_id::text AS public_id, a.serial_number, a.status, a.grade,
           a.sale_price_cents, a.intake_at, a.location, a.pallet, a.sku, a.asset,
           a.channel, a.on_shelf,
           p.model, p.title, b.name AS brand, c.name AS category,
           l.lot_number, l.warehouse, l.zone
"""

# The sort keys a caller may ask for, as literal ORDER BY fragments. A dict rather than a pass-through
# string because this one IS spliced into the statement - it is the only caller-supplied text that
# is, and a key not in here falls back to the default instead of reaching the database.
ASSET_SORTS = {
    "newest": "a.id DESC",
    "oldest": "a.id ASC",
    "price_high": "a.sale_price_cents DESC NULLS LAST, a.id DESC",
    "price_low": "a.sale_price_cents ASC NULLS LAST, a.id DESC",
    "serial": "a.serial_number ASC NULLS LAST, a.id DESC",
}

# Which filter each facet is built from, so a facet can exclude its OWN filter and no other. A facet
# that filtered itself would collapse to the value already chosen and leave the operator no way to
# switch - the rule `store_catalog` states for its brand facet. The column names are literals here
# rather than parameters: an identifier cannot be bound, so it must never come from a caller.
FACET_COLUMNS = {
    "statuses": "a.status",
    "grades": "a.grade",
    "categories": "c.name",
    "brands": "b.name",
    "warehouses": "l.warehouse",
}
FACET_OWN_FILTER = {
    "statuses": "status",
    "grades": "grade",
    "categories": "category",
    "brands": "brand",
    "warehouses": "warehouse",
}


def _asset_clauses(*, status=None, lot_number=None, product_id=None, group_id=None, q=None,
                   category=None, brand=None, grade=None, warehouse=None) -> tuple[list[str], dict]:
    """Every filter this door accepts, as WHERE fragments and their bound values.

    `q` is the one that earns its place: the workbench's search has always been a filter over the
    fifty rows already fetched, which its own comment confesses to, so a serial that exists but sits
    on another page reads as "not in stock". This one reaches the database.
    """
    where: list[str] = []
    params: dict = {}
    if status:
        where.append("a.status = :status")
        params["status"] = status
    if lot_number:
        where.append("l.lot_number = :lot")
        params["lot"] = lot_number
    if product_id:
        where.append("a.product_id = :pid")
        params["pid"] = product_id
    if group_id:
        # THE UNITS OF ONE PRODUCT GROUP, and it is a join rather than `product_id` because a group
        # is keyed on brand + model + grade and NOT on a product row (0024): one model whose Category
        # was spelled two ways is two product rows and therefore ONE group, so `a.product_id = :pid`
        # would list half the group's units and read as missing stock. This spells out the same set
        # `staff_groups.UNITS_OF_GROUP` counts - which is what lets the group page print a total from
        # its own aggregates above rows that come from here, and have the two agree.
        where.append(
            "EXISTS (SELECT 1 FROM product_groups g JOIN products pg"
            "        ON pg.brand_id = g.brand_id AND lower(pg.model) = lower(g.model)"
            "        WHERE g.id = :gid AND pg.id = a.product_id AND a.grade = g.grade)")
        params["gid"] = group_id
    if grade and grade.strip():
        where.append("a.grade = :grade")
        params["grade"] = grade.strip().upper()
    if warehouse and warehouse.strip():
        where.append("l.warehouse = :wh")
        params["wh"] = warehouse.strip()
    # A name OR a slug, the same pair the storefront's category page and the product-group filter
    # both accept, so a link from any of the three means the same thing.
    if category and category.strip():
        where.append("(lower(c.name) = :cat OR lower(c.slug) = :cat)")
        params["cat"] = category.strip().lower()
    if brand and brand.strip():
        where.append("(lower(b.name) = :brand OR lower(b.slug) = :brand)")
        params["brand"] = brand.strip().lower()
    if q and q.strip():
        like = "%" + q.strip().lower() + "%"
        where.append(
            "(lower(coalesce(a.serial_number, '')) LIKE :q"
            " OR lower(coalesce(a.sku, '')) LIKE :q"
            " OR lower(coalesce(a.asset, '')) LIKE :q"
            " OR lower(coalesce(a.model_number, '')) LIKE :q"
            " OR lower(coalesce(p.model, '')) LIKE :q"
            " OR lower(coalesce(p.title, '')) LIKE :q)")
        params["q"] = like
    return where, params


def _asset_row(r) -> dict:
    """One unit as every consumer of this door already reads it, plus the two the table needs.

    THE EXISTING KEYS ARE UNCHANGED, deliberately: `seed_demo`, `rehearse_day` and `test_daily_ops`
    all index and iterate this payload, and a column renamed here is a script or a suite broken
    there. `category` and `sale_price_cents` are ADDITIONS, which is the only kind of change that is
    free on a response four other things read.
    """
    return {"id": r["id"], "public_id": r["public_id"], "serial_number": r["serial_number"],
            "status": r["status"], "grade": r["grade"], "lot_number": r["lot_number"],
            "location": r["location"], "pallet": r["pallet"], "sku": r["sku"], "asset": r["asset"],
            "channel": r["channel"], "on_shelf": r["on_shelf"],
            # `model` is the short name the queue scans ("Latitude 5420"); `title` is the catalogue's
            # full line and is what the table falls back to when model is absent.
            "model": r["model"], "title": r["title"], "brand": r["brand"],
            "category": r["category"], "sale_price_cents": r["sale_price_cents"],
            "intake_at": r["intake_at"].isoformat() if r["intake_at"] else None,
            "warehouse": r["warehouse"], "zone": r["zone"]}


@router.get("/assets")
async def list_assets(status: str | None = None, lot_number: str | None = None,
                      product_id: int | None = None, group_id: int | None = None, q: str | None = None,
                      category: str | None = None, brand: str | None = None,
                      grade: str | None = None, warehouse: str | None = None,
                      sort: str = "newest",
                      limit: int = Query(20, le=100), offset: int = 0, with_meta: bool = False,
                      staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
    """The stock list: every unit the shop holds, in any state, filtered and paged.

    THE RESPONSE STAYS A BARE ARRAY UNLESS `with_meta=1` ASKS FOR THE ENVELOPE, which is the
    precedent `store_catalog.catalog` set for this exact problem and is not fussiness here: four
    other callers read this door and three of them would break on an object. `test_daily_ops` does
    `len()` over the rows and indexes `x["serial_number"]`, `seed_demo` and `rehearse_day` declare
    `-> list[dict]`, and `test_staff_read_walls` asserts the admin response is EXACTLY `[]` - which
    `{}` is not. So an unfiltered, unflagged request is byte-identical to what it always was.

    THE ENVELOPE CARRIES THE TOTAL, and that is the thing this door could not answer before: with
    1,975 units the page had no way to say "showing 50 of 1,975" and no way to reach the rest. It
    also carries the facets, each built with the other filters applied and its own excluded.

    `group_id` is the one filter the Inventory screen does not offer and the product-group page
    does: the units of one brand + model + grade, which is what that page lists under its
    photograph. It takes the envelope's job too - the group page reads its total from the group's
    own aggregates, so a caller listing a group's units can use the bare array.
    """
    filters = {"status": status, "lot_number": lot_number, "product_id": product_id,
               "group_id": group_id, "q": q,
               "category": category, "brand": brand, "grade": grade, "warehouse": warehouse}
    where, params = _asset_clauses(**filters)
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    order = ASSET_SORTS.get(sort, ASSET_SORTS["newest"])

    rows = (await db.execute(text(
        ASSET_SELECT + ASSET_FROM + clause + " ORDER BY " + order + " LIMIT :lim OFFSET :off"),
        {**params, "lim": limit, "off": offset})).mappings().all()
    items = [_asset_row(r) for r in rows]
    if not with_meta:
        return items

    total = (await db.execute(text("SELECT count(*)" + ASSET_FROM + clause), params)).scalar_one()
    facets: dict[str, list[dict]] = {}
    for name, column in FACET_COLUMNS.items():
        # The facet's own filter is dropped from the clauses it is built from - see
        # FACET_OWN_FILTER, and the note there on why.
        sub = {k: v for k, v in filters.items() if k != FACET_OWN_FILTER[name]}
        f_where, f_params = _asset_clauses(**sub)
        f_clause = (" WHERE " + " AND ".join(f_where)) if f_where else ""
        facet_rows = (await db.execute(text(
            "SELECT " + column + " AS value, count(*) AS n" + ASSET_FROM + f_clause +
            " GROUP BY " + column + " HAVING " + column + " IS NOT NULL"
            " ORDER BY count(*) DESC, " + column), f_params)).mappings().all()
        facets[name] = [{"value": r["value"], "count": int(r["n"])} for r in facet_rows]

    return {"items": items, "total": int(total), "limit": limit, "offset": offset,
            "applied": {"status": status, "lot_number": lot_number, "product_id": product_id,
                        "group_id": group_id,
                        "q": q, "category": category, "brand": brand,
                        "grade": (grade.strip().upper() if grade and grade.strip() else None),
                        "warehouse": warehouse, "sort": sort if sort in ASSET_SORTS else "newest"},
            "facets": facets}


# How many awaiting-grade units the workbench returns at once. A corporate lot runs to a few
# hundred; beyond this the payload says it was cut rather than silently showing a prefix.
WORKLIST_MAX = 500
# The statuses a unit can be graded FROM. `rfo_assets_check_status` admits tested/graded and
# in_repair/graded, `received` gets there through the one rung `grade(test_first=True)` walks, and
# `graded` is on the list because re-grading an already-graded unit overwrites its grade without
# attempting any transition at all - the trigger only fires on a CHANGE of status.
#
# `graded` is ALSO why this is the right filter for "unfinished", which is the subtler half. When a
# grade is taken back the status cannot follow it down (there is no graded -> tested edge), so the
# unit sits in `graded` holding no grade. Filtering the queue on "not yet graded" would then hide
# exactly the units the operator just asked to see again. The queue is therefore `grade IS NULL`
# AND gradable - which is what "awaiting a grade" means, and it is the same set in both places so
# the count beside the bar can never disagree with the rows under it.
_GRADABLE_STATUSES = ("received", "tested", "in_repair", "graded")
# The one place the SQL and the Python agree on which statuses those are.
_GRADABLE_SQL = ", ".join("'" + s + "'" for s in _GRADABLE_STATUSES)

# How many pending lots the queue returns at once, and how many models the card may name. The cap is
# one over the answer the caller is told about, so "was it cut?" is settled by the data rather than
# by `len == cap`.
PENDING_LOTS_MAX = 60
PENDING_MODELS_SHOWN = 3


@router.get("/lots/pending")
async def pending_lots(staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
    """The grading queue: every lot still holding a unit that has no grade.

    WHAT "PENDING" MEANS IS THE WORKLIST'S OWN DEFINITION, deliberately. A lot is pending when it
    holds at least one unit that is `grade IS NULL AND status IN (_GRADABLE_SQL)` - the same
    predicate the worklist's own "awaiting" counter and its `scope=unfinished` filter use, built
    from the same constant. A queue that decided for itself what "not yet graded" meant would
    disagree with the workbench it opens into: the card here says "12 of 40 graded" and the lot's
    own progress bar has to say the same thing.

    (That predicate is also why it is `grade IS NULL` rather than "status is not graded": when a
    grade is taken back the status cannot follow it down - there is no graded -> tested edge - so
    the unit sits in `graded` carrying no grade. A queue filtered on status alone would hide exactly
    the units someone just sent back.)

    SORTED OLDEST FIRST, by `lots.received_at`. The queue is worked from the top, and the unit that
    has been waiting longest is the one someone has already promised a customer.

    THE COUNTS ARE COMPUTED HERE, not by the caller. `graded_units` is `grade IS NOT NULL` and
    `total_units` is every unit in the lot - the worklist's own two definitions again - so the
    card's progress bar and the lot's progress bar are the same arithmetic done once.

    THE MODEL SNIPPET IS A LIST, NOT A STRING, because a lot is not always one model: 208 of this
    database's ~10k lots carry two or three. A card that printed only the commonest would be wrong
    about the rest of the work, so the payload carries up to PENDING_MODELS_SHOWN (brand, model,
    count) triples ordered by how many units wear them, plus `model_kinds` - the true number of
    distinct models - so the card can say "+1 more" without a second read. Units with no product
    cannot appear in that list at all; `model_kinds` is null for a lot where none of them has one,
    which is a different fact from "no models were found".
    """
    # One over the cap, so the caller is told whether the queue was cut rather than left to infer it.
    rows = (await db.execute(text("""
        SELECT l.id, l.lot_number, l.received_at, l.warehouse, l.zone,
               count(a.id) AS total_units,
               count(a.id) FILTER (WHERE a.grade IS NOT NULL) AS graded_units,
               count(a.id) FILTER (WHERE a.grade IS NULL AND a.status IN (""" + _GRADABLE_SQL + """)) AS awaiting_units
        FROM lots l JOIN assets a ON a.lot_id = l.id
        GROUP BY l.id
        HAVING count(a.id) FILTER (WHERE a.grade IS NULL AND a.status IN (""" + _GRADABLE_SQL + """)) > 0
        ORDER BY l.received_at ASC, l.id ASC
        LIMIT :lim
    """), {"lim": PENDING_LOTS_MAX + 1})).mappings().all()
    truncated = len(rows) > PENDING_LOTS_MAX
    rows = rows[:PENDING_LOTS_MAX]

    ids = [r["id"] for r in rows]
    models: dict[int, list[dict]] = {}
    kinds: dict[int, int] = {}
    if ids:
        mrows = (await db.execute(text("""
            SELECT a.lot_id, b.name AS brand, p.model, count(*) AS units
            FROM assets a
            JOIN products p ON p.id = a.product_id
            JOIN brands b ON b.id = p.brand_id
            WHERE a.lot_id = ANY(:ids)
            GROUP BY a.lot_id, b.name, p.model
            ORDER BY a.lot_id, count(*) DESC, p.model
        """), {"ids": ids})).mappings().all()
        for m in mrows:
            models.setdefault(m["lot_id"], []).append(
                {"brand": m["brand"], "model": m["model"], "units": int(m["units"])})
            kinds[m["lot_id"]] = kinds.get(m["lot_id"], 0) + 1

    total_pending = (await db.execute(text("""
        SELECT count(*) FROM (
            SELECT l.id FROM lots l JOIN assets a ON a.lot_id = l.id
            GROUP BY l.id
            HAVING count(a.id) FILTER (WHERE a.grade IS NULL AND a.status IN (""" + _GRADABLE_SQL + """)) > 0
        ) q
    """))).scalar_one()

    return {
        "lots": [{
            "id": r["id"], "lot_number": r["lot_number"],
            "received_at": r["received_at"].isoformat(),
            "warehouse": r["warehouse"], "zone": r["zone"],
            "total_units": int(r["total_units"]),
            "graded_units": int(r["graded_units"]),
            "awaiting_units": int(r["awaiting_units"]),
            "models": models.get(r["id"], [])[:PENDING_MODELS_SHOWN],
            "model_kinds": kinds[r["id"]] if r["id"] in kinds else None,
        } for r in rows],
        "total_pending_lots": int(total_pending),
        "truncated": truncated,
    }


@router.get("/lots/worklist")
async def lot_worklist(q: str | None = None, lot_number: str | None = None, lot_id: int | None = None,
                       scope: str = Query("all"),
                       staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
    """One lot's grading progress, and the units to show for it.

    Three ways in, and exactly one per call - an ambiguous call is a 422 rather than a guess:

    * `lot_id` / `lot_number` - a caller that already knows the lot.
    * `q` - the universal search box. The term is resolved in a fixed order and the payload
      REPORTS which rule matched (`match.resolved_by`), because a search that silently picks one
      reading of an ambiguous term is a search whose answer nobody can check. The order is:
      lot number first (the operator's own handle), then a bare number as an asset id (a numeric
      serial is rare; a numeric id is not), then the serial itself (CITEXT, so case-insensitive).

    **A MATCH IS A DOOR INTO ITS LOT, not a filter.** Whichever of the three rules matches - a lot
    number, an asset id, a serial - the payload carries the WHOLE lot the match belongs to, and a
    term that resolved to one unit is reported separately as `highlight_asset_id` so the caller can
    point at it inside that list. Searching a serial used to return that single unit; that hid the
    context a grader needs, and an operator correcting one unit almost always has the units around
    it in their hands too.

    `scope` filters the list: `all` (the default) is every unit in the lot - the workstation view -
    while `unfinished` narrows to the grading queue (no grade, still on the ladder).

    Progress is counted over the WHOLE lot in every case: "3 of 10 units graded" has to mean the
    lot, not the slice on screen. `ready_for_pricing` is derived, never stored - `status='graded'`
    with a grade is what that flag MEANS here, and a second column holding the same fact is a
    second thing to drift.
    """
    if scope not in ("unfinished", "all"):
        raise HTTPException(status_code=422, detail="scope must be 'unfinished' or 'all'")
    if len([x for x in (q, lot_number, lot_id) if x is not None]) != 1:
        raise HTTPException(status_code=422, detail="provide exactly one of q / lot_id / lot_number")

    match = {"kind": "lot", "resolved_by": "lot_id" if lot_id is not None else "lot_number", "term": None}
    # The unit the term NAMED, if it named one. It does not filter anything - it goes back in the
    # payload so the caller can highlight it in the lot it was found in.
    highlight_asset_id: int | None = None
    lot = None
    if lot_id is not None:
        lot = (await db.execute(select(Lot).where(Lot.id == lot_id))).scalars().first()
    elif lot_number is not None:
        lot = (await db.execute(select(Lot).where(Lot.lot_number == lot_number))).scalars().first()
    else:
        term = (q or "").strip()
        if not term:
            raise HTTPException(status_code=422, detail="q must not be blank")
        match["term"] = term
        lot = (await db.execute(
            select(Lot).where(func.lower(Lot.lot_number) == term.lower()))).scalars().first()
        if lot is not None:
            match["resolved_by"] = "lot_number"
        else:
            row = None
            if term.isdigit():
                row = (await db.execute(text("SELECT id, lot_id FROM assets WHERE id = :i"),
                                        {"i": int(term)})).mappings().first()
                if row is not None:
                    match["resolved_by"] = "asset_id"
            if row is None:
                row = (await db.execute(text(
                    "SELECT id, lot_id FROM assets WHERE serial_number = :s ORDER BY id LIMIT 1"),
                    {"s": term})).mappings().first()
                if row is not None:
                    match["resolved_by"] = "serial"
            if row is None:
                raise HTTPException(
                    status_code=404,
                    detail="nothing matches that lot number, asset id or serial")
            match["kind"] = "asset"
            highlight_asset_id = row["id"]
            lot = (await db.execute(select(Lot).where(Lot.id == row["lot_id"]))).scalars().first()
    if lot is None:
        raise HTTPException(status_code=404, detail="lot not found")

    counts = (await db.execute(text("""
        SELECT count(*) AS total,
               count(*) FILTER (WHERE status = 'received') AS received,
               count(*) FILTER (WHERE grade IS NOT NULL) AS graded,
               count(*) FILTER (WHERE grade IS NULL AND status IN (""" + _GRADABLE_SQL + """)) AS awaiting,
               count(*) FILTER (WHERE grade IS NOT NULL AND status = 'graded') AS ready
        FROM assets WHERE lot_id = :i
    """), {"i": lot.id})).mappings().one()

    # The WHERE is assembled from constants only - no caller text reaches this string, and the
    # values ride as bound parameters.
    params: dict = {"i": lot.id, "lim": WORKLIST_MAX + 1}
    if scope == "unfinished":
        where = ("a.lot_id = :i AND a.grade IS NULL AND a.status IN (" + _GRADABLE_SQL + ")")
    else:
        where = "a.lot_id = :i"
    # One row over the cap, so "was it cut?" is answered by the data rather than by `len == cap`.
    rows = (await db.execute(text("""
        SELECT a.id, a.public_id::text AS public_id, a.serial_number::text AS serial_number,
               a.status, a.grade, a.product_id, a.notes, a.location, a.pallet, a.sku, a.asset,
               a.channel, a.on_shelf, a.model_number,
               p.title AS product_title, p.model AS product_model, c.name AS category_name,
               -- The workbench's Listing column needs three more things off the same joins it already
               -- makes: what the unit is priced at (to decide "ready to list" and to seed the inline
               -- price field), the product's slug (to link at the shopfront), and the product's own
               -- status - because the storefront shows a listed unit only when both its lot AND its
               -- product are active, so a "published" message that ignored the product would be a
               -- claim this payload could not support. `sale_price_cents` is what the price door
               -- writes; there is no `resale_price` in this schema.
               a.sale_price_cents, p.slug AS product_slug, p.status AS product_status,
               -- The batch columns ride on every row rather than only on the lot header: a grader
               -- working down a list is asking "which warehouse is THIS unit in", and making them
               -- scroll back to a header to find out is the visibility gap this closes.
               l.warehouse AS lot_warehouse, l.zone AS lot_zone, l.load_id AS lot_load_id,
               l.account AS lot_account
        FROM assets a LEFT JOIN products p ON p.id = a.product_id
                     LEFT JOIN categories c ON c.id = p.category_id
                     LEFT JOIN lots l ON l.id = a.lot_id
        WHERE """ + where + """
        ORDER BY a.id LIMIT :lim
    """), params)).mappings().all()
    truncated = len(rows) > WORKLIST_MAX
    rows = rows[:WORKLIST_MAX]

    return {
        "match": match,
        "highlight_asset_id": highlight_asset_id,
        "lot": {"id": lot.id, "lot_number": lot.lot_number, "status": lot.status,
                "warehouse": lot.warehouse, "received_at": lot.received_at.isoformat(),
                "load_id": lot.load_id, "account": lot.account, "zone": lot.zone},
        "progress": {"total_units": int(counts["total"]), "received_units": int(counts["received"]),
                     "graded_units": int(counts["graded"]),
                     "awaiting_grade_units": int(counts["awaiting"]),
                     "ready_for_pricing_units": int(counts["ready"])},
        "scope": scope,
        "assets": [{"id": r["id"], "public_id": r["public_id"], "serial_number": r["serial_number"],
                    "status": r["status"], "grade": r["grade"], "product_id": r["product_id"],
                    "product_title": r["product_title"], "product_model": r["product_model"],
                    "category": r["category_name"], "notes": r["notes"],
                    "asset": r["asset"], "model_number": r["model_number"],
                    "location": r["location"], "pallet": r["pallet"], "sku": r["sku"],
                    "channel": r["channel"], "on_shelf": r["on_shelf"],
                    "price_cents": r["sale_price_cents"], "product_slug": r["product_slug"],
                    "product_status": r["product_status"],
                    "warehouse": r["lot_warehouse"], "zone": r["lot_zone"],
                    "load_id": r["lot_load_id"], "account": r["lot_account"],
                    "gradable": r["status"] in _GRADABLE_STATUSES,
                    "ready_for_pricing": r["grade"] is not None and r["status"] == "graded"}
                   for r in rows],
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
    # MARGIN GUARD (staff layer). A price below the unit's known cost is refused here rather than
    # stored and hidden later, so the operator learns at the moment of pricing - and the storefront
    # filter (store_catalog) is the belt to this brace, not the only check.
    refusal = margin_refusal(body.sale_price_cents, asset.cost_cents, asset.settlement_cents)
    if refusal:
        raise HTTPException(status_code=422, detail=refusal)
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
    """Every parent product, one row each - the list the redesigned CMS edits.

    ONE ROW PER PRODUCT, NEVER ONE PER ASSET. An asset is a serialised unit and carries no content
    of its own: the photo, the title and the featured flag all live on the parent, so a write here
    already reaches every unit of that product. The page reads this list, folds the products that
    share a brand and a model into ONE entry (a model can appear as several products - the seeded
    catalogue has both `iphone-13` and `seed-demo-ip13`), and writes back with the group door below,
    which is what makes "editing the model updates the storefront for all of its assets" true rather
    than merely stated.

    `brand` and `model` are the fold key and are therefore on the row; `status` lets the page tell a
    draft from a live product. `listed_units` is unchanged (listed assets, whatever lot they are in)
    and `live_units`/`price_from_cents` carry the STOREFRONT's own publishable predicate - listed AND
    in an active lot - which is the number the deal picker and the hero preview have to show, since a
    product with no such unit cannot appear on the shop floor at all.
    """
    rows = (await db.execute(text("""
        SELECT p.id, p.title, p.slug, p.model, p.status, p.image_url, p.featured,
               b.name AS brand, c.name AS category,
               count(a.id) FILTER (WHERE a.status = 'listed') AS units,
               count(a.id) FILTER (WHERE a.status = 'listed' AND l.status = 'active') AS live_units,
               min(a.sale_price_cents) FILTER (WHERE a.status = 'listed' AND l.status = 'active')
                   AS price_from_cents
        FROM products p
        JOIN brands b ON b.id = p.brand_id
        JOIN categories c ON c.id = p.category_id
        LEFT JOIN assets a ON a.product_id = p.id
        LEFT JOIN lots l ON l.id = a.lot_id
        GROUP BY p.id, p.title, p.slug, p.model, p.status, p.image_url, p.featured, b.name, c.name
        ORDER BY p.featured DESC, p.title"""))).mappings().all()
    return [{"id": r["id"], "title": r["title"], "slug": r["slug"], "model": r["model"],
             "status": r["status"], "brand": r["brand"], "category": r["category"],
             "image_url": r["image_url"], "featured": bool(r["featured"]),
             "listed_units": int(r["units"]), "live_units": int(r["live_units"]),
             "price_from_cents": (int(r["price_from_cents"])
                                  if r["price_from_cents"] is not None else None)} for r in rows]


# The group write is capped: a model entry is a handful of products in practice (the catalogue's
# duplicates are two rows, and the pytest sweep is not the shape this door is for), and an
# unbounded id list would let one press become an unbounded number of UPDATEs.
MAX_GROUP_IDS = 200


async def _gallery_photo(db, media_row_id) -> str | None:
    """The PUBLIC ADDRESS of one gallery row - the only thing a storefront `img` can be pointed at.

    A gallery row is either url-backed (`storage_key`, an address the catalogue has always held) or
    byte-backed (`media_id`, bytes in Postgres behind the staff door). Only the first can be a
    product's photo: the storefront renders `products.image_url` with no credentials at all, so a
    byte-backed row copied into it would be a broken tile on the shop floor. That is a 422 with the
    reason rather than a silent half-write, and the picker greys those tiles out for the same reason.
    """
    row = (await db.execute(text("SELECT id, storage_key FROM product_media WHERE id = :r AND kind = 'image'"),
                            {"r": media_row_id})).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="that photo is not in the gallery")
    if row["storage_key"] is None:
        raise HTTPException(status_code=422,
                            detail="that photo is stored behind the staff door - it has no public address the storefront can render")
    return row["storage_key"]


async def _cms_write_product(db, pid: int, body: dict, photo: str | None, clear_photo: bool) -> None:
    """Apply one CMS product write to ONE product, and keep its photo SET and its photo URL one story.

    `image_url` is what the storefront renders TODAY and `product_media` is the set 0014 made live; if
    the CMS could write one without the other, a product's page and its media list would disagree
    about whether it has a photo. A chosen photo joins the set as a url-backed row (storage_key, no
    bytes) exactly as the 0014 backfill wrote the existing ones, and the (product_id, storage_key)
    unique index makes a re-write idempotent rather than a second row for the same address.

    THE CHOSEN PHOTO BECOMES THE PRIMARY ROW. A card renders exactly one photo, and a pick is the
    act of saying which - leaving the flag wherever it happened to be would make the tile show a
    photo the operator just replaced. The old primary is cleared first because 0014's partial unique
    index allows one per product, and both statements are in the caller's transaction.

    Clearing adds nothing and removes nothing, as before: the catalogue is pointed at null and the
    set keeps whatever rows it has.
    """
    upd = []
    params: dict = {"i": pid}
    if clear_photo or photo is not None:
        upd.append("image_url = :img")
        params["img"] = photo
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
    if photo is None:
        return
    await db.execute(text("""
        INSERT INTO product_media (product_id, storage_key, kind, position, is_primary, alt_text)
        SELECT :i, :img, 'image',
               COALESCE((SELECT max(position) + 1 FROM product_media WHERE product_id = :i), 0),
               NOT EXISTS (SELECT 1 FROM product_media WHERE product_id = :i AND is_primary),
               NULL
        ON CONFLICT (product_id, storage_key) WHERE storage_key IS NOT NULL DO NOTHING
    """), {"i": pid, "img": photo})
    await db.execute(text("""
        UPDATE product_media SET is_primary = false
        WHERE product_id = :i AND is_primary AND storage_key IS DISTINCT FROM :img
    """), {"i": pid, "img": photo})
    await db.execute(text("""
        UPDATE product_media SET is_primary = true
        WHERE product_id = :i AND storage_key = :img
    """), {"i": pid, "img": photo})


async def _cms_body_photo(db, body: dict) -> tuple[str | None, bool]:
    """Read the photo out of a CMS write body: (address, clear).

    A picked gallery row (`media_row_id`) and a plain address (`image_url`) are the same act with two
    spellings - the picker sends the first, the demo seeder and the tests send the second - so both
    land on one address here rather than in two code paths that could drift.
    """
    if "media_row_id" in body:
        if body["media_row_id"] in (None, ""):
            return None, True
        return await _gallery_photo(db, int(body["media_row_id"])), False
    if "image_url" in body:
        return str(body["image_url"]).strip() or None, True
    return None, False


@router.patch("/cms/products")
async def cms_edit_products(body: dict, staff: dict = Depends(require_roles(*ROLES_CMS)), db=Depends(get_db)):
    """ONE write for ONE model entry: every product that shares the model, in one transaction.

    The page folds products by brand and model, so its switch and its photo picker each speak for the
    whole group. Sending that as N separate PATCHes would leave the entry half-written if one of them
    failed, and would put the group's size in the URL layer's hands - so the group is one request and
    one commit, and "editing this entry updates the storefront for all associated assets" holds.
    """
    await _require_role(staff, ROLES_CMS, ACTION_CMS_EDIT_PRODUCT, None)
    raw = body.get("ids")
    if not isinstance(raw, list) or not raw:
        raise HTTPException(status_code=422, detail="ids must be a non-empty list")
    if len(raw) > MAX_GROUP_IDS:
        raise HTTPException(status_code=422, detail=f"at most {MAX_GROUP_IDS} products per group write")
    try:
        ids = sorted({int(i) for i in raw})
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="ids must be whole product ids")
    photo, clear = await _cms_body_photo(db, body)
    try:
        for pid in ids:
            await _cms_write_product(db, pid, body, photo, clear)
        # ONE audit row for the group, not one per member: the row names every id it changed, so the
        # trail is complete, and a 200-product group does not bury the feed it has to be readable in.
        await audit(db, "staff", entity="cms", action="model_group_updated", actor_id=staff["id"],
                    after={"ids": ids, "featured": body.get("featured"),
                           "photo": (photo or "")[:120], "cleared": clear})
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"ok": True, "updated": ids, "photo": photo}


@router.patch("/cms/products/{pid}")
async def cms_edit_product(pid: int, body: dict, staff: dict = Depends(require_roles(*ROLES_CMS)), db=Depends(get_db)):
    await _require_role(staff, ROLES_CMS, ACTION_CMS_EDIT_PRODUCT, None)
    photo, clear = await _cms_body_photo(db, body)
    await _cms_write_product(db, pid, body, photo, clear)
    await db.commit()
    await audit(db, "staff", entity="cms", action="product_updated", entity_id=pid, actor_id=staff["id"], after={k: str(body[k])[:60] for k in body})
    await db.commit()
    return {"ok": True}


@router.get("/cms/media")
async def cms_media_gallery(q: str = Query("", max_length=80), limit: int = Query(120, le=400),
                            staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
    """The catalogue's stock-photo gallery: every `product_media` image, for the picker to choose from.

    This is the door that replaces the URL text box. The catalogue's photos are already a real table
    - 0014 made `product_media` live and backfilled the products that had an `image_url` - so the
    picker chooses from what the catalogue already holds instead of asking an operator to paste an
    address they would have to look up somewhere else.

    BOTH KINDS OF ROW ARE RETURNED, and each says which it is. A url-backed row carries the address a
    storefront renders and is therefore selectable; a byte-backed one carries `raw_path` (its bytes
    are behind the staff token, so the admin shows it from a blob URL) and is NOT selectable - there
    is no public address for it to copy into `image_url`. The page greys those tiles out and says why
    rather than hiding a photo the operator knows they uploaded.

    `kind = 'image'` only: this gallery exists to point a product's card at a photo, and 0001's kind
    CHECK also allows video and doc rows.
    """
    term = q.strip().lower()
    like = ("%" + term + "%") if term else None
    total = int((await db.execute(text("SELECT count(*) FROM product_media WHERE kind = 'image'"))).scalar_one())
    rows = (await db.execute(text("""
        SELECT pm.id, pm.product_id, pm.position, pm.is_primary, pm.alt_text, pm.storage_key,
               pm.media_id, pm.created_at, p.slug AS product_slug, p.title AS product_title,
               mo.filename, mo.content_type, mo.byte_size
        FROM product_media pm
        JOIN products p ON p.id = pm.product_id
        LEFT JOIN media_objects mo ON mo.id = pm.media_id
        WHERE pm.kind = 'image'
          AND (:like IS NULL OR lower(p.title) LIKE :like OR lower(coalesce(mo.filename, '')) LIKE :like
               OR lower(coalesce(pm.storage_key, '')) LIKE :like)
        ORDER BY pm.is_primary DESC, p.title, pm.position, pm.id
        LIMIT :lim
    """), {"like": like, "lim": limit})).mappings().all()
    return {
        "total": total,
        "shown": len(rows),
        "items": [{
            "media_row_id": m["id"], "product_id": m["product_id"],
            "product_slug": m["product_slug"], "product_title": m["product_title"],
            "storage_key": m["storage_key"], "media_id": m["media_id"],
            "filename": m["filename"], "content_type": m["content_type"],
            "byte_size": (int(m["byte_size"]) if m["byte_size"] is not None else None),
            "position": m["position"], "is_primary": bool(m["is_primary"]),
            "alt_text": m["alt_text"], "created_at": m["created_at"].isoformat(),
            # The storefront's own rule, in one place: a photo is usable as a card only when it has
            # an address no credential is needed to fetch.
            "publishable": m["storage_key"] is not None,
            "raw_path": (f"/staff/products/{m['product_id']}/media/{m['id']}/raw"
                         if m["media_id"] is not None else None),
        } for m in rows],
    }


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


# ------------- Asset Studio: the image hub -------------
# Three doors, and one deliberate thing about their tuple: it is the SAME pair the asset detail
# page's own read is behind (`staff_views.READ_ROLES`). The image hub is a card ON that page, so a
# wider tuple here would hand a role a door onto a record it cannot open, and a narrower one would
# show an operator a control that always refuses. If the page's wall ever moves, these move with it.
#
# ROLE-ONLY, like the promotion guards above and for the same structural reason: none of these
# action names is in GUARDED_ACTIONS, so `_require_role`'s grant branch refuses an agent before it
# can look anything up, and `None` is passed for the session so the guard cannot reach a grant row
# even by accident. Uploading a unit's photograph is a human act; promoting it into the rail would
# need a vision-capable review of the file first, which does not exist here.
ROLES_ASSET_MEDIA = ("admin", "manager")
ACTION_UPLOAD_IMAGE = "upload_image"
ACTION_APPLY_IMAGE_TO_MODEL = "apply_image_to_model"
ACTION_APPLY_IMAGE_TO_SELECTION = "apply_image_to_selection"
ACTION_SET_GRADE_TEMPLATE = "set_grade_template"

# WHAT MAY BE STORED, AND HOW MUCH, NOW HAS ONE DEFINITION AND IT IS NOT HERE. The whitelist, the
# 5 MB cap and the filename sanitiser moved to `services/media.py` when the product-group door grew
# a second upload: the same three rules were about to exist in two places, and a whitelist that can
# be widened in one of them without the other is not a whitelist. They are imported above and
# re-exported under these names, which is what `store_returns` imports them as.
GRADE_TEMPLATE_GRADES = ("A", "B", "C", "D")


async def _image_row(db, *, asset_id: int, image_id: int):
    """One asset_images row joined to its file, or None. The asset id is part of the lookup: an
    image id alone names an assignment, and an assignment belongs to exactly one unit."""
    return (await db.execute(text("""
        SELECT ai.id, ai.asset_id, ai.media_id, ai.applied_by_bulk, mo.filename, mo.content_type,
               mo.byte_size
        FROM asset_images ai JOIN media_objects mo ON mo.id = ai.media_id
        WHERE ai.id = :i AND ai.asset_id = :a
    """), {"i": image_id, "a": asset_id})).mappings().first()


@router.post("/assets/{asset_id}/images", status_code=201)
async def upload_asset_image(asset_id: int, file: UploadFile = File(...),
                             staff: dict = Depends(require_roles(*ROLES_ASSET_MEDIA)),
                             db=Depends(get_db)):
    """Upload one photograph onto one unit.

    The upload and the assignment are two rows and one transaction: the file is stored once in
    `media_objects`, and `asset_images` says this unit shows it. Re-uploading the same bytes is a
    new file (there is no de-duplication by content - two shots of the same unit are two facts),
    but assigning a file twice to one asset is a no-op rather than a duplicate row.
    """
    await _require_role(staff, ROLES_ASSET_MEDIA, ACTION_UPLOAD_IMAGE, None)
    asset = await db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")

    # VALIDATED AND STORED BY THE SHARED HELPER, which also writes the copy into the media folder -
    # so a unit's photograph lands in the same one place a product's does. The three rules that used
    # to be spelled out here (whitelist, empty, cap) are the same three in `services/media.py`, and
    # two copies of a rule is two chances to widen one of them by accident. The two status codes are
    # kept exactly as they were: 413 for the cap, 422 for everything else.
    try:
        blob = await read_for_upload(file)
        media = await store_upload(db, filename=file.filename, content_type=file.content_type,
                                   blob=blob, uploaded_by=staff["id"])
    except MediaRefused as refusal:
        await db.rollback()
        status = 413 if "5 MB" in str(refusal) else 422
        raise HTTPException(status_code=status, detail=str(refusal))

    try:
        # No ON CONFLICT here, and no content de-duplication: every upload is a new file row and a
        # new assignment, because two photographs of one unit are two things the unit's page
        # should show. The unique key is an INVARIANT, not a de-duplicator - if it ever fires the
        # IntegrityError below answers 409 through the standard translator.
        row = (await db.execute(text("""
            INSERT INTO asset_images (asset_id, media_id, applied_by)
            VALUES (:a, :m, :u)
            RETURNING id
        """), {"a": asset_id, "m": media["id"], "u": staff["id"]})).mappings().one()
        await _audit_execution(db, staff, None, entity="asset", entity_id=asset_id,
                               action="image_upload",
                               after={"image_id": row["id"], "media_id": media["id"],
                                      "filename": _safe_filename(file.filename),
                                      "byte_size": len(blob)})
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"image_id": row["id"], "media_id": media["id"], "public_id": media["public_id"],
            "filename": _safe_filename(file.filename), "content_type": media["content_type"], "byte_size": len(blob),
            "applied_by_bulk": False}


@router.post("/assets/{asset_id}/images/{image_id}/apply-to-model")
async def apply_image_to_model(asset_id: int, image_id: int,
                               staff: dict = Depends(require_roles(*ROLES_ASSET_MEDIA)),
                               db=Depends(get_db)):
    """Apply one unit's image to every unit of the same BRAND AND MODEL in the same lot.

    The match is the brief's own: same lot, and a product whose brand and model are the unit's.
    Product ROWS are matched through brand+model rather than by `product_id` equality - the catalog
    can hold two rows for one brand and model (a re-listed title, a different slug), and a
    photographer applying a shot across a box means the model, not the row. The source unit is
    matched too and skipped by the unique key, so pressing twice adds nothing.

    The assignments are one row each against the SAME file: the bytes are not copied. That is the
    whole reason `media_objects` and `asset_images` are separate tables - a 4 MB photo across a box
    of twenty is twenty rows, not eighty megabytes.

    Each unit that GAINS the image gets its own audit row, because the trail is read per entity and
    its page is the unit's own: a grader opening one of those twenty has to be able to see the
    image arriving on it. The source unit gains nothing, so it gets no row from this call.
    """
    await _require_role(staff, ROLES_ASSET_MEDIA, ACTION_APPLY_IMAGE_TO_MODEL, None)
    img = await _image_row(db, asset_id=asset_id, image_id=image_id)
    if img is None:
        raise HTTPException(status_code=404, detail="image not found on that asset")
    src = (await db.execute(text(
        "SELECT id, lot_id, product_id FROM assets WHERE id = :i"), {"i": asset_id})).mappings().one()
    if src["product_id"] is None:
        raise HTTPException(status_code=409,
                            detail="this unit has no product, so there is no model to match")

    targets = (await db.execute(text("""
        INSERT INTO asset_images (asset_id, media_id, applied_by, applied_by_bulk)
        SELECT a.id, :m, :u, true
        FROM assets a
        WHERE a.lot_id = :l
          AND a.product_id IN (SELECT p2.id FROM products p2
                               WHERE p2.brand_id = (SELECT p1.brand_id FROM products p1 WHERE p1.id = :p)
                                 AND p2.model = (SELECT p1.model FROM products p1 WHERE p1.id = :p))
          AND a.id <> :a
        ON CONFLICT (asset_id, media_id) DO NOTHING
        RETURNING asset_id
    """), {"m": img["media_id"], "u": staff["id"], "l": src["lot_id"], "p": src["product_id"],
           "a": asset_id})).scalars().all()

    for target_id in targets:
        await _audit_execution(db, staff, None, entity="asset", entity_id=target_id,
                               action="image_apply",
                               after={"media_id": img["media_id"], "from_asset_id": asset_id,
                                      "bulk": True})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)

    matched = (await db.execute(text("""
        SELECT count(*) FROM assets a
        WHERE a.lot_id = :l
          AND a.product_id IN (SELECT p2.id FROM products p2
                               WHERE p2.brand_id = (SELECT p1.brand_id FROM products p1 WHERE p1.id = :p)
                                 AND p2.model = (SELECT p1.model FROM products p1 WHERE p1.id = :p))
    """), {"l": src["lot_id"], "p": src["product_id"]})).scalar_one()
    others = int(matched) - 1
    return {"media_id": img["media_id"], "applied": len(targets), "already_had_it": others - len(targets),
            "matched_other_units": others}


class ApplyImageSelectionIn(BaseModel):
    """The units an image is applied to. Bounded at both ends, because this is one request rather
    than a sweep: a selection is a page of the workbench queue, not the estate."""
    asset_ids: list[int] = Field(min_length=1, max_length=200)


@router.post("/assets/{asset_id}/images/{image_id}/apply-to-selection")
async def apply_image_to_selection(asset_id: int, image_id: int, body: ApplyImageSelectionIn,
                                   staff: dict = Depends(require_roles(*ROLES_ASSET_MEDIA)),
                                   db=Depends(get_db)):
    """Apply one unit's image to an EXPLICIT LIST of units - the workbench's bulk-image action.

    HOW THIS DIFFERS FROM apply-to-model ABOVE, because the two look alike and are not. That door
    takes no list at all: it fans out to every unit of the source's brand and model IN THE SOURCE'S
    LOT, which is what a photographer wants after shooting one unit of a box. This one applies to
    exactly the units the operator selected, wherever they sit, and applies the model rule to the
    selection that that door applies to the lot.

    THE MODEL GUARD IS ENFORCED HERE, NOT ONLY IN THE BUTTON. The workbench disables its control
    when the selection is mixed, which is a courtesy that saves the operator a wasted upload; THIS is
    the refusal that holds, because a client is not a guard and the door is reachable by hand. Every
    requested unit must share the source's brand and model - matched as brand+model for the reason
    the door above gives (the catalogue can hold two rows for one brand and model, and a photograph
    belongs to the model, not to the row). A unit with no product can never match, so it is refused
    rather than quietly skipped.
    """
    await _require_role(staff, ROLES_ASSET_MEDIA, ACTION_APPLY_IMAGE_TO_SELECTION, None)
    img = await _image_row(db, asset_id=asset_id, image_id=image_id)
    if img is None:
        raise HTTPException(status_code=404, detail="image not found on that asset")

    src = (await db.execute(text("""
        SELECT a.id, a.product_id, p.brand_id, p.model
        FROM assets a LEFT JOIN products p ON p.id = a.product_id
        WHERE a.id = :i
    """), {"i": asset_id})).mappings().first()
    if src is None:
        raise HTTPException(status_code=404, detail="asset not found")
    if src["product_id"] is None:
        raise HTTPException(status_code=409,
                            detail="this unit has no product, so there is no model to match")

    wanted = sorted(set(body.asset_ids))
    rows = (await db.execute(text("""
        SELECT a.id, a.serial_number::text AS serial_number, a.product_id, p.brand_id, p.model
        FROM assets a LEFT JOIN products p ON p.id = a.product_id
        WHERE a.id = ANY(:ids)
    """), {"ids": wanted})).mappings().all()
    found = {r["id"] for r in rows}
    missing = [i for i in wanted if i not in found]
    if missing:
        raise HTTPException(status_code=404,
                            detail="no unit with id " + ", ".join(str(i) for i in missing[:5]))

    off = [r for r in rows
           if r["product_id"] is None or r["brand_id"] != src["brand_id"] or r["model"] != src["model"]]
    if off:
        names = ", ".join((r["serial_number"] or "#" + str(r["id"])) for r in off[:5])
        raise HTTPException(
            status_code=422,
            detail="every selected unit must be the same brand and model as the source unit; "
                   "these are not: " + names)

    applied = (await db.execute(text("""
        INSERT INTO asset_images (asset_id, media_id, applied_by, applied_by_bulk)
        SELECT a.id, :m, :u, true FROM assets a WHERE a.id = ANY(:ids)
        ON CONFLICT (asset_id, media_id) DO NOTHING
        RETURNING asset_id
    """), {"m": img["media_id"], "u": staff["id"], "ids": wanted})).scalars().all()

    for target_id in applied:
        await _audit_execution(db, staff, None, entity="asset", entity_id=target_id,
                               action="image_apply",
                               after={"media_id": img["media_id"], "from_asset_id": asset_id,
                                      "bulk": True, "via": "selection"})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)

    return {"media_id": img["media_id"], "selected": len(wanted),
            "applied": len(applied), "already_had_it": len(wanted) - len(applied)}


class GradeTemplateIn(BaseModel):
    """`grade` is the rung; `image_id` is an asset_images id (not a media id) or null to clear it.

    The field is REQUIRED and may be null, the same contract GradeIn carries: "clear this grade's
    template" and "you forgot the field" are different requests and must not collapse into one.
    """
    grade: str
    image_id: int | None = None


@router.post("/lots/{lot_id}/grade-templates")
async def set_grade_template(lot_id: int, body: GradeTemplateIn,
                             staff: dict = Depends(require_roles(*ROLES_ASSET_MEDIA)),
                             db=Depends(get_db)):
    """Set (or clear) the reference image for one grade within one lot.

    A grade template is a judgement about a BATCH - "this is what an A out of this lot looks like" -
    so it hangs off the lot and is keyed (lot_id, grade): one per grade, and a second assignment
    REPLACES the first rather than adding a second opinion the UI would have to choose between.
    The image must already be ON a unit of this lot; a template is a pointer to a photo the lot
    actually has, not a way to smuggle in a file from somewhere else.
    """
    await _require_role(staff, ROLES_ASSET_MEDIA, ACTION_SET_GRADE_TEMPLATE, None)
    # `model_fields_set`, not a truth test: the field's DEFAULT is None, so a body that simply
    # omits it would otherwise clear a template the caller never named - the same trap GradeIn
    # documents one door up.
    if "image_id" not in body.model_fields_set:
        raise HTTPException(status_code=422, detail="image_id is required (send null to clear it)")
    grade = body.grade.strip().upper()
    if grade not in GRADE_TEMPLATE_GRADES:
        raise HTTPException(status_code=422, detail="grade must be one of A, B, C, D")
    if await db.get(Lot, lot_id) is None:
        raise HTTPException(status_code=404, detail="lot not found")

    before = (await db.execute(text(
        "SELECT media_id FROM lot_grade_templates WHERE lot_id = :l AND grade = :g"),
        {"l": lot_id, "g": grade})).mappings().first()
    before_media = before["media_id"] if before is not None else None

    if body.image_id is None:
        await db.execute(text(
            "DELETE FROM lot_grade_templates WHERE lot_id = :l AND grade = :g"),
            {"l": lot_id, "g": grade})
        await _audit_execution(db, staff, None, entity="lot", entity_id=lot_id,
                               action="grade_template_clear",
                               before={"grade": grade, "media_id": before_media}, after=None)
        try:
            await db.commit()
        except SQLAlchemyError as e:
            await db.rollback(); _409(e)
        return {"lot_id": lot_id, "grade": grade, "media_id": None}

    found = (await db.execute(text("""
        SELECT ai.media_id FROM asset_images ai JOIN assets a ON a.id = ai.asset_id
        WHERE ai.id = :i AND a.lot_id = :l
    """), {"i": body.image_id, "l": lot_id})).mappings().first()
    if found is None:
        raise HTTPException(status_code=409, detail="that image is not on a unit of this lot")

    await db.execute(text("""
        INSERT INTO lot_grade_templates (lot_id, grade, media_id, set_by)
        VALUES (:l, :g, :m, :u)
        ON CONFLICT (lot_id, grade) DO UPDATE
          SET media_id = EXCLUDED.media_id, set_at = now(), set_by = EXCLUDED.set_by
    """), {"l": lot_id, "g": grade, "m": found["media_id"], "u": staff["id"]})
    await _audit_execution(db, staff, None, entity="lot", entity_id=lot_id,
                           action="grade_template_set",
                           before={"grade": grade, "media_id": before_media},
                           after={"grade": grade, "media_id": found["media_id"]})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"lot_id": lot_id, "grade": grade, "media_id": found["media_id"]}


# ---------------------------------------------------------------------------
# The PARENT's own stock photos: a product's image set, not a unit's.
#
# `product_media` was created by 0001 and never used; 0014 makes it live, backfills the products
# that already had one `image_url` as its primary row, and adds the two indexes these doors lean
# on. The two kinds of row are described there - a url-backed one (storage_key, the address the
# catalog already had) and a byte-backed one (media_id, reusing 0013's media_objects so there is
# ONE byte store, not two).
#
# ROLE-ONLY, like the asset-media doors just above and for the same structural reason: neither
# action name is in GUARDED_ACTIONS, so `_require_role`'s ADR-0008 grant branch refuses an agent
# before it can look anything up, and `None` is passed for the session so the guard cannot reach a
# grant row even by accident. Photographing the catalogue is a human act with no review step
# behind it - the same reasoning the unit-photography doors carry.
#
# The tuple is deliberately the asset-media pair, not a new one: both doors are the same job on a
# different record, and `staff_views.READ_ROLES` is the wall the page that shows them opens with.
# ---------------------------------------------------------------------------
ROLES_PRODUCT_MEDIA = ("admin", "manager")
ACTION_UPLOAD_PRODUCT_MEDIA = "upload_product_media"
ACTION_DELETE_PRODUCT_MEDIA = "delete_product_media"


@router.post("/products/{product_id}/media", status_code=201)
async def upload_product_media(product_id: int, file: UploadFile = File(...),
                               alt_text: str | None = Form(default=None),
                               staff: dict = Depends(require_roles(*ROLES_PRODUCT_MEDIA)),
                               db=Depends(get_db)):
    """Upload one stock photo onto one product - the parent, shared by every unit of it.

    Same two rules as the unit-photography door (raster-only whitelist, 5 MB cap) because the same
    door serves the bytes back to a browser, and the same two-row shape: the file is stored once in
    `media_objects` and `product_media` says this product shows it. Nothing here is de-duplicated by
    content - two shots of one model are two facts - but the (product_id, media_id) unique index
    means re-attaching one file to one product is refused rather than duplicated.

    `is_primary` is COMPUTED, never taken from the caller: the first photo a product gets is its
    primary one, and later ones are not, because a card renders exactly one photo and a caller-
    supplied flag could only make that depend on who uploaded last. `position` appends.
    """
    await _require_role(staff, ROLES_PRODUCT_MEDIA, ACTION_UPLOAD_PRODUCT_MEDIA, None)
    known = (await db.execute(text("SELECT id FROM products WHERE id = :i"),
                              {"i": product_id})).scalar_one_or_none()
    if known is None:
        raise HTTPException(status_code=404, detail="product not found")

    # Shared with every other upload door, so this photograph also lands in the media folder and the
    # whitelist and cap have one definition rather than three. Same two status codes as before.
    try:
        blob = await read_for_upload(file)
        media = await store_upload(db, filename=file.filename, content_type=file.content_type,
                                   blob=blob, uploaded_by=staff["id"])
    except MediaRefused as refusal:
        await db.rollback()
        status = 413 if "5 MB" in str(refusal) else 422
        raise HTTPException(status_code=status, detail=str(refusal))

    clean_alt = (alt_text or "").strip()[:300] or None
    try:
        # One statement so the primary flag and the position are read from the same snapshot the
        # insert sees; the partial unique index on (product_id) WHERE is_primary is the backstop if
        # two uploads for one product ever race, and it answers 409 through the translator below.
        row = (await db.execute(text("""
            INSERT INTO product_media (product_id, media_id, kind, position, is_primary, alt_text)
            SELECT :p, :m, 'image',
                   COALESCE((SELECT max(position) + 1 FROM product_media WHERE product_id = :p), 0),
                   NOT EXISTS (SELECT 1 FROM product_media WHERE product_id = :p AND is_primary),
                   :a
            RETURNING id, position, is_primary
        """), {"p": product_id, "m": media["id"], "a": clean_alt})).mappings().one()
        await _audit_execution(db, staff, None, entity="product", entity_id=product_id,
                               action="product_media_upload",
                               after={"media_row_id": row["id"], "media_id": media["id"],
                                      "filename": _safe_filename(file.filename),
                                      "byte_size": len(blob),
                                      "is_primary": bool(row["is_primary"])})
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"media_row_id": row["id"], "media_id": media["id"], "public_id": media["public_id"],
            "product_id": product_id, "kind": "image", "position": row["position"],
            "is_primary": bool(row["is_primary"]), "alt_text": clean_alt,
            "filename": _safe_filename(file.filename), "content_type": media["content_type"],
            "byte_size": len(blob)}


@router.delete("/products/{product_id}/media/{media_row_id}")
async def delete_product_media(product_id: int, media_row_id: int,
                               staff: dict = Depends(require_roles(*ROLES_PRODUCT_MEDIA)),
                               db=Depends(get_db)):
    """Take one photo off a product's set.

    0013's rule for unit photographs is the rule here too: a mis-taken photo has to be removable,
    and what survives the removal is the audit row, not the row's existence. The row id is scoped
    by the product, so an id from another product's set is a 404 rather than a delete.

    A BYTE-BACKED row's bytes are deleted with it, because 0013 made `media_objects` single-use:
    both foreign keys that can point at one are checked first (a file shared with a unit's image is
    left alone) and the bytes only go when nothing names them. A URL-BACKED row has no bytes of its
    own - its `storage_key` is an address the catalog still holds - so this removes the row and
    leaves `products.image_url` exactly as the CMS wrote it.
    """
    await _require_role(staff, ROLES_PRODUCT_MEDIA, ACTION_DELETE_PRODUCT_MEDIA, None)
    row = (await db.execute(text("""
        SELECT id, media_id, storage_key, is_primary FROM product_media
        WHERE id = :r AND product_id = :p
    """), {"r": media_row_id, "p": product_id})).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="media not found on that product")

    try:
        await db.execute(text("DELETE FROM product_media WHERE id = :r"), {"r": media_row_id})
        if row["media_id"] is not None:
            await db.execute(text("""
                DELETE FROM media_objects WHERE id = :m
                  AND NOT EXISTS (SELECT 1 FROM product_media pm WHERE pm.media_id = :m)
                  AND NOT EXISTS (SELECT 1 FROM asset_images ai WHERE ai.media_id = :m)
            """), {"m": row["media_id"]})
        await _audit_execution(db, staff, None, entity="product", entity_id=product_id,
                               action="product_media_delete",
                               before={"media_row_id": row["id"], "media_id": row["media_id"],
                                       "storage_key": row["storage_key"],
                                       "is_primary": bool(row["is_primary"])})
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"deleted": media_row_id, "product_id": product_id}