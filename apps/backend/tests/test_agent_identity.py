"""Agent identity rail (ADR 0007): the identity class, its walls, and the print-once token.

Everything here is asserted live against the real DB, and the two halves of the wall are asserted
together on purpose: an agent bearer is 401 on every staff read (STAFF_READS is IMPORTED, so this
file cannot drift from the wall sweep) and on the store wall, while the same bearer is accepted on
the assistant surface alone. A wall test that only proves refusals would also pass if the token were
never valid anywhere, so test_agent_token_authenticates_on_the_assistant_surface is the control.

The plaintext is printed once: the DB row holds a SHA-256 and this file asserts the plaintext does
not appear anywhere in it.
"""
import hashlib
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.bootstrap_staff import bootstrap
from app.core import security
from app.core.db import get_engine
from tests.test_staff_read_walls import STAFF_READS


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def _cleanup():
    """Remove this file's identities. agent_tokens first: it is the FK child of staff_users, so
    leaving a row behind would make every sibling file's `DELETE ... staff_users ... pytest-%`
    fail with a foreign-key error."""
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM agent_tokens WHERE staff_id IN "
                             "(SELECT id FROM staff_users WHERE email LIKE 'pytest-%')"))
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                             "(SELECT id FROM staff_users WHERE email LIKE 'pytest-%')"))
        await c.execute(text("DELETE FROM staff_users WHERE email LIKE 'pytest-%'"))
        await c.execute(text("DELETE FROM users WHERE email LIKE 'pytest-%'"))


@pytest_asyncio.fixture(autouse=True)
async def _clean_agents(client):
    """Depends on `client` on purpose: that orders teardown so this cleanup runs while the event
    loop and the engine the conftest fixture disposes are still alive."""
    await _cleanup()
    yield
    await _cleanup()


async def _staff(client, role: str = "admin") -> dict:
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    _, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return _h(r.json()["access_token"])


async def _mint(client, admin: dict, name: str = "hermes-ops-1") -> tuple[int, str]:
    r = await client.post("/staff/agents", json={"name": name}, headers=admin)
    assert r.status_code == 200, r.text
    j = r.json()
    return j["id"], j["token"]


async def _chat(client, tok: str):
    return await client.post("/staff/agents/chat", json={"message": "hello"}, headers=_h(tok))


async def _a_graded_serial() -> str:
    """A real, resolvable serial: the execute probe must name something a slipped gate could
    actually publish, or "zero deltas" would be vacuous."""
    eng = get_engine()
    async with eng.connect() as c:
        return (await c.execute(text(
            "SELECT serial_number FROM assets WHERE status = 'graded' ORDER BY id LIMIT 1"))).scalar_one()


async def _publish_deltas() -> tuple[int, int]:
    """(units on the storefront, audit rows recording a publish) - what a slipped execute moves."""
    eng = get_engine()
    async with eng.connect() as c:
        listed = (await c.execute(text("SELECT count(*) FROM assets WHERE status = 'listed'"))).scalar_one()
        published = (await c.execute(text(
            "SELECT count(*) FROM audit_log WHERE action IN ('list', 'price')"))).scalar_one()
    return listed, published


# ---------------------------------------------------------------- the wall

async def test_agent_token_is_401_on_every_staff_read(client):
    """The third class, per route: every entry in STAFF_READS refuses an agent bearer.

    STAFF_READS is imported rather than re-listed, so a staff read added later is swept here
    automatically. 401 (not 403) is the point: get_staff decodes typ="staff" only, so the agent
    token never reaches a role check - it is not a staff credential at all.
    """
    admin = await _staff(client, "admin")
    _, tok = await _mint(client, admin)
    leaked = []
    for path, params in STAFF_READS:
        r = await client.get(path, params=params, headers=_h(tok))
        if r.status_code != 401:
            leaked.append((path, r.status_code))
    assert not leaked, leaked


async def test_agent_token_is_401_on_the_store_wall_and_the_staff_chat_door(client):
    """Rejected on the customer zone, and on the staff chat door it must NOT be able to use.

    /store/me is the customer's own door (typ="customer"); the last probe is the staff assistant at
    its existing path, which stays closed to agents - the agent's door is its own route.
    """
    admin = await _staff(client, "admin")
    _, tok = await _mint(client, admin)
    r = await client.get("/store/me", headers=_h(tok))
    assert r.status_code == 401, r.text
    r = await client.post("/staff/ai/chat", json={"message": "hello"}, headers=_h(tok))
    assert r.status_code == 401, r.text


async def test_a_staff_token_is_401_on_the_agent_mirror(client):
    """The mirror is the AGENT door, so a real staff credential is not accepted there either."""
    admin = await _staff(client, "admin")
    r = await client.post("/staff/agents/chat", json={"message": "hello"}, headers=admin)
    assert r.status_code == 401, r.text


async def test_agent_token_authenticates_on_the_assistant_surface(client):
    """The control for the two walls above: the same bearer IS accepted, on the assistant surface."""
    admin = await _staff(client, "admin")
    aid, tok = await _mint(client, admin)
    r = await _chat(client, tok)
    assert r.status_code == 200, r.text
    assert r.json().get("type") in ("answer", "proposed"), r.json()
    # and it really is an agent identity behind that call, not a staff session
    assert int(security.decode_access(tok, "agent")["sub"]) == aid


async def test_agent_execute_is_refused_and_moves_nothing(client):
    """The blocking finding, still pinned: an agent token cannot drive an execute turn by naming one.

    This is the one that matters. The chat door dispatches into staff_ops as plain function calls
    (the route's Depends never evaluates), agent_tokens.staff_id is the CREATING ADMIN's id, and
    every TOOL_ROLES tuple contains admin - so if the mirror delegated the sponsor's role, this
    exact request would publish a real unit on the storefront with no grant and no cap, audited as
    the admin's own action.

    What changed with ADR 0008 decision 8 is the SHAPE of the refusal, not the property: an agent
    execute turn may only name a `proposal_id` the server stored, so a turn carrying a client-chosen
    action + args is a 422 rather than a 403, and the storefront and the ledger stay unmoved either
    way. The granted path - the one that really does execute - is
    `tests/test_autonomy_execute.py`, which the ADR requires be a separate, explicit test rather
    than a weakening of this one.
    """
    admin = await _staff(client, "admin")
    _, tok = await _mint(client, admin)
    serial = await _a_graded_serial()
    before = await _publish_deltas()

    r = await client.post("/staff/agents/chat", headers=_h(tok), json={
        "message": "list " + serial, "execute": True, "action": "list",
        "args": {"serial_number": serial}})
    assert r.status_code == 422, r.text
    assert await _publish_deltas() == before

    eng = get_engine()
    async with eng.connect() as c:
        status = (await c.execute(text("SELECT status FROM assets WHERE serial_number = :s"),
                                  {"s": serial})).scalar_one()
    assert status == "graded", (serial, status)


async def test_agent_propose_still_works(client):
    """The other half of that finding: closing execute must not close propose.

    The phrasing is the one scripts/rehearse_day.py drives its staff proposals with ("grade serial
    {serial} as B"), so this is the same request shape a rehearsal scores as a proposal.
    """
    admin = await _staff(client, "admin")
    _, tok = await _mint(client, admin)
    serial = await _a_graded_serial()
    r = await client.post("/staff/agents/chat", headers=_h(tok),
                          json={"message": "grade serial " + serial + " as B"})
    assert r.status_code == 200, r.text
    assert r.json().get("type") == "proposed", r.json()
    assert r.json().get("action") == "grade", r.json()


# ---------------------------------------------------------------- the token lifecycle

async def test_create_prints_the_token_once_and_the_row_keeps_only_a_hash(client):
    admin = await _staff(client, "admin")
    aid, tok = await _mint(client, admin, "hermes-ops-2")
    assert tok and len(tok) > 20

    eng = get_engine()
    async with eng.connect() as c:
        row = (await c.execute(text("SELECT * FROM agent_tokens WHERE id = :i"), {"i": aid})).mappings().one()
    assert tok not in " ".join(str(v) for v in row.values())
    assert row["token_hash"] == hashlib.sha256(tok.encode()).hexdigest()
    assert row["revoked_at"] is None and row["scopes"] == []

    # the listing shows the identity and never the secret
    r = await client.get("/staff/agents", headers=admin)
    assert r.status_code == 200, r.text
    assert tok not in r.text
    row = next(a for a in r.json()["agents"] if a["id"] == aid)
    assert row["name"] == "hermes-ops-2" and row["active"] is True


async def test_rotate_kills_the_previous_token_and_prints_the_new_one_once(client):
    admin = await _staff(client, "admin")
    aid, old = await _mint(client, admin)
    assert (await _chat(client, old)).status_code == 200

    r = await client.post("/staff/agents/" + str(aid) + "/rotate", headers=admin)
    assert r.status_code == 200, r.text
    new = r.json()["token"]
    assert new != old

    assert (await _chat(client, old)).status_code == 401
    assert (await _chat(client, new)).status_code == 200
    eng = get_engine()
    async with eng.connect() as c:
        stored = (await c.execute(text("SELECT token_hash FROM agent_tokens WHERE id = :i"), {"i": aid})).scalar_one()
    assert stored == hashlib.sha256(new.encode()).hexdigest()
    assert stored != hashlib.sha256(old.encode()).hexdigest()


async def test_revoke_stops_the_current_token_at_once(client):
    admin = await _staff(client, "admin")
    aid, tok = await _mint(client, admin)
    assert (await _chat(client, tok)).status_code == 200

    r = await client.post("/staff/agents/" + str(aid) + "/revoke", headers=admin)
    assert r.status_code == 200, r.text
    assert (await _chat(client, tok)).status_code == 401
    # revocation is not undone by rotating
    r = await client.post("/staff/agents/" + str(aid) + "/rotate", headers=admin)
    assert r.status_code == 409, r.text


async def test_agent_management_is_admin_only(client):
    admin = await _staff(client, "admin")
    aid, _ = await _mint(client, admin)
    sales = await _staff(client, "sales")
    probes = [("GET", "/staff/agents", None),
              ("POST", "/staff/agents", {"name": "nope"}),
              ("POST", "/staff/agents/" + str(aid) + "/rotate", None),
              ("POST", "/staff/agents/" + str(aid) + "/revoke", None)]
    bad = []
    for method, path, payload in probes:
        r = await client.request(method, path, json=payload, headers=sales)
        if r.status_code != 403:
            bad.append((method, path, r.status_code))
    assert not bad, bad
    # and the missing-credential leg, which the STAFF_READS sweep also covers
    assert (await client.get("/staff/agents")).status_code == 401


async def test_agent_lifecycle_needs_a_credential_at_all(client):
    assert (await client.post("/staff/agents", json={"name": "nope"})).status_code == 401
    assert (await client.post("/staff/agents/1/rotate")).status_code == 401
    assert (await client.post("/staff/agents/1/revoke")).status_code == 401
    assert (await client.post("/staff/agents/chat", json={"message": "hello"})).status_code == 401


# ---------------------------------------------------------------- the audit capability

async def test_audit_check_admits_agent_and_still_holds_every_original_value(client):
    """The ADR 0008 decision 5 marker: actor_type='agent' is writable, and nothing was lost.

    Written as an insert-and-read-back for each value the CHECK admits, inside a transaction that is
    rolled back - audit_log is append-only for the app role, and this test must not add rows to the
    ledger. Every ORIGINAL value is asserted too: the migration DROPs and re-ADDs these constraints,
    so a re-ADD that forgot 'customer' would break existing rows silently, and this is the test that
    catches it.
    """
    eng = get_engine()
    async with eng.connect() as c:
        for value in ("staff", "system", "customer", "agent"):
            got = (await c.execute(text(
                "INSERT INTO audit_log (actor_type, entity, action) VALUES (:t, 'agents', 'pytest_check')"
                " RETURNING actor_type"), {"t": value})).scalar_one()
            assert got == value
        # the constraint still constrains: an unknown class is refused
        with pytest.raises(IntegrityError):
            await c.execute(text(
                "INSERT INTO audit_log (actor_type, entity, action) VALUES ('robot', 'agents', 'pytest_check')"))
        await c.rollback()

    async with eng.connect() as c:
        left = (await c.execute(text(
            "SELECT count(*) FROM audit_log WHERE entity = 'agents' AND action = 'pytest_check'"))).scalar_one()
    assert left == 0
