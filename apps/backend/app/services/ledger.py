"""The financial ledger: invoices from paid orders, expenses, and the P&L that nets them.

WHAT THIS ADDS THAT THE SCHEMA DID NOT. `orders` already knew what was sold and for how much, and
`assets.cost_cents` already knew what it cost. Neither is a ledger: there was no document to send a
corporate buyer, no way to record what the business SPENT, and therefore no way to answer the one
question a P&L is for - did the quarter make money.

THE THREE FIGURES, AND WHY THEY ARE THREE. An invoice's `subtotal_cents` is income and its
`shipping_cents` is income; its `tax_cents` is GST COLLECTED ON THE TAX AUTHORITY'S BEHALF and is
neither. Reporting `total_cents` as revenue would overstate profit by the GST rate on every line -
10% of everything sold in Australia - so the P&L reports goods + shipping as income and GST
separately, and a reader can always reconstruct the invoice total from the three.

COGS IS THE SAME COST BASIS THE MARGIN GUARD USES: `COALESCE(cost_cents, settlement_cents, 0)`. If
the shop refuses to sell a unit below that number (services/margin), then that number is what the
unit cost, and a P&L built on a different one would disagree with the shelf about the same sale.

ONE INVOICE PER ORDER, ENFORCED BY THE DATABASE. `invoices.order_id` is UNIQUE and the insert is
`ON CONFLICT (order_id) DO NOTHING ... RETURNING`, so a payment webhook redelivered, a retry, or two
workers racing the same order all converge on one invoice rather than minting a second document for
one sale. The number is drawn from `invoice_number_seq` (year-prefixed, like lot numbers); a losing
race burns a number and nothing else.
"""

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import text


def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


_INVOICE_COLUMNS = """
    i.id, i.public_id::text AS public_id, i.number, i.order_id, i.customer_id, i.status,
    i.currency, i.subtotal_cents, i.tax_cents, i.shipping_cents, i.total_cents,
    i.issued_on, i.due_on, i.paid_at, i.notes, i.created_at
"""


def _invoice_row(r) -> dict:
    return {"id": r["id"], "public_id": r["public_id"], "number": r["number"],
            "order_id": r["order_id"], "customer_id": r["customer_id"], "status": r["status"],
            "currency": r["currency"], "subtotal_cents": int(r["subtotal_cents"]),
            "tax_cents": int(r["tax_cents"]), "shipping_cents": int(r["shipping_cents"]),
            "total_cents": int(r["total_cents"]), "issued_on": _iso(r["issued_on"]),
            "due_on": _iso(r["due_on"]), "paid_at": _iso(r["paid_at"]), "notes": r["notes"],
            "created_at": _iso(r["created_at"])}


async def ensure_invoice(db, order_id: int, *, notes: str | None = None) -> dict | None:
    """The invoice for `order_id`, issued if it does not exist yet. None if there is no such order.

    No commit here - the caller's transaction owns it, exactly like the audit rows. That matters:
    the payment webhook issues the invoice in the SAME transaction that marks the order paid, so a
    rollback leaves neither a paid order without its invoice nor an invoice without its sale.
    """
    existing = (await db.execute(
        text(f"SELECT {_INVOICE_COLUMNS} FROM invoices i WHERE i.order_id = :o"),
        {"o": order_id})).mappings().first()
    if existing is not None:
        return _invoice_row(existing)

    order = (await db.execute(text("""
        SELECT id, public_id::text AS public_id, customer_id, currency,
               subtotal_cents, tax_cents, shipping_cents, total_cents
        FROM orders WHERE id = :o"""), {"o": order_id})).mappings().first()
    if order is None:
        return None

    number = (await db.execute(text(
        "SELECT 'INV-' || to_char(now(),'YYYY') || '-'"
        " || lpad(nextval('invoice_number_seq')::text, 5, '0')"))).scalar_one()
    invoice_id = (await db.execute(text("""
        INSERT INTO invoices (number, order_id, customer_id, status, currency,
                              subtotal_cents, tax_cents, shipping_cents, total_cents, notes)
        VALUES (:n, :o, :c, 'issued', :cur, :sub, :tax, :ship, :tot, :notes)
        ON CONFLICT (order_id) DO NOTHING
        RETURNING id"""),
        {"n": number, "o": order_id, "c": order["customer_id"], "cur": order["currency"],
         "sub": order["subtotal_cents"], "tax": order["tax_cents"],
         "ship": order["shipping_cents"], "tot": order["total_cents"], "notes": notes}
    )).scalar_one_or_none()

    if invoice_id is None:      # lost a race: the winner's row is the invoice
        again = (await db.execute(
            text(f"SELECT {_INVOICE_COLUMNS} FROM invoices i WHERE i.order_id = :o"),
            {"o": order_id})).mappings().first()
        return _invoice_row(again) if again is not None else None
    row = (await db.execute(text(f"SELECT {_INVOICE_COLUMNS} FROM invoices i WHERE i.id = :i"),
                            {"i": invoice_id})).mappings().first()
    return _invoice_row(row)


async def get_invoice(db, invoice_id: int) -> dict | None:
    row = (await db.execute(text(f"SELECT {_INVOICE_COLUMNS} FROM invoices i WHERE i.id = :i"),
                            {"i": invoice_id})).mappings().first()
    return _invoice_row(row) if row is not None else None


# The invoice lifecycle is a short ladder and not a free-form field: `paid` says the money arrived,
# `void` says the document is withdrawn, and neither may be walked back by an edit - a void invoice
# that can be un-voided is a document whose number cannot be trusted.
INVOICE_STATUSES = ("draft", "issued", "paid", "void")
_INVOICE_ALLOWED = {
    "draft": ("issued", "void"),
    "issued": ("paid", "void"),
    "paid": ("void",),
    "void": (),
}


async def set_invoice_status(db, invoice_id: int, status: str) -> dict | None:
    """Move an invoice along its ladder, or None if it does not exist. Refuses an illegal move.

    Returns the ROW plus, on refusal, nothing - the caller reads the current status to explain. An
    illegal transition raises ValueError so the HTTP layer can answer 409 rather than write.
    """
    if status not in INVOICE_STATUSES:
        raise ValueError(f"status must be one of: {', '.join(INVOICE_STATUSES)}")
    row = (await db.execute(text("SELECT id, status FROM invoices WHERE id = :i"),
                            {"i": invoice_id})).mappings().first()
    if row is None:
        return None
    if status == row["status"]:
        return await get_invoice(db, invoice_id)
    if status not in _INVOICE_ALLOWED[row["status"]]:
        raise ValueError(f"cannot move an invoice from {row['status']} to {status}")
    await db.execute(text("""
        UPDATE invoices SET status = :s,
               paid_at = CASE WHEN :s = 'paid' THEN now() ELSE paid_at END
        WHERE id = :i"""), {"s": status, "i": invoice_id})
    return await get_invoice(db, invoice_id)


async def list_invoices(db, *, since: date | None, until: date | None, status: str | None,
                        limit: int, offset: int) -> tuple[int, list[dict]]:
    params = {"f": since, "t": until, "s": status, "lim": limit, "off": offset}
    where = ("WHERE (CAST(:f AS date) IS NULL OR i.issued_on >= CAST(:f AS date))"
             "  AND (CAST(:t AS date) IS NULL OR i.issued_on <= CAST(:t AS date))"
             "  AND (CAST(:s AS text) IS NULL OR i.status = CAST(:s AS text))")
    rows = (await db.execute(text(
        f"SELECT {_INVOICE_COLUMNS} FROM invoices i {where}"
        " ORDER BY i.issued_on DESC, i.id DESC LIMIT :lim OFFSET :off"), params)).mappings().all()
    total = (await db.execute(text(f"SELECT count(*) FROM invoices i {where}"), params)).scalar_one()
    return int(total), [_invoice_row(r) for r in rows]


def _expense_row(r) -> dict:
    return {"id": r["id"], "public_id": r["public_id"], "category": r["category"],
            "vendor": r["vendor"], "description": r["description"],
            "amount_cents": int(r["amount_cents"]), "tax_cents": int(r["tax_cents"]),
            "incurred_on": _iso(r["incurred_on"]), "paid_at": _iso(r["paid_at"]),
            "created_by": r["created_by"], "created_at": _iso(r["created_at"])}


_EXPENSE_COLUMNS = """
    id, public_id::text AS public_id, category, vendor, description, amount_cents, tax_cents,
    incurred_on, paid_at, created_by, created_at
"""


async def create_expense(db, *, category: str, vendor: str | None, description: str | None,
                         amount_cents: int, tax_cents: int, incurred_on: date | None,
                         paid: bool, created_by: int | None) -> dict:
    """Record money out. No commit - the caller's transaction owns it."""
    row = (await db.execute(text(f"""
        INSERT INTO expenses (category, vendor, description, amount_cents, tax_cents,
                               incurred_on, paid_at, created_by)
        VALUES (:cat, :ven, :descr, :amt, :tax, COALESCE(CAST(:on AS date), CURRENT_DATE),
                CASE WHEN :paid THEN now() ELSE NULL END, :by)
        RETURNING {_EXPENSE_COLUMNS}"""),
        {"cat": category, "ven": vendor, "descr": description, "amt": amount_cents,
         "tax": tax_cents, "on": incurred_on, "paid": paid, "by": created_by})).mappings().first()
    return _expense_row(row)


async def list_expenses(db, *, since: date | None, until: date | None, category: str | None,
                        limit: int, offset: int) -> tuple[int, list[dict]]:
    params = {"f": since, "t": until, "c": category, "lim": limit, "off": offset}
    where = ("WHERE (CAST(:f AS date) IS NULL OR incurred_on >= CAST(:f AS date))"
             "  AND (CAST(:t AS date) IS NULL OR incurred_on <= CAST(:t AS date))"
             "  AND (CAST(:c AS text) IS NULL OR category = CAST(:c AS text))")
    rows = (await db.execute(text(
        f"SELECT {_EXPENSE_COLUMNS} FROM expenses {where}"
        " ORDER BY incurred_on DESC, id DESC LIMIT :lim OFFSET :off"), params)).mappings().all()
    total = (await db.execute(text(f"SELECT count(*) FROM expenses {where}"), params)).scalar_one()
    return int(total), [_expense_row(r) for r in rows]


async def profit_and_loss(db, since: date, until: date) -> dict:
    """Revenue, cost of goods, expenses and the two profits, over an inclusive date range.

    Revenue is read from INVOICES rather than orders on purpose: an invoice is a document the
    business issued, so a voided one is not income and a paid order that was never invoiced is a
    bookkeeping gap to be seen rather than quietly counted.
    """
    income = (await db.execute(text("""
        SELECT COALESCE(sum(subtotal_cents), 0) AS goods,
               COALESCE(sum(shipping_cents), 0) AS shipping,
               COALESCE(sum(tax_cents), 0) AS gst,
               count(*) AS invoices
        FROM invoices
        WHERE status <> 'void' AND issued_on BETWEEN :f AND :t"""),
        {"f": since, "t": until})).mappings().one()

    # The window is half-open on the timestamps: [since 00:00, until+1day 00:00). A sale at 23:59 on
    # the last day belongs to the period; one at 00:00 the next day does not, and expressing that as
    # a timestamp range rather than `moved_at::date BETWEEN` keeps the partition pruning and the
    # index on `moved_at` usable.
    from_ts = datetime.combine(since, datetime.min.time(), tzinfo=timezone.utc)
    to_ts = datetime.combine(until + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
    cogs = (await db.execute(text("""
        SELECT COALESCE(sum(COALESCE(a.cost_cents, a.settlement_cents, 0)), 0) AS cogs,
               count(*) AS units
        FROM stock_movements m JOIN assets a ON a.id = m.asset_id
        WHERE m.qty < 0 AND m.reason = 'sale'
          AND m.moved_at >= :a AND m.moved_at < :b"""),
        {"a": from_ts, "b": to_ts})).mappings().one()

    spend = (await db.execute(text("""
        SELECT COALESCE(sum(amount_cents), 0) AS amount, count(*) AS expenses
        FROM expenses WHERE incurred_on BETWEEN :f AND :t"""),
        {"f": since, "t": until})).mappings().one()

    goods, shipping = int(income["goods"]), int(income["shipping"])
    gst, cogs_cents = int(income["gst"]), int(cogs["cogs"])
    expenses_cents = int(spend["amount"])
    revenue = goods + shipping
    gross_profit = revenue - cogs_cents
    return {
        "from": since.isoformat(), "to": until.isoformat(),
        # Income. GST is reported beside it, never inside it - see the module docstring.
        "revenue_cents": revenue,
        "goods_cents": goods,
        "shipping_income_cents": shipping,
        "gst_collected_cents": gst,
        "cogs_cents": cogs_cents,
        "gross_profit_cents": gross_profit,
        "expenses_cents": expenses_cents,
        "net_profit_cents": gross_profit - expenses_cents,
        "counts": {"invoices": int(income["invoices"]), "units_sold": int(cogs["units"]),
                   "expenses": int(spend["expenses"])},
    }
