"""One value set for "which role may drive which chat action" - the drift alarm.

`staff_ai.chat` dispatches into `staff_ops` handlers as PLAIN FUNCTION CALLS, so the routes'
`Depends(require_roles(...))` never evaluates on that path and the chat allow-list was the real
gate. It was more permissive than the doors it called for two actions:

    chat action        chat TOOL_ROLES before the fix          door
    test               admin, manager, warehouse, technician   admin, manager, warehouse
    list               admin, manager, sales                   admin, manager, warehouse

so a technician could drive received->tested through chat and a sales user could make a graded
unit publicly buyable through chat, while the direct endpoint would 403 either. The allow-list was
aligned DOWN to the door: `staff_ai.TOOL_ROLES` now derives from the `staff_ops` constants, each
handler re-checks its tuple in its own body, and this file is what makes a re-widening of any of
the three surfaces fail loudly.

Hermetic and model-free: it reads two dicts and calls handlers that refuse before touching a db.

ADR 0008 decision 9 adds a second way past the in-body guard - an enabled agent grant for the action
the handler performs - and the same drift alarm covers it: a grant can only name an action a guarded
door performs (`staff_ops.GUARDED_ACTIONS`), and that set is pinned equal to `TOOL_ROLES` here. The
grant branch itself is probed in tests/test_autonomy_execute.py, which owns the DB side.
"""
import pytest
from fastapi import HTTPException

from app.api.v1 import staff_ai, staff_ops
from app.api.v1.staff_ops import GradeIn, LotIn, MoveIn, PriceIn, ScanIn, StatusIn

# Every chat action -> (the staff_ops tuple it must dispatch under, the frozen role set).
# The frozen literals are deliberate: this table IS the contract, so re-widening the chat
# allow-list OR the door's guard turns this test red, not merely a mismatch between the two.
CHAT_ACTION_DOORS = {
    "activate_lot": (staff_ops.ROLES_ACTIVATE_LOT, ("admin", "manager")),
    "create_lot": (staff_ops.ROLES_CREATE_LOT, ("admin", "manager", "warehouse")),
    "scan_in": (staff_ops.ROLES_SCAN_IN, ("admin", "manager", "warehouse", "technician")),
    "test": (staff_ops.ROLES_SET_STATUS, ("admin", "manager", "warehouse")),
    "grade": (staff_ops.ROLES_GRADE, ("admin", "manager", "technician")),
    "price": (staff_ops.ROLES_PRICE, ("admin", "manager", "sales")),
    "list": (staff_ops.ROLES_SET_STATUS, ("admin", "manager", "warehouse")),
    "move": (staff_ops.ROLES_MOVE, ("admin", "manager", "warehouse")),
}

# (handler, positional args, a role the chat allow-list used to grant it to) - the two rows whose
# role is the escalation this job closed are staff_ops.set_status as `test` (technician) and as
# `list` (sales); the rest keep the sweep honest. `db` is None on purpose: the in-body guard must
# refuse before anything reaches the database.
PLAIN_CALL_DENIALS = (
    (staff_ops.create_lot, (LotIn(warehouse="WH-A"),), "technician"),
    (staff_ops.activate_lot, (1,), "warehouse"),
    (staff_ops.scan_in, (ScanIn(serial_number="pytest-x", lot_number="LOT-2026-0002"),), "sales"),
    (staff_ops.set_status, (1, StatusIn(status="tested")), "technician"),
    (staff_ops.set_status, (1, StatusIn(status="listed")), "sales"),
    (staff_ops.grade, (1, GradeIn(grade="A")), "sales"),
    (staff_ops.set_price, (1, PriceIn(sale_price_cents=100)), "technician"),
    (staff_ops.move, (1, MoveIn(location="WH-A-01-01")), "technician"),
)


def test_chat_tool_roles_derive_from_ops_doors():
    """``staff_ai.TOOL_ROLES`` must BE the tuples `staff_ops` guards its endpoints with.

    Not a parallel copy: `is` pins the derivation (a future literal fails), and the frozen
    literal pins the value (a future widening of either side fails). `test` and `list` share
    `staff_ops.ROLES_SET_STATUS` because both dispatch into the same `set_status` door.
    """
    assert set(staff_ai.TOOL_ROLES) == set(CHAT_ACTION_DOORS)
    for action, (door, frozen) in CHAT_ACTION_DOORS.items():
        assert staff_ai.TOOL_ROLES[action] is door, action            # derived, not copied
        assert staff_ai.TOOL_ROLES[action] == door == frozen, action  # and still the frozen set


def test_the_grantable_action_set_is_the_rails_own_action_set():
    """ADR 0008 decision 9's closure obligation, as a drift alarm.

    The grant branch lets an agent past the in-body guard, so what a grant can NAME has to be
    exactly what a guarded door PERFORM - no wider, and no door left out. `GUARDED_ACTIONS` is the
    set `staff_ops._require_role` will look a grant up against (an action outside it is refused
    without a query, whatever the table says), and each name is passed by the handler that performs
    it, never by a caller. Equality against TOOL_ROLES therefore pins both directions: a new
    dispatchable action with no door to guard it fails here, and a new door whose action name is
    missing from the set fails too.
    """
    assert staff_ops.GUARDED_ACTIONS == frozenset(staff_ai.TOOL_ROLES)
    assert set(CHAT_ACTION_DOORS) == set(staff_ops.GUARDED_ACTIONS)
    # the two names one door answers to, spelled out: set_status derives them from the status it
    # writes, so the mapping is part of the contract and not an implementation detail
    assert staff_ops._STATUS_ACTIONS == {"tested": "test", "listed": "list"}


async def test_ops_handlers_guard_their_own_body():
    """Called the way the chat door calls them - plain functions, no FastAPI - they still refuse.

    This is the structural half: the route's `Depends` is skipped by a plain call, so the body
    has to carry the check. Each handler raises 403 for a role its door does not allow, without a
    database session, which is exactly the ordering that keeps a refusal from writing anything.
    """
    for handler, args, role in PLAIN_CALL_DENIALS:
        with pytest.raises(HTTPException) as ei:
            await handler(*args, {"id": 0, "email": "pytest@test.rfo", "role": role}, None)
        assert ei.value.status_code == 403, (handler.__name__, role)
