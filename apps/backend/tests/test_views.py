"""The six staff ops views - door, shape, paging, and agreement with the database.

These are the first reads in the product that hand a staff user customer PII (email, display
name), so the wall is the point: no credential -> 401, a real non-admin staff role (sales) -> 403,
admin -> 200. A 403 for `sales` rather than 401 is what proves the gate is the ROLE gate and not
merely "is there a staff token"; sales can price a unit through staff_ops and still reads nothing
here.

Where a case can be checked against the DATABASE it is, rather than against a literal that would
rot: `total` is compared to a direct SELECT, and each search filter is compared to the same ILIKE
run by hand. The detail routes need one real id each, so they read one from the DB - and the
whole file skips rather than asserts a 200 that no row could satisfy, because on an empty table a
404 is the correct answer.

Hermetic like its siblings: owns its identities (bootstrap + login, removed in a finally) and
creates no stock, no order and no customer - a read is a read, so it cannot move the numbers it
asserts.
"""
import uuid

import pytest
from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine

LIST_ROUTES = ("/staff/orders", "/staff/customers", "/staff/audit")


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


async def _one(sql: str, params: dict | None = None):
    """Run one scalar SELECT on the app DB - the other side of every cross-check here."""
    eng = get_engine()
    async with eng.connect() as c:
        return (await c.execute(text(sql), params or {})).scalar_one()


async def _row(sql: str, params: dict | None = None):
    eng = get_engine()
    async with eng.connect() as c:
        return (await c.execute(text(sql), params or {})).mappings().first()


async def _live_ids() -> tuple:
    """One real id per detail route. None means that table is empty (the caller skips)."""
    return (await _one("SELECT min(id) FROM orders"),
            await _one("SELECT min(id) FROM users"),
            await _one("SELECT min(id) FROM assets"))


async def test_views_door_is_role_gated(client):
    """Every one of the six routes: no credential -> 401, sales -> 403, admin -> 200.

    Each detail route is also probed at an id past every identity: with the gate open that must
    be a clean 404, so "200 for admin" cannot be satisfied by a handler that answers 200 to
    anything.
    """
    await _cleanup()
    try:
        order_id, customer_id, asset_id = await _live_ids()
        if None in (order_id, customer_id, asset_id):
            pytest.skip("orders/users/assets needs at least one row each for the 200 leg")

        # (path, expected admin status)
        cases: list[tuple[str, int]] = [(p, 200) for p in LIST_ROUTES]
        for tmpl, real in (("/staff/orders/{id}", order_id),
                           ("/staff/customers/{id}", customer_id),
                           ("/staff/assets/{id}", asset_id)):
            cases.append((tmpl.format(id=real), 200))
            cases.append((tmpl.format(id=1_000_000_000_000), 404))

        # Every real non-admin staff role, not just sales: warehouse and technician are staff
        # tokens too, and none of the three reads a customer or an order through this module.
        denied = {role: _h(await _staff(client, role))
                  for role in ("sales", "warehouse", "technician")}
        admin = _h(await _staff(client, "admin"))
        bad: list[tuple] = []
        for path, want in cases:
            r = await client.get(path)
            if r.status_code != 401:
                bad.append((path, "no credential", r.status_code))
            for role, h in denied.items():
                r = await client.get(path, headers=h)
                if r.status_code != 403:
                    bad.append((path, role, r.status_code))
            r = await client.get(path, headers=admin)
            if r.status_code != want:
                bad.append((path, "admin", r.status_code, r.text[:80]))
        assert not bad, bad
    finally:
        await _cleanup()


async def test_views_payloads_are_objects_with_the_keys_the_pages_read(client):
    """Each route returns an OBJECT (not a list) and carries the keys the pages address.

    This is also the assertion that keeps these routes out of test_staff_read_walls.READ_WALLS:
    that tuple's admin leg asserts a bare empty list, which no correct response here can be.
    """
    await _cleanup()
    try:
        admin = _h(await _staff(client, "admin"))

        j = (await client.get("/staff/orders", headers=admin)).json()
        assert isinstance(j, dict) and {"total", "orders"} <= set(j), j
        if j["orders"]:
            assert set(j["orders"][0]) == {"id", "public_id", "status", "total_cents", "currency",
                                           "placed_at", "customer_email", "item_count"}, j["orders"][0]

        j = (await client.get("/staff/customers", headers=admin)).json()
        assert isinstance(j, dict) and {"total", "customers"} <= set(j), j
        if j["customers"]:
            assert set(j["customers"][0]) == {"id", "public_id", "email", "display_name", "status",
                                              "created_at", "orders_count", "lifetime_cents"}, j["customers"][0]

        j = (await client.get("/staff/audit", headers=admin)).json()
        assert isinstance(j, dict) and {"total", "entries"} <= set(j), j
        if j["entries"]:
            assert set(j["entries"][0]) == {"id", "at", "actor_type", "actor_id", "entity",
                                            "entity_id", "action", "before", "after", "meta"}, j["entries"][0]

        order_id, customer_id, asset_id = await _live_ids()
        if order_id is not None:
            j = (await client.get(f"/staff/orders/{order_id}", headers=admin)).json()
            assert {"order", "lines", "payments", "customer"} <= set(j), j
            assert {"id", "public_id", "status", "total_cents", "currency",
                    "placed_at"} <= set(j["order"]), j["order"]
        if customer_id is not None:
            j = (await client.get(f"/staff/customers/{customer_id}", headers=admin)).json()
            assert {"customer", "orders"} <= set(j), j
            assert {"id", "email", "display_name", "orders_count",
                    "lifetime_cents"} <= set(j["customer"]), j["customer"]
        if asset_id is not None:
            j = (await client.get(f"/staff/assets/{asset_id}", headers=admin)).json()
            assert {"asset", "lot", "movements", "reservations", "audit"} <= set(j), j
            assert j["asset"]["id"] == asset_id, j["asset"]
            assert j["lot"] is not None and j["lot"]["id"] == j["asset"]["lot_id"], j["lot"]
    finally:
        await _cleanup()


async def test_views_pagination_is_consistent(client):
    """limit/offset page the list routes and `total` stays the same across pages."""
    await _cleanup()
    try:
        admin = _h(await _staff(client, "admin"))
        for path, key in (("/staff/orders", "orders"), ("/staff/customers", "customers"),
                          ("/staff/audit", "entries")):
            p1 = (await client.get(path, params={"limit": 2, "offset": 0}, headers=admin)).json()
            p2 = (await client.get(path, params={"limit": 2, "offset": 2}, headers=admin)).json()
            assert p1["total"] == p2["total"], (path, p1["total"], p2["total"])
            assert len(p1[key]) <= 2 and len(p2[key]) <= 2, path
            assert not (set(r["id"] for r in p1[key]) & set(r["id"] for r in p2[key])), path
            # Past the end is an empty page carrying the true total, not total=0 - the reason the
            # count is its own statement rather than count(*) OVER ().
            far = (await client.get(path, params={"limit": 2, "offset": 1_000_000},
                                    headers=admin)).json()
            assert far["total"] == p1["total"] and far[key] == [], (path, far)
    finally:
        await _cleanup()


async def test_views_search_filter_matches_a_direct_select(client):
    """`q` on orders and customers, checked against the same ILIKE run by hand."""
    await _cleanup()
    try:
        admin = _h(await _staff(client, "admin"))

        # No min() on a uuid column - there is no such aggregate - so take one by ordering.
        pid = await _one("SELECT public_id::text FROM orders ORDER BY public_id LIMIT 1")
        if pid is not None:
            frag = pid[:8]
            got = (await client.get("/staff/orders", params={"q": frag}, headers=admin)).json()
            want = await _one(
                "SELECT count(*) FROM orders o LEFT JOIN users u ON u.id = o.customer_id "
                "WHERE o.public_id::text ILIKE :p OR u.email::text ILIKE :p", {"p": f"%{frag}%"})
            assert got["total"] == int(want) and got["total"] >= 1, (got["total"], want)
            assert all(frag in o["public_id"] for o in got["orders"]), got["orders"]

        email = await _one("SELECT min(email)::text FROM users")
        if email is not None:
            frag = email.split("@")[0][:5]
            got = (await client.get("/staff/customers", params={"q": frag}, headers=admin)).json()
            want = await _one(
                "SELECT count(*) FROM users u WHERE u.email::text ILIKE :p OR u.display_name ILIKE :p",
                {"p": f"%{frag}%"})
            assert got["total"] == int(want) and got["total"] >= 1, (got["total"], want)
    finally:
        await _cleanup()


async def test_views_totals_agree_with_the_database(client):
    """One aggregate per endpoint family, against a direct SELECT: the numbers the pages show
    must be the numbers the DB actually holds."""
    await _cleanup()
    try:
        admin = _h(await _staff(client, "admin"))

        j = (await client.get("/staff/orders", params={"limit": 1}, headers=admin)).json()
        assert j["total"] == int(await _one("SELECT count(*) FROM orders")), j["total"]

        j = (await client.get("/staff/customers", params={"limit": 1}, headers=admin)).json()
        assert j["total"] == int(await _one("SELECT count(*) FROM users")), j["total"]

        j = (await client.get("/staff/audit", params={"limit": 1}, headers=admin)).json()
        assert j["total"] == int(await _one("SELECT count(*) FROM audit_log")), j["total"]
    finally:
        await _cleanup()


async def test_views_order_detail_agrees_with_the_database(client):
    """One order's detail: line count, payment count and the customer email are the DB's."""
    await _cleanup()
    try:
        admin = _h(await _staff(client, "admin"))
        o = await _row("SELECT id, customer_id, total_cents FROM orders ORDER BY id LIMIT 1")
        if o is None:
            pytest.skip("no orders in the database")
        j = (await client.get(f"/staff/orders/{o['id']}", headers=admin)).json()
        assert j["order"]["total_cents"] == int(o["total_cents"]), j["order"]
        assert len(j["lines"]) == int(await _one(
            "SELECT count(*) FROM order_lines WHERE order_id = :i", {"i": o["id"]}))
        assert len(j["payments"]) == int(await _one(
            "SELECT count(*) FROM payments WHERE order_id = :i", {"i": o["id"]}))
        if o["customer_id"] is None:
            assert j["customer"] is None, j["customer"]
        else:
            assert j["customer"]["email"] == await _one(
                "SELECT email::text FROM users WHERE id = :i", {"i": o["customer_id"]})
    finally:
        await _cleanup()


async def test_views_customer_detail_order_history_matches_the_database(client):
    """A customer's orders on the detail route are exactly that customer's orders."""
    await _cleanup()
    try:
        admin = _h(await _staff(client, "admin"))
        cust = await _one("SELECT id FROM users ORDER BY id LIMIT 1")
        if cust is None:
            pytest.skip("no customers in the database")
        j = (await client.get(f"/staff/customers/{cust}", headers=admin)).json()
        want = int(await _one("SELECT count(*) FROM orders WHERE customer_id = :i", {"i": cust}))
        assert j["customer"]["orders_count"] == want, (j["customer"]["orders_count"], want)
        assert len(j["orders"]) == min(want, 50), (len(j["orders"]), want)
        assert all(o["customer_email"] == j["customer"]["email"] for o in j["orders"]), j["orders"]
    finally:
        await _cleanup()


async def test_views_asset_detail_agrees_with_the_database(client):
    """One asset's page: lot, movement count and reservation count come from the DB."""
    await _cleanup()
    try:
        admin = _h(await _staff(client, "admin"))
        a = await _row("SELECT id, lot_id FROM assets ORDER BY id LIMIT 1")
        if a is None:
            pytest.skip("no assets in the database")
        j = (await client.get(f"/staff/assets/{a['id']}", headers=admin)).json()
        assert j["asset"]["lot_id"] == a["lot_id"] and j["lot"]["id"] == a["lot_id"], j["lot"]
        assert len(j["movements"]) == min(int(await _one(
            "SELECT count(*) FROM stock_movements WHERE asset_id = :i", {"i": a["id"]})), 50)
        assert len(j["reservations"]) == min(int(await _one(
            "SELECT count(*) FROM reservations WHERE asset_id = :i", {"i": a["id"]})), 50)
        assert len(j["audit"]) == min(int(await _one(
            "SELECT count(*) FROM audit_log WHERE entity = 'asset' AND entity_id = :i",
            {"i": a["id"]})), 20)
    finally:
        await _cleanup()


async def test_views_audit_filters_are_exact(client):
    """Each audit filter narrows `total` to the DB's own count for that value."""
    await _cleanup()
    try:
        admin = _h(await _staff(client, "admin"))
        entity = await _one("SELECT entity FROM audit_log GROUP BY entity "
                            "ORDER BY count(*) DESC LIMIT 1")
        if entity is None:
            pytest.skip("no audit rows in the database")
        j = (await client.get("/staff/audit", params={"entity": entity}, headers=admin)).json()
        assert j["total"] == int(await _one(
            "SELECT count(*) FROM audit_log WHERE entity = :e", {"e": entity})), j["total"]
        assert all(e["entity"] == entity for e in j["entries"]), j["entries"]

        actor = await _one("SELECT actor_type FROM audit_log GROUP BY actor_type "
                           "ORDER BY count(*) DESC LIMIT 1")
        j = (await client.get("/staff/audit", params={"actor_type": actor}, headers=admin)).json()
        assert j["total"] == int(await _one(
            "SELECT count(*) FROM audit_log WHERE actor_type = :a", {"a": actor})), j["total"]
        assert all(e["actor_type"] == actor for e in j["entries"]), j["entries"]
    finally:
        await _cleanup()
