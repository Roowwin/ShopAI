"""Read walls: every GET under /staff/* must refuse a caller who is not a staff user.

Job 7 found three staff reads with no auth dependency at all - GET /staff/lots,
GET /staff/assets and GET /staff/movements answered 200 to a customer bearer and to no bearer at
all, handing out lot numbers, serials, grades and storage locations. This file is the wall around
them, and the sweep that makes sure they were the only three.

Read-only and data-free: every probe is aimed at a lot or an id that does not exist, so a probe
that leaks returns an empty list instead of someone's inventory, and a probe aimed at the wrong
door cannot write. The only rows these tests create are their own identities, removed in a
finally.
"""
import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine

# The three doors this job closed (staff_ops.py:161/169/185 before the fix). Each probe is
# data-free on purpose - a lot offset past every lot, a lot number that does not exist, an id
# past every identity - so a wall that fails reports itself without touching a real row.
READ_WALLS = (
    ("/staff/lots", {"limit": 1, "offset": 1_000_000}),
    ("/staff/assets", {"lot_number": "pytest-no-such-lot"}),
    ("/staff/movements", {"asset_id": 999_999_999_999}),
)
# Every GET under /staff/* - the sweep this job owes a report for, kept executable so a future
# staff read that forgets its guard fails here instead of shipping an open door. Params are
# data-free where the route filters; the bare reads are already scoped to the caller.
STAFF_READS = (
    ("/staff/me", {}),
    ("/staff/admin/ping", {}),
    ("/staff/lots", {"limit": 1, "offset": 1_000_000}),
    ("/staff/lots/worklist", {"lot_number": "pytest-no-such-lot"}),
    ("/staff/assets", {"lot_number": "pytest-no-such-lot"}),
    ("/staff/movements", {"asset_id": 999_999_999_999}),
    ("/staff/cms/home", {}),
    ("/staff/cms/promotions", {}),
    ("/staff/cms/products", {}),
    ("/staff/newsletter", {}),
    ("/staff/ai/whoami", {}),
    ("/staff/ai/status", {}),
    ("/staff/ai/briefing", {}),
    ("/staff/ai/activity", {}),
    ("/staff/ai/suggestions", {}),
    # /staff/overview lives HERE and only here. It returns an OBJECT, and test_staff_read_walls_
    # hold_for_every_read's admin leg below asserts `r.json() == []` - written for the
    # list-returning reads. Adding it to READ_WALLS would fail on a CORRECT response, so the
    # "no credential -> 401" sweep is the wall this route can honour.
    ("/staff/overview", {}),
    # Job 20's six ops views. All six return an OBJECT, so they belong HERE for the same reason
    # /staff/overview does - READ_WALLS's admin leg asserts `r.json() == []`, and every one of
    # these answers a correct 200 with a dict. The detail probes are aimed past every identity
    # (a data-free id), so this sweep cannot read a real order, customer or asset even if the
    # auth dependency one day stopped running first.
    ("/staff/orders", {"limit": 1, "offset": 1_000_000}),
    ("/staff/customers", {"limit": 1, "offset": 1_000_000}),
    ("/staff/audit", {"limit": 1, "offset": 1_000_000}),
    ("/staff/orders/999999999999", {}),
    ("/staff/customers/999999999999", {}),
    ("/staff/assets/999999999999", {}),
    # Same reason as /staff/overview: the agent listing returns an object, so only the
    # "no credential -> 401" leg applies. It is admin-only, and an AGENT token is 401 here too -
    # see tests/test_agent_identity.py, which sweeps this tuple with an agent bearer.
    ("/staff/agents", {}),
)


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def _cleanup():
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                             "(SELECT id FROM staff_users WHERE email LIKE 'pytest-%')"))
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                             "(SELECT id FROM users WHERE email LIKE 'pytest-%')"))
        await c.execute(text("DELETE FROM staff_users WHERE email LIKE 'pytest-%'"))
        await c.execute(text("DELETE FROM users WHERE email LIKE 'pytest-%'"))


async def _staff(client, role: str = "admin") -> str:
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    sid, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def test_staff_read_walls_hold_for_every_read(client):
    """Each closed read: no credential -> 401, customer bearer -> 401/403, admin -> 200.

    The admin leg asserts an empty payload, not just a status code: that is what proves the probe
    is data-free, so a regression on the wall side cannot be hidden by a probe that had no rows to
    leak in the first place.
    """
    await _cleanup()
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    bad: list[tuple] = []
    try:
        r = await client.post("/store/auth/register", json={"email": email, "password": "Str0ngPass!23",
                                                           "display_name": "Pytest shopper"})
        assert r.status_code == 200, r.text
        r = await client.post("/store/auth/login", json={"email": email, "password": "Str0ngPass!23"})
        assert r.status_code == 200, r.text
        cust = _h(r.json()["access_token"])
        admin = _h(await _staff(client, "admin"))

        for path, params in READ_WALLS:
            r = await client.get(path, params=params)
            if r.status_code != 401:
                bad.append((path, "no credential", r.status_code))
            r = await client.get(path, params=params, headers=cust)
            if r.status_code not in (401, 403):
                bad.append((path, "customer bearer", r.status_code))
            r = await client.get(path, params=params, headers=admin)
            if r.status_code != 200 or r.json() != []:
                bad.append((path, "admin", r.status_code, r.text[:60]))
        assert not bad, bad
    finally:
        await _cleanup()


async def test_staff_read_walls_enforce_the_role_gate(client):
    """A valid staff token is not enough: these reads are role-gated, like the sibling CMS reads.

    A sales staff token is real and can price units, but it reads no inventory through these
    doors - the same split /staff/cms/* and /staff/newsletter already had.
    """
    await _cleanup()
    try:
        h = _h(await _staff(client, "sales"))
        bad = []
        for path, params in READ_WALLS:
            r = await client.get(path, params=params, headers=h)
            if r.status_code != 403:
                bad.append((path, r.status_code))
        assert not bad, bad
    finally:
        await _cleanup()


async def test_every_staff_get_refuses_an_unauthenticated_caller(client):
    """The sweep, executable: all the GETs under /staff/* answer 401 with no credential.

    One of these (the three fixed ones) is the regression net for this job; the rest are the
    audit of what was already gated, so that "already gated" stays true.
    """
    leaked = []
    for path, params in STAFF_READS:
        r = await client.get(path, params=params)
        if r.status_code != 401:
            leaked.append((path, r.status_code))
    assert not leaked, leaked
