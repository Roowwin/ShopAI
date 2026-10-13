"""The public returns door: a customer raises a return against their own order.

WHY IT IS UNGUARDED, AND WHY THAT IS STILL SAFE. There is no customer session on the storefront for
most buyers, so this door cannot require one - but it is not open either. Every call carries BOTH
the order reference AND the email the order was placed under, and the service matches them
together; a UUID alone is a bearer token and would let anyone who ever saw a confirmation page raise
a return against somebody else's order. See `services/returns.find_order`.

WHAT THIS DOOR CANNOT DO. It cannot decide anything. A customer can raise a request, attach
photographs, and read the request back; only the backoffice door (`staff_returns`) can approve,
deny or ask for more information, and only approval mints a label. That split is the whole point of
an RMA - the customer asks, the shop answers.

PHOTOGRAPHS GO THROUGH THE SAME STORE AS EVERY OTHER IMAGE. The bytes land in `media_objects` (0013)
by way of the same whitelist and the same 5 MB cap the asset gallery uses, and `rma_photos` only
says which uploads belong to which request - one image store, repointed at a bucket once.
"""

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api.v1.staff_ops import IMAGE_MAX_BYTES, IMAGE_TYPES, _409, _safe_filename
from app.core.db import get_db
from app.services import returns as rma
from app.services.audit import audit

router = APIRouter(prefix="/store/returns", tags=["store-returns"])


class LookupIn(BaseModel):
    order_ref: str = Field(min_length=1, max_length=64)
    email: str = Field(min_length=3, max_length=254)


class RequestIn(BaseModel):
    order_ref: str = Field(min_length=1, max_length=64)
    email: str = Field(min_length=3, max_length=254)
    reason: str = Field(description="one of: " + ", ".join(rma.REASONS))
    detail: str | None = Field(default=None, max_length=1000)


def _refuse(e: rma.RmaError) -> None:
    raise HTTPException(status_code=409, detail=str(e))


async def _verified(db, order_ref: str, email: str) -> dict:
    """The order this pair names, or a 404 that says the same thing for a wrong reference and a
    wrong email. The two are deliberately indistinguishable: telling a caller that the reference was
    right but the email was wrong turns this door into an oracle for which orders exist."""
    order = await rma.find_order(db, order_ref, email)
    if order is None:
        raise HTTPException(
            status_code=404,
            detail="We could not find an order with that reference and email. Check the order "
                   "confirmation for the reference, or contact support - orders placed as a guest "
                   "without an account cannot be returned from this form.")
    return order


@router.post("/lookup")
async def lookup(body: LookupIn, db=Depends(get_db)):
    """Does this order exist, and is it one we can take back? The form's first step."""
    order = await _verified(db, body.order_ref, body.email)
    open_rma = await rma.open_request_for_order(db, order["id"])
    return {"order": order, "lines": await rma.order_lines_for(db, order["id"]),
            "existing_return": open_rma,
            "reasons": list(rma.REASONS)}


@router.post("", status_code=201)
async def create_request(body: RequestIn, db=Depends(get_db)):
    """Raise the return. Status `pending` - nothing is approved by asking."""
    # A reason outside the closed set is a MALFORMED request (422), not a conflict - the service
    # would answer 409 for it, which is the wrong shape for a field that simply is not one of ours.
    if body.reason not in rma.REASONS:
        raise HTTPException(status_code=422,
                            detail="reason must be one of: " + ", ".join(rma.REASONS))
    order = await _verified(db, body.order_ref, body.email)
    try:
        created = await rma.create_request(db, order_id=order["id"],
                                           customer_id=order["customer_id"],
                                           email=body.email.strip(), reason=body.reason,
                                           detail=body.detail)
    except rma.RmaError as e:
        await db.rollback(); _refuse(e)
    await audit(db, "system", entity="rma_request", entity_id=created["id"],
                action="rma_requested", after={"number": created["number"],
                                               "reason": created["reason"]})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"request": created}


async def _own(db, public_id: str, email: str) -> dict:
    """This request - by id OR by its RMA number - if the email matches the one it was raised
    with. 404 otherwise, for the same reason `_verified` gives one."""
    request = await rma.get_by_ref(db, public_id)
    if request is None or request["email"].strip().lower() != (email or "").strip().lower():
        raise HTTPException(status_code=404, detail="no return found for that reference and email")
    return request


@router.post("/{public_id}/photos", status_code=201)
async def upload_photo(public_id: str, email: str = Query(min_length=3, max_length=254),
                       file: UploadFile = File(...), db=Depends(get_db)):
    """Attach one photograph of the defect. Same whitelist and cap as every other upload."""
    request = await _own(db, public_id, email)
    if request["status"] in ("denied", "completed", "cancelled"):
        raise HTTPException(status_code=409, detail="this return is closed - photographs can no longer be added")
    ctype = (file.content_type or "").split(";")[0].strip().lower()
    if ctype not in IMAGE_TYPES:
        raise HTTPException(status_code=422, detail="only JPEG, PNG, WebP or GIF images can be attached")
    blob = await file.read(IMAGE_MAX_BYTES + 1)
    if not blob:
        raise HTTPException(status_code=422, detail="that file is empty")
    if len(blob) > IMAGE_MAX_BYTES:
        raise HTTPException(status_code=413, detail="images are capped at 5 MB")
    try:
        media = (await db.execute(text("""
            INSERT INTO media_objects (filename, content_type, byte_size, bytes, uploaded_by)
            VALUES (:f, :c, :n, :b, NULL)
            RETURNING id"""),
            {"f": _safe_filename(file.filename), "c": ctype, "n": len(blob),
             "b": blob})).mappings().one()
        await rma.add_photo(db, request["id"], media["id"])
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"media_id": media["id"], "filename": _safe_filename(file.filename),
            "content_type": ctype, "byte_size": len(blob)}


@router.get("/{public_id}")
async def get_request(public_id: str, email: str = Query(min_length=3, max_length=254),
                      db=Depends(get_db)):
    """The customer's own view of their return: its status, what they attached, and - once it is
    approved - the return label they can print."""
    request = await _own(db, public_id, email)
    label = await rma.label_document(db, request["id"]) if request["tracking_ref"] else None
    return {"request": request, "photos": await rma.photos_for(db, request["id"]), "label": label}


@router.get("/{public_id}/label")
async def get_label(public_id: str, email: str = Query(min_length=3, max_length=254),
                    db=Depends(get_db)):
    """The return label as a document. 409 until the return has been approved and a label issued."""
    request = await _own(db, public_id, email)
    label = await rma.label_document(db, request["id"])
    if label is None:
        raise HTTPException(status_code=409,
                            detail="no return label has been issued for this return yet")
    return label
