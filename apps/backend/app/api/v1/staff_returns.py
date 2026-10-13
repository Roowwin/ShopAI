"""The RMA Manager door: the screen a manager decides returns on.

WHY IT IS SEPARATE FROM THE PUBLIC DOOR. The customer's door can only ASK; this one ANSWERS. Keeping
them in two modules means the decision paths - and the label that approving mints - cannot be
reached from the unauthenticated surface at all, rather than being reachable and then guarded.

WHO MAY DO WHAT. Reading the queue is admin/manager/warehouse, because the warehouse is who receives
the parcel and needs to see what is coming back. DECIDING is admin/manager: approving a return
commits the shop to freight and a refund, which is not a warehouse's call. Receiving is the
warehouse's - it is the physical act of the parcel arriving.

THE PHOTOGRAPH DOOR SERVES BYTES, like the asset image door and for the same reason: the staff token
is a bearer header that no `<img src>` can carry, so the screen fetches each photo through the
authenticated API and shows it from a blob URL. `nosniff` is the second lock on a door that hands
back a content type which came from an upload.

THE ACTION NAMES ARE NOT IN `staff_ops.GUARDED_ACTIONS`, so `_require_role` is called with `db=None`
and an agent identity is refused outright - the chat rail does not dispatch return decisions.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api.v1.deps import require_roles
from app.api.v1.staff_ops import _409, _audit_execution, _require_role
from app.core.db import get_db
from app.services import returns as rma

router = APIRouter(prefix="/staff/returns", tags=["staff-returns"])

ROLES_RMA_READ = ("admin", "manager", "warehouse")
ROLES_RMA_DECIDE = ("admin", "manager")
ROLES_RMA_RECEIVE = ("admin", "manager", "warehouse")
ACTION_READ_RMA = "read_rma"
ACTION_DECIDE_RMA = "decide_rma"
ACTION_RECEIVE_RMA = "receive_rma"


class DecideIn(BaseModel):
    action: str = Field(description="one of: approve, deny, request_info")
    note: str | None = Field(default=None, max_length=1000)
    resolution: str | None = Field(default=None,
                                   description="one of: " + ", ".join(rma.RESOLUTIONS))
    # Only read when approving; when absent the carrier is the one the parcel travelled with.
    carrier: str | None = Field(default=None, max_length=80)


def _refuse(e: rma.RmaError, code: int = 409) -> None:
    raise HTTPException(status_code=code, detail=str(e))


@router.get("")
async def list_returns(status: str | None = None, limit: int = Query(50, ge=1, le=200),
                       offset: int = Query(0, ge=0),
                       staff: dict = Depends(require_roles(*ROLES_RMA_READ)), db=Depends(get_db)):
    """The queue, newest first, optionally filtered to one status."""
    await _require_role(staff, ROLES_RMA_READ, ACTION_READ_RMA, None)
    if status is not None and status not in rma.RMA_STATUSES:
        raise HTTPException(status_code=422,
                            detail="status must be one of: " + ", ".join(rma.RMA_STATUSES))
    total, rows = await rma.list_requests(db, status=status, limit=limit, offset=offset)
    return {"total": total, "returns": rows, "statuses": list(rma.RMA_STATUSES),
            "reasons": list(rma.REASONS)}


@router.get("/{rma_id}")
async def get_return(rma_id: int, staff: dict = Depends(require_roles(*ROLES_RMA_READ)),
                     db=Depends(get_db)):
    """One return in full: the request, the photographs, the customer's history, and the order it is
    about - which is what a manager deciding needs on the screen at once."""
    await _require_role(staff, ROLES_RMA_READ, ACTION_READ_RMA, None)
    request = await rma.get_request(db, rma_id)
    if request is None:
        raise HTTPException(status_code=404, detail="return not found")
    order = (await db.execute(text("""
        SELECT public_id::text AS public_id, status, currency, total_cents, placed_at,
               ship_to_name, ship_city, ship_state
        FROM orders WHERE id = :o"""), {"o": request["order_id"]})).mappings().first()
    return {"request": request, "photos": await rma.photos_for(db, rma_id),
            "history": await rma.customer_history(db, request["customer_id"]),
            "order": dict(order) if order is not None else None,
            "label": await rma.label_document(db, rma_id) if request["tracking_ref"] else None}


@router.post("/{rma_id}/decide")
async def decide(rma_id: int, body: DecideIn,
                 staff: dict = Depends(require_roles(*ROLES_RMA_DECIDE)), db=Depends(get_db)):
    """Approve, deny, or ask for more information. Approving issues the return label in the same
    transaction, so an approved return without a label cannot exist."""
    await _require_role(staff, ROLES_RMA_DECIDE, ACTION_DECIDE_RMA, None)
    before = await rma.get_request(db, rma_id)
    if before is None:
        raise HTTPException(status_code=404, detail="return not found")
    try:
        after = await rma.decide(db, rma_id, action=body.action, note=body.note,
                                 staff_id=staff["id"], carrier=body.carrier,
                                 resolution=body.resolution)
    except rma.RmaError as e:
        await db.rollback(); _refuse(e)
    await _audit_execution(db, staff, None, entity="rma_request", entity_id=rma_id,
                           action="rma_" + body.action,
                           before={"status": before["status"]},
                           after={"status": after["status"], "carrier": after["carrier"],
                                  "tracking_ref": after["tracking_ref"],
                                  "resolution": after["resolution"]})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    label = await rma.label_document(db, rma_id) if after["tracking_ref"] else None
    return {"request": after, "label": label}


@router.post("/{rma_id}/receive")
async def receive(rma_id: int, staff: dict = Depends(require_roles(*ROLES_RMA_RECEIVE)),
                  db=Depends(get_db)):
    """The parcel is back. Moves the units to `returned`, where the Lot Process workbench re-grades
    them - relisted if they are sound, scrapped if they are not."""
    await _require_role(staff, ROLES_RMA_RECEIVE, ACTION_RECEIVE_RMA, None)
    before = await rma.get_request(db, rma_id)
    if before is None:
        raise HTTPException(status_code=404, detail="return not found")
    try:
        after = await rma.receive(db, rma_id, staff_id=staff["id"])
    except rma.RmaError as e:
        await db.rollback(); _refuse(e)
    await _audit_execution(db, staff, None, entity="rma_request", entity_id=rma_id,
                           action="rma_received", before={"status": before["status"]},
                           after={"status": after["status"]})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"request": after}


@router.get("/{rma_id}/label")
async def get_label(rma_id: int, staff: dict = Depends(require_roles(*ROLES_RMA_READ)),
                    db=Depends(get_db)):
    """The same label the customer downloads, so the desk can print one when a customer rings."""
    await _require_role(staff, ROLES_RMA_READ, ACTION_READ_RMA, None)
    label = await rma.label_document(db, rma_id)
    if label is None:
        raise HTTPException(status_code=409, detail="no return label has been issued for this return")
    return label


@router.get("/{rma_id}/photos/{media_id}/raw")
async def get_photo(rma_id: int, media_id: int,
                    staff: dict = Depends(require_roles(*ROLES_RMA_READ)), db=Depends(get_db)):
    """The bytes of one attached photograph, addressed by the request it belongs to.

    The request id is part of the address on purpose: a media id alone would let any staff identity
    read any upload in the platform through this door, and the pair is what says "this photograph is
    of this return".
    """
    await _require_role(staff, ROLES_RMA_READ, ACTION_READ_RMA, None)
    row = (await db.execute(text("""
        SELECT m.bytes, m.content_type FROM rma_photos p JOIN media_objects m ON m.id = p.media_id
        WHERE p.rma_id = :r AND p.media_id = :m"""), {"r": rma_id, "m": media_id})).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="no such photograph on this return")
    return Response(content=row["bytes"], media_type=row["content_type"],
                    headers={"X-Content-Type-Options": "nosniff",
                             "Content-Disposition": "inline", "Cache-Control": "private, max-age=300"})
