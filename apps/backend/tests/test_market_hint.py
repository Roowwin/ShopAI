"""Price benchmarking: the aggregate behind the Set Price dialog's Market Hint.

The claim this file pins is SCOPE - which units count as comparables. Every test builds its own
MODEL (a fresh `pytest-hint-<hex>` string) rather than relying on an empty table, because the dev
database is shared and already holds prices: a hint scoped by anything weaker than the model string
would average other jobs' units and pass or fail by accident. The unique model is what makes the
arithmetic here deterministic.

As in the lot-process suite, the rows stay behind: `rfo_app` holds only SELECT+INSERT on
`stock_movements`, whose FK pins every unit it names, so a pytest-prefixed lot and serial is left
in dev rather than deleted.
"""

import uuid

from app.bootstrap_staff import bootstrap


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def _staff(client, role: str) -> str:
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    sid, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _tag() -> str:
    return "pytest-hint-" + uuid.uuid4().hex[:10]


async def _product(client, tok: str, model: str) -> int:
    """A product carrying `model`. Two of these share one model where the scope is tested."""
    r = await client.post("/staff/products", json={
        "brand_slug": "apple", "category_slug": "phones", "model": model,
        "title": "Pytest hint product " + uuid.uuid4().hex[:8],
    }, headers=_h(tok))
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _lot(client, tok: str, tag: str) -> str:
    r = await client.post("/staff/lots", json={"lot_number": tag + "-LOT", "warehouse": "WH-T"},
                          headers=_h(tok))
    assert r.status_code == 201, r.text
    return r.json()["lot_number"]


async def _unit(client, tok: str, lot_number: str, serial: str, product_id: int | None = None,
                grade: str | None = None, price: int | None = None) -> int:
    """One scanned-in unit, walked up the ladder and priced through the real doors."""
    body: dict = {"lot_number": lot_number, "serial_number": serial}
    if product_id is not None:
        body["product_id"] = product_id
    r = await client.post("/staff/assets/scan-in", json=body, headers=_h(tok))
    assert r.status_code == 201, r.text
    aid = r.json()["id"]
    if grade is not None:
        g = await client.post(f"/staff/assets/{aid}/grade",
                              json={"grade": grade, "test_first": True}, headers=_h(tok))
        assert g.status_code == 200, g.text
    if price is not None:
        p = await client.post(f"/staff/assets/{aid}/price", json={"sale_price_cents": price},
                              headers=_h(tok))
        assert p.status_code == 200, p.text
    return aid


async def _hint(client, tok: str, asset_id: int) -> dict:
    r = await client.get(f"/staff/ai/market-hint?asset_id={asset_id}", headers=_h(tok))
    assert r.status_code == 200, r.text
    return r.json()


async def test_market_hint_averages_the_same_model_and_grade(client):
    """The average is over priced units of THIS model at THIS grade - and nothing else."""
    tag = _tag()
    tok = await _staff(client, "admin")
    model = tag + "-MODEL"
    lot = await _lot(client, tok, tag)
    p1 = await _product(client, tok, model)
    # A SECOND product carrying the SAME model: the scope is the model string, so its units count.
    p2 = await _product(client, tok, model)

    await _unit(client, tok, lot, tag + "-A1", p1, "A", 30000)
    await _unit(client, tok, lot, tag + "-A2", p1, "A", 32000)
    await _unit(client, tok, lot, tag + "-A3", p1, "A", 34000)
    await _unit(client, tok, lot, tag + "-A4", p2, "A", 40000)
    # Three near-misses, each excluded for a different reason.
    await _unit(client, tok, lot, tag + "-B1", p1, "B", 99999)      # same model, other grade
    await _unit(client, tok, lot, tag + "-A5", p1, "A")             # same model+grade, unpriced
    other = await _product(client, tok, tag + "-OTHERMODEL")
    await _unit(client, tok, lot, tag + "-X1", other, "A", 77777)   # other model, same grade

    subject = await _unit(client, tok, lot, tag + "-SUBJ", p1, "A")
    h = await _hint(client, tok, subject)

    assert h["asset_id"] == subject
    assert h["model"] == model and h["grade"] == "A"
    assert h["sample_size"] == 4, h
    assert h["avg_cents"] == 34000, h          # (30000+32000+34000+40000) / 4
    assert h["min_cents"] == 30000 and h["max_cents"] == 40000, h
    assert h["current_cents"] is None, "the unit is not priced yet"


async def test_market_hint_excludes_the_unit_being_priced(client):
    """A unit's own price is never part of the market it is being measured against."""
    tag = _tag()
    tok = await _staff(client, "admin")
    model = tag + "-MODEL"
    lot = await _lot(client, tok, tag)
    p1 = await _product(client, tok, model)

    subject = await _unit(client, tok, lot, tag + "-S1", p1, "C", 10000)
    await _unit(client, tok, lot, tag + "-S2", p1, "C", 20000)

    h = await _hint(client, tok, subject)
    assert h["sample_size"] == 1, h
    assert h["avg_cents"] == 20000, "the other unit's price, not one averaged with its own"
    assert h["min_cents"] == h["max_cents"] == 20000, h
    assert h["current_cents"] == 10000, "the price this unit already carries is reported, not counted"


async def test_market_hint_says_so_when_there_is_nothing_to_compare(client):
    """An empty sample is an empty hint, with the reason legible from the payload."""
    tag = _tag()
    tok = await _staff(client, "admin")
    lot = await _lot(client, tok, tag)
    p1 = await _product(client, tok, tag + "-MODEL")

    alone = await _unit(client, tok, lot, tag + "-S1", p1, "A")
    h = await _hint(client, tok, alone)
    assert h["model"] is not None and h["grade"] == "A"
    assert h["sample_size"] == 0 and h["avg_cents"] is None, h
    assert h["min_cents"] is None and h["max_cents"] is None, h

    # A priced unit of the same model at ANOTHER grade is still nothing to compare at this grade.
    await _unit(client, tok, lot, tag + "-S2", p1, "B", 50000)
    again = await _hint(client, tok, alone)
    assert again["sample_size"] == 0 and again["avg_cents"] is None, again

    # Half a key: an ungraded unit has no grade to compare at, and an unassigned one no model.
    ungraded = await _unit(client, tok, lot, tag + "-S3", p1)
    hu = await _hint(client, tok, ungraded)
    assert hu["grade"] is None and hu["avg_cents"] is None and hu["sample_size"] == 0, hu
    orphan = await _unit(client, tok, lot, tag + "-S4")
    ho = await _hint(client, tok, orphan)
    assert ho["model"] is None and ho["grade"] is None, ho
    assert ho["avg_cents"] is None and ho["sample_size"] == 0, ho


async def test_market_hint_follows_the_pricing_roles(client):
    """The hint is for whoever may set the price it feeds - the same tuple, no wider."""
    tag = _tag()
    admin = await _staff(client, "admin")
    lot = await _lot(client, admin, tag)
    p1 = await _product(client, admin, tag + "-MODEL")
    subject = await _unit(client, admin, lot, tag + "-S1", p1, "A", 12345)
    await _unit(client, admin, lot, tag + "-S2", p1, "A", 20000)

    for role in ("admin", "manager", "sales"):
        h = await _hint(client, await _staff(client, role), subject)
        assert h["sample_size"] == 1 and h["avg_cents"] == 20000, f"{role}: {h}"

    for role in ("technician", "warehouse"):
        tok = await _staff(client, role)
        r = await client.get(f"/staff/ai/market-hint?asset_id={subject}", headers=_h(tok))
        assert r.status_code == 403, f"{role}: {r.status_code}"


async def test_market_hint_404s_on_a_unit_that_does_not_exist(client):
    tok = await _staff(client, "admin")
    r = await client.get("/staff/ai/market-hint?asset_id=999999999999", headers=_h(tok))
    assert r.status_code == 404, r.text
