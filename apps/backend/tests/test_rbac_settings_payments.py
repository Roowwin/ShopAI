"""The safety net, part two: the Settings and Payment doors, swept against a plain staff identity.

Two doors carry the platform's authority rather than its stock, and both are admin/manager
surfaces today:

  * SETTINGS is the platform's own configuration - the `site_settings` row the storefront's hero
    reads, the promotions table the shop's badges come from, the model-entry writes the CMS page
    makes, and the one `/staff/admin/*` scaffold door. Writing any of it changes what every
    shopper sees.
  * PAYMENT is the money surface - the order and customer views that carry totals, payment
    provider references and customer PII.

This file is the net under the claim that a plain staff identity cannot reach either. The claim
is only worth as much as its weakest door, so this is a SWEEP with a live leg per door rather than
one status assertion on a representative route: a wall that answers 403 to everybody passes a
refusal test and is still a broken door, so every probe is paired with an admin call that must NOT
be refused.

Three credentials are tried against each door: none at all (401), a customer bearer (401/403 -
another zone's token is not a staff token), and a `sales`, `warehouse` and `technician` staff
identity (403 each). Those are the three roles that share the building with admin and manager
without sharing their authority, and the mission's "a Staff user" is precisely one of them.

Two properties make the sweep safe to run against the live dev database:

  * The WRITE probes cannot write even if the wall they are testing is missing. Each carries a
    body its own validation refuses - an empty id list, an unknown promotion kind - so a door with
    no guard answers 422 having written nothing. That also sharpens the assertion: 403 is the
    guard running first, 422 is the guard not running at all, and the two are distinguishable.
  * The one write that would land unconditionally is the settings PUT, so it is probed with the
    value the door already holds: a leaked write is a no-op by construction, and there is nothing
    to restore. Reading that snapshot is the only setup this file needs.

Everything else is read-only and data-free: the probes name ids past every row and offsets past
every page, so a wall that failed reports itself without exposing a real order, customer or
setting. The only rows created are this file's own identities, removed in a finally.
"""

import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine

# The roles that share the building with admin and manager but not their authority. `sales` is the
# plainest of them - it prices stock, so it is the identity most likely to be assumed to reach the
# rest of the portal - and the sweep keeps the other two so a wall narrowed to "not sales" cannot
# pass.
STAFF_ROLES = ("sales", "warehouse", "technician")

# The configuration surface. Bodies are chosen so that a door with NO guard fails validation
# instead of writing: `ids: []` is refused by the group-write's own non-empty check, and an unknown
# promotion kind by its own vocabulary. The settings PUT's body is filled in at run time with the
# value the row already holds.
SETTINGS = (
    ("GET", "/staff/cms/home", None),
    ("PUT", "/staff/cms/home", "SNAPSHOT"),
    ("GET", "/staff/cms/promotions", None),
    ("POST", "/staff/cms/promotions", {"kind": "pytest-probe"}),
    ("GET", "/staff/cms/products", None),
    ("PATCH", "/staff/cms/products", {"ids": []}),
    # Admin-only, stricter than the CMS pair beside it: the scaffold that proves the role gate
    # exists at all. A manager is refused here too, which is why only the admin leg is live.
    ("GET", "/staff/admin/ping", None),
)

# The money surface. Both list doors are probed past the last page so the admin leg reads an empty
# page - the payload cannot be proof of anything if the probe had real rows to leak.
PAYMENTS = (
    ("GET", "/staff/orders", {"limit": 1, "offset": 1_000_000}),
    ("GET", "/staff/orders/999999999999", None),
    ("GET", "/staff/customers", {"limit": 1, "offset": 1_000_000}),
    ("GET", "/staff/customers/999999999999", None),
)


# --------------------------------------------------------------------------- helpers

def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def _staff(client, role: str) -> str:
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    sid, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def _cleanup():
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                             "(SELECT id FROM staff_users WHERE email LIKE 'pytest-%')"))
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                             "(SELECT id FROM users WHERE email LIKE 'pytest-%')"))
        await c.execute(text("DELETE FROM staff_users WHERE email LIKE 'pytest-%'"))
        await c.execute(text("DELETE FROM users WHERE email LIKE 'pytest-%'"))


async def _customer(client) -> dict:
    """A real shopper: another zone's token, which every staff door must refuse."""
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    r = await client.post("/store/auth/register", json={"email": email, "password": "Str0ngPass!23",
                                                       "display_name": "Pytest shopper"})
    assert r.status_code == 200, r.text
    r = await client.post("/store/auth/login", json={"email": email, "password": "Str0ngPass!23"})
    assert r.status_code == 200, r.text
    return _h(r.json()["access_token"])


def _empty_page(body) -> bool:
    """True when a paged read returned its one list, empty - i.e. the probe leaked nothing."""
    if not isinstance(body, dict):
        return False
    lists = [v for v in body.values() if isinstance(v, list)]
    return len(lists) == 1 and lists[0] == []


# --------------------------------------------------------------------------- the sweeps

async def test_a_staff_user_cannot_reach_the_settings_doors(client):
    """Every configuration door: 401 naked, 401/403 to a shopper, 403 to each staff role, live for
    an admin - and the admin leg is what proves the sweep is testing a door rather than a wall.
    """
    await _cleanup()
    bad: list[tuple] = []
    try:
        admin = _h(await _staff(client, "admin"))
        customer = await _customer(client)
        staff = {role: await _staff(client, role) for role in STAFF_ROLES}

        # The settings PUT is probed with the value it already holds, so a door that leaked would
        # rewrite its own contents rather than someone's hero copy. Read it through the same gate
        # the probe uses, so the snapshot is exactly what a PUT would have to accept.
        r = await client.request("GET", "/staff/cms/home", headers=admin)
        assert r.status_code == 200, r.text
        live = r.json()
        probes = [(m, p, live if b == "SNAPSHOT" else b) for m, p, b in SETTINGS]

        for method, path, body in probes:
            r = await client.request(method, path, json=body)             # no credential
            if r.status_code != 401:
                bad.append((method, path, "no credential", r.status_code, r.text[:60]))
            r = await client.request(method, path, json=body, headers=customer)
            if r.status_code not in (401, 403):
                bad.append((method, path, "customer bearer", r.status_code, r.text[:60]))
            for role in STAFF_ROLES:
                r = await client.request(method, path, json=body, headers=_h(staff[role]))
                if r.status_code != 403:
                    bad.append((method, path, f"{role} staff", r.status_code, r.text[:60]))
            r = await client.request(method, path, json=body, headers=admin)
            if r.status_code in (401, 403):
                bad.append((method, path, "admin", r.status_code, r.text[:60]))
        assert not bad, bad
    finally:
        await _cleanup()


async def test_a_staff_user_cannot_reach_the_payment_doors(client):
    """The order and customer views - totals, provider references and PII - are admin/manager.

    The admin leg asserts "not refused", not "200", because the detail probes name an id past
    every row and a correct door answers 404 there; pinning 200 would make this a test of the
    fixture. The two list doors additionally have to come back EMPTY for an admin, which is what
    proves the probe had no real rows to leak in the first place.
    """
    await _cleanup()
    bad: list[tuple] = []
    try:
        admin = _h(await _staff(client, "admin"))
        customer = await _customer(client)
        staff = {role: await _staff(client, role) for role in STAFF_ROLES}

        for method, path, params in PAYMENTS:
            r = await client.get(path, params=params)
            if r.status_code != 401:
                bad.append((path, "no credential", r.status_code, r.text[:60]))
            r = await client.get(path, params=params, headers=customer)
            if r.status_code not in (401, 403):
                bad.append((path, "customer bearer", r.status_code, r.text[:60]))
            for role in STAFF_ROLES:
                r = await client.get(path, params=params, headers=_h(staff[role]))
                if r.status_code != 403:
                    bad.append((path, f"{role} staff", r.status_code, r.text[:60]))
            r = await client.get(path, params=params, headers=admin)
            if r.status_code in (401, 403):
                bad.append((path, "admin", r.status_code, r.text[:60]))
            elif params is not None and not _empty_page(r.json()):
                bad.append((path, "probe not data-free", r.status_code, r.text[:80]))
        assert not bad, bad
    finally:
        await _cleanup()


async def test_a_staff_bearer_is_not_a_customer_at_the_payment_intent_door(client):
    """Checkout is the customer zone's payment door, and a staff token is another zone's credential.

    Three legs pin the exact rule, so that "fixing" it cannot mean requiring a login the shop does
    not want: a GUEST (no bearer at all) reaches the handler - checkout is open to shoppers without
    an account - a customer reaches it too, and only a STAFF bearer is refused, because the door
    decodes the customer token type and a staff token is not one.

    The unit named is past every asset id, so neither the guest nor the customer leg can create an
    order: both are refused by the door's own availability check, which is what the 409 says. If
    the staff wall ever failed, the same 409 is what the staff leg would get - no order, no
    payment, and a red test.
    """
    await _cleanup()
    try:
        body = {"asset_ids": [999_999_999_999], "shipping_country": "AU",
                "ship_to_name": "Pytest probe", "ship_line1": "1 Test St", "ship_city": "Sydney",
                "ship_postcode": "2000"}
        r = await client.post("/store/checkout", json=body)
        assert r.status_code == 409, r.text                       # a guest is meant to get through
        r = await client.post("/store/checkout", json=body, headers=await _customer(client))
        assert r.status_code == 409, r.text                       # and so is a real shopper

        for role in ("admin", *STAFF_ROLES):
            r = await client.post("/store/checkout", json=body, headers=_h(await _staff(client, role)))
            assert r.status_code == 401, f"{role} reached the payment door: {r.status_code} {r.text}"
    finally:
        await _cleanup()
