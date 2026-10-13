"""The finance door: invoices, expenses, and the P&L that nets them.

WHY THIS FILE EXISTS. Everything the business earned was legible from `orders` and everything it
spent was written down nowhere. There was no document to issue, no place to record a cost, and
therefore no statement of whether a period made money. This is the door onto `invoices` and
`expenses` and the P&L built from them (services/ledger holds the arithmetic and the reasoning).

READS AND WRITES ARE ADMIN. A manager runs the shop; the statement of what the business earned and
spent is the owner's, and a report a manager can read is a report a manager can be asked to
explain. So the whole door - `GET /pnl`, `/invoices`, `/expenses` as much as the writes - is behind
`admin`, and every other staff role is refused at the decorator before the body runs. The role
tuples are constants used by the decorator and the in-body guard, and none of these action names is
in `staff_ops.GUARDED_ACTIONS`, so an agent identity is refused by the shared guard (`db=None`)
rather than admitted through a grant.

INVOICES ARE NOT HAND-WRITTEN. The normal way one exists is that an order was paid and the payment
path issued it in the same transaction. `POST /invoices` here is the BACKFILL door - it runs the
same idempotent `ensure_invoice`, so issuing an invoice for an order that already has one returns
that one rather than minting a second document for one sale.
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError

from app.api.v1.deps import require_roles
from app.api.v1.staff_ops import _409, _require_role
from app.core.db import get_db
from app.services import ledger
from app.services.audit import audit

router = APIRouter(prefix="/staff/finance", tags=["staff-finance"])

ROLES_FINANCE_READ = ("admin",)
ROLES_FINANCE_WRITE = ("admin",)
ACTION_READ_FINANCE = "read_finance"
ACTION_WRITE_INVOICE = "write_invoice"
ACTION_WRITE_EXPENSE = "write_expense"


class InvoiceIn(BaseModel):
    order_id: int
    notes: str | None = Field(default=None, max_length=400)


class InvoicePatch(BaseModel):
    status: str = Field(description="one of: " + ", ".join(ledger.INVOICE_STATUSES))


class ExpenseIn(BaseModel):
    category: str = Field(min_length=1, max_length=60)
    # ge=0 rather than ge=1: a zero-cost expense is odd but it is not this door's business to refuse
    # it, and the schema already says the amount may not be negative.
    amount_cents: int = Field(ge=0)
    tax_cents: int = Field(default=0, ge=0)
    vendor: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=400)
    incurred_on: date | None = None
    paid: bool = False


def _range(since: date | None, until: date | None) -> tuple[date, date]:
    """An inclusive window, defaulting to the current month so a bare call is always answerable."""
    today = date.today()
    return (since or today.replace(day=1), until or today)


@router.get("/invoices")
async def list_invoices(since: date | None = Query(None, alias="from"), until: date | None = Query(None, alias="to"),
                        status: str | None = None, limit: int = Query(50, ge=1, le=200),
                        offset: int = Query(0, ge=0),
                        staff: dict = Depends(require_roles(*ROLES_FINANCE_READ)), db=Depends(get_db)):
    await _require_role(staff, ROLES_FINANCE_READ, ACTION_READ_FINANCE, None)
    if status is not None and status not in ledger.INVOICE_STATUSES:
        raise HTTPException(status_code=422,
                            detail="status must be one of: " + ", ".join(ledger.INVOICE_STATUSES))
    total, rows = await ledger.list_invoices(db, since=since, until=until, status=status,
                                             limit=limit, offset=offset)
    return {"total": total, "invoices": rows}


@router.get("/invoices/{invoice_id}")
async def get_invoice(invoice_id: int,
                      staff: dict = Depends(require_roles(*ROLES_FINANCE_READ)), db=Depends(get_db)):
    await _require_role(staff, ROLES_FINANCE_READ, ACTION_READ_FINANCE, None)
    inv = await ledger.get_invoice(db, invoice_id)
    if inv is None:
        raise HTTPException(status_code=404, detail="invoice not found")
    return inv


@router.post("/invoices", status_code=201)
async def issue_invoice(body: InvoiceIn,
                        staff: dict = Depends(require_roles(*ROLES_FINANCE_WRITE)), db=Depends(get_db)):
    """Issue (or return) the invoice for a paid order. Idempotent on the order."""
    await _require_role(staff, ROLES_FINANCE_WRITE, ACTION_WRITE_INVOICE, None)
    inv = await ledger.ensure_invoice(db, body.order_id, notes=body.notes)
    if inv is None:
        raise HTTPException(status_code=404, detail="order not found")
    await audit(db, "staff", entity="invoice", entity_id=inv["id"], action="invoice_issued",
                actor_id=staff["id"], after={"number": inv["number"], "order_id": body.order_id})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return inv


@router.patch("/invoices/{invoice_id}")
async def patch_invoice(invoice_id: int, body: InvoicePatch,
                        staff: dict = Depends(require_roles(*ROLES_FINANCE_WRITE)), db=Depends(get_db)):
    """Move an invoice along its ladder (issued -> paid/void). See services/ledger for the rules."""
    await _require_role(staff, ROLES_FINANCE_WRITE, ACTION_WRITE_INVOICE, None)
    # A status outside the vocabulary is a malformed request (422); a LEGAL status reached from the
    # wrong rung is a conflict (409). The service raises ValueError for both, so the vocabulary is
    # checked here where the distinction is still visible.
    if body.status not in ledger.INVOICE_STATUSES:
        raise HTTPException(status_code=422,
                            detail="status must be one of: " + ", ".join(ledger.INVOICE_STATUSES))
    try:
        inv = await ledger.set_invoice_status(db, invoice_id, body.status)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if inv is None:
        raise HTTPException(status_code=404, detail="invoice not found")
    await audit(db, "staff", entity="invoice", entity_id=invoice_id, action="invoice_status",
                actor_id=staff["id"], after={"status": inv["status"]})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return inv


@router.get("/expenses")
async def list_expenses(since: date | None = Query(None, alias="from"), until: date | None = Query(None, alias="to"),
                        category: str | None = None, limit: int = Query(50, ge=1, le=200),
                        offset: int = Query(0, ge=0),
                        staff: dict = Depends(require_roles(*ROLES_FINANCE_READ)), db=Depends(get_db)):
    await _require_role(staff, ROLES_FINANCE_READ, ACTION_READ_FINANCE, None)
    total, rows = await ledger.list_expenses(db, since=since, until=until, category=category,
                                             limit=limit, offset=offset)
    return {"total": total, "expenses": rows}


@router.post("/expenses", status_code=201)
async def create_expense(body: ExpenseIn,
                         staff: dict = Depends(require_roles(*ROLES_FINANCE_WRITE)), db=Depends(get_db)):
    await _require_role(staff, ROLES_FINANCE_WRITE, ACTION_WRITE_EXPENSE, None)
    category = body.category.strip()
    if not category:
        raise HTTPException(status_code=422, detail="category must not be blank")
    row = await ledger.create_expense(db, category=category, vendor=body.vendor,
                                      description=body.description, amount_cents=body.amount_cents,
                                      tax_cents=body.tax_cents, incurred_on=body.incurred_on,
                                      paid=body.paid, created_by=staff["id"])
    await audit(db, "staff", entity="expense", entity_id=row["id"], action="expense_recorded",
                actor_id=staff["id"],
                after={"category": category, "amount_cents": body.amount_cents})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return row


@router.get("/pnl")
async def pnl(since: date | None = Query(None, alias="from"), until: date | None = Query(None, alias="to"),
              staff: dict = Depends(require_roles(*ROLES_FINANCE_READ)), db=Depends(get_db)):
    """Profit and loss over an inclusive window, defaulting to the current month."""
    await _require_role(staff, ROLES_FINANCE_READ, ACTION_READ_FINANCE, None)
    start, end = _range(since, until)
    if end < start:
        raise HTTPException(status_code=422, detail="the end of the period is before its start")
    return await ledger.profit_and_loss(db, start, end)
