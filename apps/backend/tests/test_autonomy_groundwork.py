"""Autonomy groundwork (ADR 0008 preconditions 3+5): the grants ledger's shape, the ChatIn
bounds, and the door that must NOT move.

The grants table is asserted on two levels. The SHAPE tests read the catalogue and pin the exact
contract (columns, identity PK, both CHECKs with their exact value lists, the UNIQUE triple) - they
fail if a later migration quietly alters any of it. The FIXTURE probes then insert and violate live,
each in a transaction that rolls back, so they prove the constraints constrain and leave nothing on
the shared dev DB.

Nothing here executes an autonomous action: the table is inert, there is no lookup to test, and the
last test pins why that matters - with the new bounds in place, an agent identity's execute turn is
STILL a 403 before any dispatch happens. The live-delta half of that regression (storefront and
ledger unmoved) stays with tests/test_agent_identity.py, which owns it.
"""
import json
import uuid

import pytest
import pytest_asyncio
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.api.v1 import staff_ai
from app.bootstrap_staff import bootstrap
from app.core.db import get_engine
from tests.test_agent_identity import _mint


async def _cleanup():
    """agent_tokens first (FK child of staff_users), then the identity rows; autonomy_grants has
    no FK to anything, but its insurance delete costs nothing on a shared dev DB."""
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM autonomy_grants WHERE action LIKE 'pytest-%'"))
        await c.execute(text("DELETE FROM agent_tokens WHERE staff_id IN "
                             "(SELECT id FROM staff_users WHERE email LIKE 'pytest-%')"))
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                             "(SELECT id FROM staff_users WHERE email LIKE 'pytest-%')"))
        await c.execute(text("DELETE FROM staff_users WHERE email LIKE 'pytest-%'"))
        await c.execute(text("DELETE FROM users WHERE email LIKE 'pytest-%'"))


@pytest_asyncio.fixture(autouse=True)
async def _clean_groundwork(client):
    """Depends on `client` so teardown runs while the loop and engine are still alive."""
    await _cleanup()
    yield
    await _cleanup()


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def _token(client, role: str = "admin") -> str:
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    _, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


# ----------------------------------------------------------------- table shape

async def test_grants_table_columns():
    """The exact column contract of spec deliverable 1, read from the catalogue."""
    eng = get_engine()
    async with eng.connect() as c:
        rows = (await c.execute(text(
            "SELECT column_name, data_type, is_nullable, column_default, is_identity"
            " FROM information_schema.columns WHERE table_name = 'autonomy_grants'"
            " ORDER BY ordinal_position"))).mappings().all()
    got = {r["column_name"]: (r["data_type"], r["is_nullable"], r["column_default"], r["is_identity"])
           for r in rows}
    assert got == {
        "id": ("bigint", "NO", None, "YES"),
        "identity_type": ("text", "NO", None, "NO"),
        "identity_id": ("bigint", "NO", None, "NO"),
        "action": ("text", "NO", None, "NO"),
        "action_class": ("text", "NO", None, "NO"),
        "daily_cap": ("integer", "NO", None, "NO"),
        "enabled": ("boolean", "NO", "false", "NO"),
        "created_at": ("timestamp with time zone", "NO", "now()", "NO"),
    }


async def test_grants_constraints():
    """PK on id, the two CHECKs with their exact value lists, the UNIQUE triple - pinned by
    constraint name and definition, so a widened or narrowed list fails loudly rather than
    drifting."""
    eng = get_engine()
    async with eng.connect() as c:
        rows = (await c.execute(text(
            "SELECT conname, contype, pg_get_constraintdef(oid) AS def FROM pg_constraint"
            " WHERE conrelid = 'autonomy_grants'::regclass"))).all()
    bytype: dict[str, list] = {}
    for name, contype, condef in rows:
        if isinstance(contype, bytes):                      # pg "char" arrives as b'c' via asyncpg
            contype = contype.decode()
        bytype.setdefault(contype, []).append((name, condef))
    assert sorted(bytype) == ["c", "p", "u"]
    checks = dict(bytype["c"])
    assert "identity_type = ANY (ARRAY['agent'::text, 'staff_user'::text])" in \
        checks["autonomy_grants_identity_type_check"]
    assert "action_class = ANY (ARRAY['inventory'::text, 'outward'::text])" in \
        checks["autonomy_grants_action_class_check"]
    assert dict(bytype["p"]) == {"autonomy_grants_pkey": "PRIMARY KEY (id)"}
    assert dict(bytype["u"]) == {"autonomy_grants_identity_type_identity_id_action_key":
                                 "UNIQUE (identity_type, identity_id, action)"}


# ----------------------------------------------------------------- fixture probes (all rolled back)

async def test_grants_row_defaults_and_uniques():
    """enabled defaults false, created_at defaults now(); the UNIQUE triple refuses the pair twice."""
    eng = get_engine()
    async with eng.connect() as c:
        row = (await c.execute(text(
            "INSERT INTO autonomy_grants (identity_type, identity_id, action, action_class, daily_cap)"
            " VALUES ('agent', 424242, 'pytest-shape', 'inventory', 5)"
            " RETURNING enabled, created_at"))).mappings().one()
        assert row["enabled"] is False
        assert row["created_at"] is not None
        with pytest.raises(IntegrityError):
            await c.execute(text(
                "INSERT INTO autonomy_grants (identity_type, identity_id, action, action_class, daily_cap)"
                " VALUES ('agent', 424242, 'pytest-shape', 'outward', 9)"))
        await c.rollback()


async def test_grants_identity_type_check_constrains():
    eng = get_engine()
    with pytest.raises(IntegrityError):
        async with eng.begin() as c:
            await c.execute(text(
                "INSERT INTO autonomy_grants (identity_type, identity_id, action, action_class, daily_cap)"
                " VALUES ('robot', 424242, 'pytest-shape', 'inventory', 5)"))


async def test_grants_action_class_check_constrains():
    eng = get_engine()
    with pytest.raises(IntegrityError):
        async with eng.begin() as c:
            await c.execute(text(
                "INSERT INTO autonomy_grants (identity_type, identity_id, action, action_class, daily_cap)"
                " VALUES ('agent', 424242, 'pytest-shape', 'sideways', 5)"))


# ----------------------------------------------------------------- ChatIn bounds

def test_chatin_bounds_hold_at_the_schema():
    """The ceilings are inclusive: exactly-40 action and exactly-4000 serialized args pass;
    one char over either refuses at model construction, before any endpoint code runs."""
    staff_ai.ChatIn(message="x", action="a" * 40, args={"pad": "x" * 3989})   # dumps == 4000 exactly
    assert len(json.dumps({"pad": "x" * 3989})) == 4000
    with pytest.raises(ValidationError):
        staff_ai.ChatIn(message="x", action="a" * 41)
    with pytest.raises(ValidationError):
        staff_ai.ChatIn(message="x", args={"pad": "x" * 3990})                # dumps == 4001


async def test_chat_action_over_40_chars_is_422(client):
    tok = await _token(client)
    r = await client.post("/staff/ai/chat", headers=_h(tok), json={
        "message": "run it", "execute": True, "action": "a" * 41, "args": {}})
    assert r.status_code == 422, r.text


async def test_chat_args_over_the_serialized_ceiling_is_422(client):
    tok = await _token(client)
    r = await client.post("/staff/ai/chat", headers=_h(tok), json={
        "message": "run it", "execute": True, "action": "list",
        "args": {"serial_number": "x", "pad": "y" * 4000}})
    assert r.status_code == 422, r.text


# ----------------------------------------------------------------- the door stays propose-only

async def test_agent_execute_still_refused_403(client):
    """With the bounded schema in place the agent door is UNCHANGED: a schema-valid execute turn
    from an agent identity is refused before any dispatch. The storefront/ledger delta assertions
    live in tests/test_agent_identity.py and must stay green alongside this."""
    admin = _h(await _token(client, "admin"))
    _, tok = await _mint(client, admin)
    r = await client.post("/staff/agents/chat", headers=_h(tok), json={
        "message": "list SERIAL-1", "execute": True, "action": "list",
        "args": {"serial_number": "SERIAL-1"}})
    assert r.status_code == 403, r.text
    assert "propose-only" in r.json()["detail"]
