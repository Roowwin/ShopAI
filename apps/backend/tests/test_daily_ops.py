"""The deterministic business day: one simulated day of store operations, asserted end to end.

Every other suite here tests one endpoint at a time; this one tests a DAY - the doors that must
stay shut (two trust zones), the intake batch that must neither lose nor invent a unit, the
proposal channel that must never write without an explicit execute flag, and the CMS duties the
storefront reads back.

Two rules shape every assertion:

* Hermetic fixtures only. Each test builds its own product -> lot -> units through the real staff
  flow, keyed by a uuid, so nothing here can lean on - or trip over - the hand-seeded
  RX-BULK-*/RX-SEED-* demo rows. Assets and their ledger rows are append-only by design
  (0001_initial revokes UPDATE/DELETE on stock_movements and audit_log), so a day's units cannot
  be deleted; they are taken off the shelf through the real status door at the end instead.
* No claim depends on what a language model says. The staff assistant is the one live-LLM door in
  this file, and what it is asked to prove is a safety invariant: without execute nothing may be
  written, whatever the model decides. Its proposal/answer text is observed, never asserted on -
  which is why the assistant's own tests are out of the gate and this one is not.
"""
import json
import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine

GRADES = ("A", "B", "C", "D")
# One price per grade, all distinct: the storefront read-back has to prove the grade and the
# price we set, not merely that some price exists.
PRICES = {"A": 45900, "B": 39900, "C": 29900, "D": 19900}
# A structurally valid guest checkout body, pointed at a unit id that cannot exist. The zone-wall
# probes below must fail on the credential alone, and a broken wall must not be able to write:
# it can only fall through to "unit unavailable".
CHECKOUT = {"asset_ids": [0], "shipping_country": "AU", "ship_to_name": "Pytest Shopper",
            "ship_line1": "1 Test St", "ship_city": "Melbourne", "ship_state": "VIC",
            "ship_postcode": "3000"}
# Staff write doors, each addressed at ids/lots that do not exist: if a wall ever fails, the probe
# records a non-401 and touches nothing on the way.
STAFF_WRITE_DOORS = (
    ("/staff/lots", {"notes": "pytest zone-wall probe"}),
    ("/staff/assets/scan-in", {"lot_number": "pytest-wall-no-such-lot",
                               "serial_number": "pytest-wall-probe"}),
    ("/staff/products", {"brand_slug": "apple", "category_slug": "phones",
                         "model": "Pytest wall", "title": "Pytest wall"}),
    ("/staff/cms/promotions", {"name": "pytest wall offer", "kind": "percent", "value": 5}),
    ("/staff/assets/0/move", {"location": "WH-WALL"}),
    ("/staff/assets/0/status", {"status": "scrapped"}),
    ("/staff/assistant", {"message": "scan in serial pytest-wall-probe into lot pytest-wall-lot"}),
)


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def _cleanup():
    """Drop the identity rows this file creates - staff and customer alike.

    Same namespace rule as the rest of the suite: pytest- identities are ours to remove. The
    stock rows are not: the ledger is append-only, so the day's units stay behind, named pytest-*
    and off the shelf.
    """
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


async def _open_lot(client, h: dict, *, slug: str, title: str) -> dict:
    """Own product and own lot, created through the real staff flow (never a hand-seeded row)."""
    r = await client.post("/staff/products", json={"brand_slug": "apple", "category_slug": "phones",
                                                   "model": title, "title": title, "slug": slug,
                                                   "specs": {"storage": "64GB"}}, headers=h)
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    r = await client.post("/staff/lots", json={"warehouse": "WH-DAY", "notes": "pytest daily-ops"},
                          headers=h)
    assert r.status_code == 201, r.text
    lot = r.json()
    return {"product_id": pid, "lot_id": lot["id"], "lot_number": lot["lot_number"], "slug": slug}


async def _scan(client, h: dict, d: dict, serials: list[str], *, publish: bool = False) -> list[dict]:
    """Scan the batch in; with publish=True walk every unit to the shelf and open the lot.

    The walk order is forced by the database, not by taste: the state trigger only allows
    received -> tested -> graded -> listed, and chk_listed_has_price refuses a listed unit with no
    price. The lot is activated last, because a lot only opens with listed stock on it and the
    storefront shows only listed units in an active lot.
    """
    out = []
    for i, serial in enumerate(serials):
        grade = GRADES[i % len(GRADES)]
        price = PRICES[grade]
        r = await client.post("/staff/assets/scan-in", json={"lot_number": d["lot_number"],
                                                             "serial_number": serial,
                                                             "product_id": d["product_id"]}, headers=h)
        assert r.status_code == 201, r.text
        aid = r.json()["id"]
        if publish:
            for step, body in (("status", {"status": "tested"}), ("grade", {"grade": grade}),
                               ("price", {"sale_price_cents": price}),
                               ("status", {"status": "listed"})):
                r = await client.post(f"/staff/assets/{aid}/{step}", json=body, headers=h)
                assert r.status_code == 200, (step, r.text)
        out.append({"id": aid, "serial": serial, "grade": grade, "price": price})
    if publish:
        r = await client.post(f"/staff/lots/{d['lot_id']}/activate", headers=h)
        assert r.status_code == 200, r.text
    return out


async def _close_day(client, h: dict, units: list[dict], slug: str) -> None:
    """Take the day's batch back off the shelf (listed -> scrapped, the only way out of listed).

    The ledger forbids deleting the units, so this is how the fixture stops polluting the demo
    storefront: the units stay in the append-only trail but leave the public catalog. When the
    last listed unit goes, the lot auto-completes and the product's page goes empty - which is
    asserted, so the cleanup is a claim about the storefront read, not just housekeeping.
    """
    for u in units:
        r = await client.post(f"/staff/assets/{u['id']}/status", json={"status": "scrapped"}, headers=h)
        assert r.status_code == 200, r.text
    r = await client.get("/store/catalog/" + slug)
    assert r.status_code == 200 and r.json()["units"] == [], "a scrapped batch must leave the shelf"


async def test_zone_walls_hold(client):
    """Two trust zones: a staff bearer dies at the store door, a customer bearer at every staff
    door, and every staff write door wants a token at all.

    The customer side is a real account - register plus login issue a customer bearer, which the
    store zone accepts and the staff zone must reject. Both directions are probed with the same
    credentials the store itself issues, so a pass cannot come from a malformed token.
    """
    await _cleanup()
    h = _h(await _staff(client))

    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    r = await client.post("/store/auth/register", json={"email": email, "password": "Str0ngPass!23",
                                                       "display_name": "Pytest shopper"})
    assert r.status_code == 200, r.text
    r = await client.post("/store/auth/login", json={"email": email, "password": "Str0ngPass!23"})
    assert r.status_code == 200, r.text
    cust = _h(r.json()["access_token"])

    # the customer's own zone answers - without this the 401s below would prove nothing
    r = await client.get("/store/me", headers=cust)
    assert r.status_code == 200 and r.json()["email"] == email, r.text

    # a staff bearer is not a customer bearer, even on a door that is open to guests
    r = await client.post("/store/checkout", json=CHECKOUT, headers=h)
    assert r.status_code == 401, r.text

    # a customer bearer is not a staff bearer: every staff write door refuses it
    for path, body in STAFF_WRITE_DOORS:
        r = await client.post(path, json=body, headers=cust)
        assert r.status_code == 401, (path, r.status_code, r.text)
    r = await client.put("/staff/cms/home", json={"hero_title": "pytest wall"}, headers=cust)
    assert r.status_code == 401, r.text
    r = await client.get("/staff/assistant/whoami", headers=cust)
    assert r.status_code == 401, r.text

    # ... and with no credential at all, the write doors are shut too
    for path, body in STAFF_WRITE_DOORS:
        r = await client.post(path, json=body)
        assert r.status_code == 401, (path, r.status_code, r.text)
    r = await client.put("/staff/cms/home", json={"hero_title": "pytest wall"})
    assert r.status_code == 401, r.text


async def test_intake_batch_delta_is_exact_and_the_storefront_reads_it(client):
    """A day's intake batch: N units in, exactly N units on the shelf - never more, never fewer.

    The batch is what the catalog, search and the store assistant all read back, so one fixture
    proves both halves: the counters are exact and the public reads agree with them. The repeated
    scan is the "no more" direction (a duplicate must not double-count), the movement ledger is
    the "no less" direction (one intake row per unit), and the move is the audit-trail leg.
    """
    await _cleanup()
    h = _h(await _staff(client))
    tag = uuid.uuid4().hex[:8]
    slug = "pytest-daily-" + tag
    d = await _open_lot(client, h, slug=slug, title="Pytest Daily " + tag)
    serials = [f"pytest-daily-{tag}-{i}" for i in range(1, len(GRADES) + 1)]
    units = await _scan(client, h, d, serials, publish=True)

    async def lot_units() -> list[dict]:
        r = await client.get("/staff/assets", params={"lot_number": d["lot_number"], "limit": 100},
                             headers=h)
        assert r.status_code == 200, r.text
        return r.json()

    rows = await lot_units()
    assert len(rows) == len(serials) == 4, rows
    assert {x["serial_number"] for x in rows} == set(serials)

    r = await client.post("/staff/assets/scan-in", json={"lot_number": d["lot_number"],
                                                        "serial_number": serials[0],
                                                        "product_id": d["product_id"]}, headers=h)
    assert r.status_code == 409, r.text
    assert len(await lot_units()) == 4, "a repeated scan must not add a unit"

    for u in units:
        r = await client.get("/staff/movements", params={"asset_id": u["id"]}, headers=h)
        assert r.status_code == 200, r.text
        mv = r.json()
        assert len(mv) == 1 and mv[0]["qty"] == 1 and mv[0]["reason"] == "intake_scan", mv

    # the storefront read-back: the grades and prices we set, and never a whole serial
    r = await client.get("/store/catalog/" + slug)
    assert r.status_code == 200, r.text
    item = r.json()
    assert sorted((u["grade"], u["sale_price_cents"]) for u in item["units"]) == \
        sorted((u["grade"], u["price"]) for u in units), item["units"]
    blob = json.dumps(item)
    for serial in serials:
        assert serial not in blob, "the public read must never expose a full serial"
        assert any(u["serial_tail"] and serial.endswith(u["serial_tail"]) for u in item["units"]), item

    # the other store read the assistant leans on, keyed by a token only this fixture can match
    r = await client.get("/store/search", params={"q": tag})
    assert r.status_code == 200, r.text
    hits = [x for x in r.json() if x["slug"] == slug]
    assert len(hits) == 1 and hits[0]["units_available"] == 4, r.text
    assert hits[0]["price_from_cents"] == min(PRICES.values()), hits

    # a move is a write, and every write lands in the audit trail
    aid = units[0]["id"]
    r = await client.post(f"/staff/assets/{aid}/move", json={"location": "WH-DAY-01"}, headers=h)
    assert r.status_code == 200 and r.json()["location"] == "WH-DAY-01", r.text
    eng = get_engine()
    async with eng.begin() as c:
        n = (await c.execute(text("SELECT count(*) FROM audit_log WHERE entity = 'asset' "
                                  "AND entity_id = :i AND action = 'move'"), {"i": aid})).scalar_one()
    assert n >= 1, "a move must land in the audit trail"

    await _close_day(client, h, units, slug)


async def test_assistant_proposal_never_writes_without_the_flag(client):
    """A request WITHOUT execute must not write stock or the audit trail, whatever the model says.

    This is the pilot safety test (test_assistant.py::test_assistant_proposes_without_writing)
    generalised from one counter to the day's: the model may propose, may answer, may be
    unreachable; the assertion is on what the system did, not on what it said. The serial in the
    message is a fresh one inside this test's own lot, so a wrong-side write would show up in the
    counters asserted here rather than landing on the hand-seeded demo stock - and the audit
    counter catches every kind of staff write (grade, price, move), not only a new row.
    """
    await _cleanup()
    h = _h(await _staff(client))
    tag = uuid.uuid4().hex[:8]
    d = await _open_lot(client, h, slug="pytest-proposal-" + tag, title="Pytest Proposal " + tag)
    await _scan(client, h, d, [f"pytest-proposal-{tag}-1"])
    pending = f"pytest-proposal-{tag}-9"        # never scanned in: a write would add a unit

    eng = get_engine()
    async with eng.begin() as c:
        before = ((await c.execute(text("SELECT count(*) FROM assets"))).scalar_one(),
                  (await c.execute(text("SELECT count(*) FROM audit_log"))).scalar_one(),
                  (await c.execute(text("SELECT count(*) FROM assets WHERE lot_id = :l"),
                                   {"l": d["lot_id"]})).scalar_one())

    r = await client.post("/staff/assistant",
                          json={"message": f"scan in serial {pending} into lot {d['lot_number']}"},
                          headers=h)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["type"] in ("proposed", "answer"), j
    assert j["type"] != "executed", j

    async with eng.begin() as c:
        after = ((await c.execute(text("SELECT count(*) FROM assets"))).scalar_one(),
                 (await c.execute(text("SELECT count(*) FROM audit_log"))).scalar_one(),
                 (await c.execute(text("SELECT count(*) FROM assets WHERE lot_id = :l"),
                                  {"l": d["lot_id"]})).scalar_one())
    assert after == before, f"a proposal must not write (assets, audit, lot units): {before} -> {after}"


async def test_cms_daily_ops_pins_the_deal_and_puts_an_offer_live(client):
    """The CMS duties of the day: pin the deal of the month, take it down, put an offer live.

    Hermetic: owns the product and the listed unit the deal card prices itself from (so the card
    publishes on this fixture's own stock, not on the demo rows), owns the offer name, and
    restores site_settings in a finally - that row is shared state and the rest of the suite
    reads it back.
    """
    await _cleanup()
    h = _h(await _staff(client))
    tag = uuid.uuid4().hex[:8]
    slug = "pytest-deal-" + tag
    d = await _open_lot(client, h, slug=slug, title="Pytest Deal " + tag)
    units = await _scan(client, h, d, [f"pytest-deal-{tag}-1"], publish=True)

    eng = get_engine()
    async with eng.begin() as c:
        prev = (await c.execute(text("SELECT value::text FROM site_settings WHERE key = 'home'"))).scalar_one_or_none()
    offer = "pytest daily-ops offer " + tag
    try:
        r = await client.put("/staff/cms/home", json={"hero_title": "pytest hero",
                                                     "deal_of_month": {"product_slug": slug,
                                                                       "title": "Pytest deal"}},
                             headers=h)
        assert r.status_code == 200, r.text
        body = (await client.get("/store/home-content")).json()
        deal = body.get("deal_of_month") or {}
        assert deal.get("product_slug") == slug, body
        assert deal.get("price_from_cents") == PRICES["A"], body      # priced from our own unit
        assert body["hero_title"] == "pytest hero", body

        # unpinned: the block is gone from the public payload (job 2 semantics)
        r = await client.put("/staff/cms/home", json={"hero_title": "pytest hero"}, headers=h)
        assert r.status_code == 200, r.text
        assert "deal_of_month" not in (await client.get("/store/home-content")).json()

        # an offer goes live through the CMS and shows on the public promotions route
        live = {p["name"] for p in (await client.get("/store/promotions")).json()}
        assert offer not in live, "the fixture name must be unique or the claim is not hermetic"
        r = await client.post("/staff/cms/promotions", json={"name": offer, "kind": "percent",
                                                             "value": 7}, headers=h)
        assert r.status_code == 200, r.text
        live = {p["name"]: p for p in (await client.get("/store/promotions")).json()}
        assert live[offer]["kind"] == "percent" and live[offer]["value"] == 7, live

        # retiring it hides it again - the counter-operation of the same daily duty
        r = await client.patch(f"/staff/cms/promotions/{r.json()['id']}", json={"active": False},
                               headers=h)
        assert r.status_code == 200, r.text
        assert offer not in {p["name"] for p in (await client.get("/store/promotions")).json()}
    finally:
        async with eng.begin() as c:
            await c.execute(text("DELETE FROM promotions WHERE name = :n"), {"n": offer})
            if prev is None:
                await c.execute(text("DELETE FROM site_settings WHERE key = 'home'"))
            else:
                await c.execute(text("UPDATE site_settings SET value = CAST(:v AS jsonb) "
                                     "WHERE key = 'home'"), {"v": prev})
    await _close_day(client, h, units, slug)
