"""Order lifecycle primitives, shared by the payment webhook and the staff fulfilment door.

WHY A MODULE. "What does it mean for an order to become paid" is one question with one answer, and
it has two callers: the payment webhook (money arrived) and the staff door (an operator recording an
offline payment). Writing it twice is how the two drift, and the drift would be a unit that is sold
in the ledger but still reserved on the shelf.

THE ASSET STATE MACHINE DECIDES THE RETURNS, NOT THIS MODULE. `rfo_assets_check_status` admits
`reserved -> listed` and `sold/shipped -> returned`, and deliberately has NO `sold -> listed` edge:
a unit that has been sold and comes back is not magically sellable again, it re-enters the
refurbishment pipeline (`returned -> tested -> graded -> listed`) so it is re-inspected before it
can be offered to anyone else. So there are two return shapes here and which one applies is read
off the unit's own current status, not off the order's.
"""

from sqlalchemy import text

from app.models import Asset, StockMovement


async def settle_lines(db, order_id: int, lines, *, actor_staff_id: int | None = None) -> int:
    """Take the order's units off the shelf for good: reserved -> sold, one -1 movement each.

    Returns how many units moved. A line with no asset (a product-only line) is skipped - it names
    no serial, so there is no unit to settle.
    """
    moved = 0
    for l in lines:
        if l.asset_id is None:
            continue
        asset = await db.get(Asset, l.asset_id)
        if asset is not None and asset.status in ("reserved", "listed"):
            asset.status = "sold"
        db.add(StockMovement(asset_id=l.asset_id, qty=-1, reason="sale",
                             actor_staff_id=actor_staff_id))
        await db.execute(text("UPDATE reservations SET status='converted'"
                              " WHERE asset_id = :i AND status IN ('active','confirmed')"),
                         {"i": l.asset_id})
        moved += 1
    return moved


async def return_lines(db, order_id: int, lines, *, reason: str,
                        actor_staff_id: int | None = None) -> int:
    """Give the order's units back: reserved -> listed, sold/shipped -> returned. One +1 each.

    The two destinations are the state machine's, not a preference: a unit that was only RESERVED
    was never sold, so it goes straight back on the shelf; a unit that was SOLD comes back as
    `returned` and must be re-tested and re-graded before it can be listed again (see the module
    docstring). `reason` names the ledger entry - "order_cancelled" or "order_refunded" - so the
    stock ledger distinguishes a cancellation that never shipped from a refund of one that did.
    """
    moved = 0
    for l in lines:
        if l.asset_id is None:
            continue
        asset = await db.get(Asset, l.asset_id)
        if asset is not None:
            if asset.status == "reserved":
                asset.status = "listed"
            elif asset.status in ("sold", "shipped"):
                asset.status = "returned"
        db.add(StockMovement(asset_id=l.asset_id, qty=1, reason=reason,
                             actor_staff_id=actor_staff_id))
        await db.execute(text("UPDATE reservations SET status='released'"
                              " WHERE asset_id = :i AND status IN ('active','confirmed')"),
                         {"i": l.asset_id})
        moved += 1
    return moved
