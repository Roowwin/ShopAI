"""Returns and RMA: the customer asks, a manager decides, the label prints, the unit is re-graded.

THE FOUR THINGS THE FEATURE IS FOR, each pinned end to end against the live database:

  1. ASKING      a customer raises a return against their OWN order - proved by the pair (reference,
                 email) and by the fact that a wrong email is refused for the same reference.
  2. DECIDING    only admin/manager may approve or deny; warehouse may read the queue but not decide.
  3. THE LABEL   approving issues one IN THE SAME TRANSACTION, carried by the carrier the parcel
                 travelled with, addressed to the business's own registered address.
  4. RESTOCK     receiving moves the unit to `returned`, and the EXISTING workbench ladder then takes
                 it to `listed` (resale) or `scrapped` - this module re-grades nothing itself.

Hermetic: `mission-` identities and a unique tag per fixture, because several suites tear down with
`DELETE FROM staff_users WHERE email LIKE 'pytest-%'` and this box runs gates concurrently. What can
be deleted is (the request, its photos, the order and its children); the units cannot be - the stock
ledger is append-only by grant and its FK pins the asset.
"""

import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


# The photo fixture. The upload door validates the DECLARED content type and the size - it does not
# decode pixels - so this is exactly what that door checks, and the raw read-back proves the bytes
# are stored and returned unchanged.
PNG = b"\x89PNG\r\n\x1a\n" + b"rma-defect-photo-bytes"


async def _staff(client, role: str = "admin") -> tuple[dict, str]:
    email = "mission-rma-" + uuid.uuid4().hex + "@test.rfo"
    _, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return _h(r.json()["access_token"]), email


async def _customer(client) -> tuple[dict, str]:
    """A registered customer - the email lookup only works for orders placed under an account."""
    email = "mission-rma-cust-" + uuid.uuid4().hex + "@test.rfo"
    r = await client.post("/store/auth/register",
                          json={"email": email, "password": "Str0ngPass!23", "display_name": "RMA"})
    assert r.status_code == 200, r.text
    return _h(r.json()["access_token"]), email


async def _drop_staff(email: str) -> None:
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                             "(SELECT id FROM staff_users WHERE email = :e)"), {"e": email})
        await c.execute(text("DELETE FROM staff_users WHERE email = :e"), {"e": email})


async def _drop_customer(email: str) -> None:
    """The customer LAST: `orders.customer_id` references `users`, so the orders must be gone."""
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                             "(SELECT id FROM users WHERE email = :e)"), {"e": email})
        await c.execute(text("DELETE FROM password_credentials WHERE user_id IN "
                             "(SELECT id FROM users WHERE email = :e)"), {"e": email})
        await c.execute(text("DELETE FROM users WHERE email = :e"), {"e": email})


async def _purge_rma(order_public_id: str) -> None:
    """Child rows first: rma_photos -> rma_requests, then the order's own children -> orders."""
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text(
            "DELETE FROM rma_photos WHERE rma_id IN (SELECT id FROM rma_requests WHERE order_id IN"
            " (SELECT id FROM orders WHERE public_id = :o))"), {"o": order_public_id})
        await c.execute(text(
            "DELETE FROM rma_requests WHERE order_id IN"
            " (SELECT id FROM orders WHERE public_id = :o)"), {"o": order_public_id})
        await c.execute(text("DELETE FROM payment_events WHERE order_id IN"
                             " (SELECT id FROM orders WHERE public_id = :o)"), {"o": order_public_id})
        await c.execute(text("DELETE FROM invoices WHERE order_id IN"
                             " (SELECT id FROM orders WHERE public_id = :o)"), {"o": order_public_id})
        for table in ("order_tax_lines", "payments", "order_lines"):
            await c.execute(text(f"DELETE FROM {table} WHERE order_id IN"
                                 " (SELECT id FROM orders WHERE public_id = :o)"),
                            {"o": order_public_id})
        await c.execute(text("DELETE FROM orders WHERE public_id = :o"), {"o": order_public_id})


async def _one(sql: str, **params):
    eng = get_engine()
    async with eng.begin() as c:
        return (await c.execute(text(sql), params)).mappings().first()


async def _archive(pid: int) -> None:
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("UPDATE products SET status = 'archived' WHERE id = :i"), {"i": pid})


async def _sold_order(client, staff_h: dict, cust_h: dict, tag: str) -> dict:
    """A real paid order belonging to a REGISTERED customer - which is what a return needs."""
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("INSERT INTO brands (name, slug) VALUES (:n, :n)"
                             " ON CONFLICT (slug) DO NOTHING"), {"n": "mission-rma-brand"})
        await c.execute(text("INSERT INTO categories (name, slug) VALUES (:n, :n)"
                             " ON CONFLICT (slug) DO NOTHING"), {"n": "mission-rma-category"})
    r = await client.post("/staff/products", headers=staff_h, json={
        "brand_slug": "mission-rma-brand", "category_slug": "mission-rma-category",
        "model": "Model " + tag[-6:], "title": tag + " rma", "slug": tag.lower() + "-rma"})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    r = await client.post("/staff/lots", headers=staff_h, json={"lot_number": tag + "-LOT"})
    lot_id, lot_number = r.json()["id"], r.json()["lot_number"]
    r = await client.post("/staff/assets/scan-in", headers=staff_h, json={
        "lot_number": lot_number, "serial_number": tag + "-S1", "product_id": pid})
    aid = r.json()["id"]
    assert (await client.post(f"/staff/assets/{aid}/grade", headers=staff_h,
                              json={"grade": "A", "cost_cents": 15000,
                                    "test_first": True})).status_code == 200
    assert (await client.post(f"/staff/assets/{aid}/price", headers=staff_h,
                              json={"sale_price_cents": 25000})).status_code == 200
    assert (await client.post(f"/staff/lots/{lot_id}/activate", headers=staff_h)).status_code == 200
    assert (await client.post(f"/staff/assets/{aid}/status", headers=staff_h,
                              json={"status": "listed"})).status_code == 200

    # Checked out WITH the customer's token, so the order carries their id and the email lookup can
    # verify them - a guest order has no address on the row to check against.
    r = await client.post("/store/checkout", headers=cust_h, json={
        "asset_ids": [aid], "shipping_country": "AU", "ship_to_name": "RMA Customer",
        "ship_line1": "1 Return Rd", "ship_city": "Sydney", "ship_postcode": "2000"})
    assert r.status_code == 200, r.text
    public_id = r.json()["order_public_id"]
    assert (await client.post(f"/store/orders/{public_id}/pay")).status_code == 200
    assert (await client.post(f"/store/orders/{public_id}/simulate-payment")).status_code == 200
    row = await _one("SELECT id FROM orders WHERE public_id = :o", o=public_id)
    return {"order_public_id": public_id, "order_id": row["id"], "asset_id": aid, "product_id": pid}


async def _raise_request(client, order_public_id: str, email: str, reason: str = "defective",
                         detail: str = "the screen flickers") -> dict:
    r = await client.post("/store/returns", json={
        "order_ref": order_public_id, "email": email, "reason": reason, "detail": detail})
    assert r.status_code == 201, r.text
    return r.json()["request"]


# ---------------------------------------------------------------------------
# 1. ASKING: the customer's door
# ---------------------------------------------------------------------------
async def test_a_customer_raises_a_return_against_their_own_order(client):
    staff_h, staff_email = await _staff(client)
    cust_h, cust_email = await _customer(client)
    tag = "missionRma" + uuid.uuid4().hex[:10]
    fixture = None
    try:
        fixture = await _sold_order(client, staff_h, cust_h, tag)
        pid = fixture["order_public_id"]

        # THE EMAIL IS THE SECOND FACTOR. The reference alone is refused ...
        r = await client.post("/store/returns/lookup", json={"order_ref": pid,
                                                             "email": "someone.else@test.rfo"})
        assert r.status_code == 404, r.text
        # ... and the pair is accepted.
        r = await client.post("/store/returns/lookup", json={"order_ref": pid, "email": cust_email})
        assert r.status_code == 200, r.text
        assert r.json()["order"]["id"] == fixture["order_id"] and r.json()["existing_return"] is None
        assert r.json()["lines"], r.json()

        request = await _raise_request(client, pid, cust_email)
        assert request["status"] == "pending" and request["number"].startswith("RMA-"), request
        assert request["reason"] == "defective" and request["tracking_ref"] is None

        # ONE OPEN RETURN PER ORDER: a double submission must not mint a second label later.
        r = await client.post("/store/returns", json={"order_ref": pid, "email": cust_email,
                                                      "reason": "defective"})
        assert r.status_code == 409 and "already an open return" in r.json()["detail"], r.text
        # A reason outside the closed set is a malformed request, not a conflict.
        r = await client.post("/store/returns", json={"order_ref": pid, "email": cust_email,
                                                      "reason": "because"})
        assert r.status_code == 422, r.text

        # The customer can read their own request back, and nobody else can.
        r = await client.get(f"/store/returns/{request['public_id']}?email={cust_email}")
        assert r.status_code == 200 and r.json()["request"]["status"] == "pending", r.text
        assert (await client.get(f"/store/returns/{request['public_id']}?email=nope@test.rfo")
                ).status_code == 404
        # ... and there is no label to download until it is approved.
        assert (await client.get(f"/store/returns/{request['public_id']}/label?email={cust_email}")
                ).status_code == 409
    finally:
        if fixture:
            await _purge_rma(fixture["order_public_id"])
            await _archive(fixture["product_id"])
        await _drop_customer(cust_email)
        await _drop_staff(staff_email)


async def test_a_defect_photograph_attaches_and_the_manager_can_read_it_back(client):
    staff_h, staff_email = await _staff(client)
    cust_h, cust_email = await _customer(client)
    tag = "missionRma" + uuid.uuid4().hex[:10]
    fixture = None
    try:
        fixture = await _sold_order(client, staff_h, cust_h, tag)
        request = await _raise_request(client, fixture["order_public_id"], cust_email)

        r = await client.post(f"/store/returns/{request['public_id']}/photos?email={cust_email}",
                              files={"file": ("defect.png", PNG, "image/png")})
        assert r.status_code == 201, r.text
        media_id = r.json()["media_id"]
        assert r.json()["byte_size"] == len(PNG)

        # A non-image and an empty file are both refused by the same whitelist the gallery uses.
        r = await client.post(f"/store/returns/{request['public_id']}/photos?email={cust_email}",
                              files={"file": ("notes.txt", b"hello", "text/plain")})
        assert r.status_code == 422, r.text
        r = await client.post(f"/store/returns/{request['public_id']}/photos?email={cust_email}",
                              files={"file": ("empty.png", b"", "image/png")})
        assert r.status_code == 422, r.text

        # The manager sees it on the request ...
        r = await client.get(f"/staff/returns/{request['id']}", headers=staff_h)
        assert r.status_code == 200, r.text
        photos = r.json()["photos"]
        assert [p["media_id"] for p in photos] == [media_id], photos
        assert r.json()["history"]["orders"] == 1, r.json()["history"]
        # ... and can fetch the bytes through the authenticated door, addressed by the request.
        r = await client.get(f"/staff/returns/{request['id']}/photos/{media_id}/raw", headers=staff_h)
        assert r.status_code == 200 and r.content == PNG, r.status_code
        assert r.headers["content-type"].startswith("image/png")
        # A media id that is not on THIS request is a 404 - the pair is the address.
        assert (await client.get(f"/staff/returns/999999/photos/{media_id}/raw",
                                 headers=staff_h)).status_code == 404
    finally:
        if fixture:
            await _purge_rma(fixture["order_public_id"])
            await _archive(fixture["product_id"])
        await _drop_customer(cust_email)
        await _drop_staff(staff_email)


# ---------------------------------------------------------------------------
# 2 + 3. DECIDING, and the label that approving issues
# ---------------------------------------------------------------------------
async def test_only_a_manager_decides_and_approving_issues_the_return_label(client):
    admin_h, admin_email = await _staff(client)
    wh_h, wh_email = await _staff(client, "warehouse")
    sales_h, sales_email = await _staff(client, "sales")
    cust_h, cust_email = await _customer(client)
    tag = "missionRma" + uuid.uuid4().hex[:10]
    fixture = None
    try:
        fixture = await _sold_order(client, admin_h, cust_h, tag)
        request = await _raise_request(client, fixture["order_public_id"], cust_email)
        rid = request["id"]

        # THE WALL. The warehouse reads the queue (it receives the parcel) but must not decide;
        # sales may not even read it; anonymous is refused outright.
        assert (await client.get("/staff/returns", headers=wh_h)).status_code == 200
        assert (await client.get(f"/staff/returns/{rid}", headers=wh_h)).status_code == 200
        for path in ("/staff/returns", f"/staff/returns/{rid}"):
            assert (await client.get(path, headers=sales_h)).status_code == 403, path
            assert (await client.get(path)).status_code == 401, path
        r = await client.post(f"/staff/returns/{rid}/decide", headers=wh_h, json={"action": "approve"})
        assert r.status_code == 403, "warehouse must not approve: " + r.text
        r = await client.post(f"/staff/returns/{rid}/decide", headers=sales_h, json={"action": "approve"})
        assert r.status_code == 403, r.text

        # APPROVING ISSUES THE LABEL IN THE SAME CALL - an approved return without one cannot exist.
        r = await client.post(f"/staff/returns/{rid}/decide", headers=admin_h,
                              json={"action": "approve", "note": "replacement authorised",
                                    "resolution": "replacement"})
        assert r.status_code == 200, r.text
        after = r.json()["request"]
        assert after["status"] == "approved" and after["decided_at"] is not None, after
        assert after["carrier"] and after["tracking_ref"].startswith("RET-"), after
        assert after["label_issued_at"] is not None, after

        label = r.json()["label"]
        assert label["barcode"] == after["tracking_ref"], label
        # THE RETURN-TO ADDRESS IS THE BUSINESS'S OWN (Settings & System), not a second copy.
        from app.core.db import get_engine
        from app.services import system_settings as ss
        eng = get_engine()
        async with eng.begin() as c:
            seller = await ss.get_business_identity(c)
        assert label["return_to"]["name"] == (seller["legal_name"] or "Returns Department"), label
        assert label["order_public_id"] == fixture["order_public_id"], label

        # The customer can now download it; before approval that was a 409 (asserted elsewhere).
        r = await client.get(f"/store/returns/{request['public_id']}/label?email={cust_email}")
        assert r.status_code == 200 and r.json()["tracking_ref"] == after["tracking_ref"], r.text

        # THE LADDER IS CLOSED. Approving twice is not a second label.
        r = await client.post(f"/staff/returns/{rid}/decide", headers=admin_h, json={"action": "approve"})
        assert r.status_code == 409 and "cannot go from approved" in r.json()["detail"], r.text
    finally:
        if fixture:
            await _purge_rma(fixture["order_public_id"])
            await _archive(fixture["product_id"])
        await _drop_customer(cust_email)
        await _drop_staff(admin_email)
        await _drop_staff(wh_email)
        await _drop_staff(sales_email)


async def test_denying_and_asking_for_information_issue_no_label(client):
    admin_h, admin_email = await _staff(client)
    cust_h, cust_email = await _customer(client)
    tag = "missionRma" + uuid.uuid4().hex[:10]
    first = second = None
    try:
        # Two orders, so one can be denied and one asked about.
        first = await _sold_order(client, admin_h, cust_h, tag + "a")
        second = await _sold_order(client, admin_h, cust_h, tag + "b")

        ask = await _raise_request(client, first["order_public_id"], cust_email, reason="changed_mind")
        r = await client.post(f"/staff/returns/{ask['id']}/decide", headers=admin_h,
                              json={"action": "request_info", "note": "what is the serial?"})
        assert r.status_code == 200, r.text
        assert r.json()["request"]["status"] == "info_requested", r.json()
        assert r.json()["request"]["tracking_ref"] is None and r.json()["label"] is None, r.json()

        deny = await _raise_request(client, second["order_public_id"], cust_email,
                                    reason="wrong_item")
        r = await client.post(f"/staff/returns/{deny['id']}/decide", headers=admin_h,
                              json={"action": "deny", "note": "outside the 30 day window"})
        assert r.status_code == 200, r.text
        assert r.json()["request"]["status"] == "denied", r.json()
        # A DENIED RETURN GETS NO LABEL, and the customer cannot download one.
        assert r.json()["label"] is None, r.json()
        assert (await client.get(f"/store/returns/{deny['public_id']}/label?email={cust_email}")
                ).status_code == 409
        # A denied return is terminal.
        assert (await client.post(f"/staff/returns/{deny['id']}/decide", headers=admin_h,
                                  json={"action": "approve"})).status_code == 409
        # An action outside the vocabulary is a 409 from the service, not a silent no-op.
        assert (await client.post(f"/staff/returns/{ask['id']}/decide", headers=admin_h,
                                  json={"action": "shred"})).status_code == 409
    finally:
        for fixture in (first, second):
            if fixture:
                await _purge_rma(fixture["order_public_id"])
                await _archive(fixture["product_id"])
        await _drop_customer(cust_email)
        await _drop_staff(admin_email)


# ---------------------------------------------------------------------------
# 4. RESTOCK: receiving puts the unit back on the ladder, and it is re-graded there
# ---------------------------------------------------------------------------
async def test_receiving_returns_the_unit_to_refurbishment_and_the_workbench_regrades_it(client):
    admin_h, admin_email = await _staff(client)
    cust_h, cust_email = await _customer(client)
    tag = "missionRma" + uuid.uuid4().hex[:10]
    fixture = None
    try:
        fixture = await _sold_order(client, admin_h, cust_h, tag)
        aid = fixture["asset_id"]
        # The sale took it to `sold` - and `rfo_assets_check_status` has NO sold -> listed edge.
        assert (await _one("SELECT status FROM assets WHERE id = :i", i=aid))["status"] == "sold"

        request = await _raise_request(client, fixture["order_public_id"], cust_email)
        assert (await client.post(f"/staff/returns/{request['id']}/decide", headers=admin_h,
                                  json={"action": "approve"})).status_code == 200
        # RECEIVING IS THE WAREHOUSE'S, and it is what puts the unit back on the ladder.
        r = await client.post(f"/staff/returns/{request['id']}/receive", headers=admin_h)
        assert r.status_code == 200 and r.json()["request"]["status"] == "received", r.text
        assert (await _one("SELECT status FROM assets WHERE id = :i", i=aid))["status"] == "returned"
        mv = await _one("SELECT reason, qty FROM stock_movements WHERE asset_id = :i"
                        " ORDER BY id DESC LIMIT 1", i=aid)
        assert mv["qty"] == 1 and mv["reason"] == "rma_return", dict(mv)
        # A return that has not been approved cannot be received.
        assert (await client.post(f"/staff/returns/{request['id']}/receive",
                                  headers=admin_h)).status_code == 409

        # THE RESTOCK IS THE EXISTING WORKBENCH'S JOB, and the ladder it needs is already there:
        # returned -> tested -> graded -> listed, i.e. back on sale after a re-inspection. `graded`
        # is entered through the GRADE door - the status door refuses it by name (staff_ops).
        assert (await client.post(f"/staff/assets/{aid}/status", headers=admin_h,
                                  json={"status": "tested"})).status_code == 200
        r = await client.post(f"/staff/assets/{aid}/grade", headers=admin_h, json={"grade": "B"})
        assert r.status_code == 200, r.text
        r = await client.post(f"/staff/assets/{aid}/status", headers=admin_h, json={"status": "listed"})
        assert r.status_code == 200, r.text
        assert (await _one("SELECT status FROM assets WHERE id = :i", i=aid))["status"] == "listed"
    finally:
        if fixture:
            await _purge_rma(fixture["order_public_id"])
            await _archive(fixture["product_id"])
        await _drop_customer(cust_email)
        await _drop_staff(admin_email)


async def test_a_returned_unit_can_be_scrapped_instead_of_resold(client):
    """The other arm of the restock rule: a unit too far gone is scrapped from `returned`, and the
    ladder permits exactly that and nothing looser."""
    admin_h, admin_email = await _staff(client)
    cust_h, cust_email = await _customer(client)
    tag = "missionRma" + uuid.uuid4().hex[:10]
    fixture = None
    try:
        fixture = await _sold_order(client, admin_h, cust_h, tag)
        aid = fixture["asset_id"]
        request = await _raise_request(client, fixture["order_public_id"], cust_email)
        assert (await client.post(f"/staff/returns/{request['id']}/decide", headers=admin_h,
                                  json={"action": "approve"})).status_code == 200
        assert (await client.post(f"/staff/returns/{request['id']}/receive",
                                  headers=admin_h)).status_code == 200
        r = await client.post(f"/staff/assets/{aid}/status", headers=admin_h,
                              json={"status": "scrapped"})
        assert r.status_code == 200, r.text
        assert (await _one("SELECT status FROM assets WHERE id = :i", i=aid))["status"] == "scrapped"
    finally:
        if fixture:
            await _purge_rma(fixture["order_public_id"])
            await _archive(fixture["product_id"])
        await _drop_customer(cust_email)
        await _drop_staff(admin_email)
