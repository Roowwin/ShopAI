"""Smart pricing at the import door: the suggested price, and the margin guard beside it.

TWO LAYERS, because they claim different things. The first half is pure: `services/pricing.py` takes
numbers and a description string and returns a number, so the ladder, the clamp, the negation rule
and the margin bands are asserted as arithmetic rather than through a request. The second half
drives the REAL import door, because the interesting failure modes there are not arithmetic at all -
they are whether the comparables are scoped correctly, whether the number the preview showed is the
number the commit wrote, and above all whether a margin WARNING has been allowed to turn into a
blocking issue.

Every integration test builds its own model string from a unique tag, so "the market for this model"
is a fact about the rows the test just created rather than about whatever the shared dev database
happens to hold. That is the same discipline `test_market_hint` records, and it is what makes these
numbers exact (`sample_size == 1`, not "at least one").
"""

import csv
import io
import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine
from app.services import pricing

# The columns these tests care about. The importer maps by NAME, so the order is free and the two
# money columns the guard reads (Settlement) and the ladder reads (FMV) are spelled as the sheet
# spells them.
HEADER = ["Asset", "Status", "Lot", "Class", "Mfg", "Model", "Grade", "Serial#",
          "Resale", "FMV", "Settlement", "Audit", "Cosmetic", "Functional"]


# ---------------------------------------------------------------------------
# The engine, on its own.
# ---------------------------------------------------------------------------

def test_the_ladder_prefers_the_market_then_the_sheet_then_cost():
    """One basis per row, chosen in the documented order, and each one is NAMED."""
    market = {"sample_size": 4, "avg_cents": 34000}

    s = pricing.suggest_price(comparables=market, fmv_cents=50000, settlement_cents=10000,
                              description="", grade="A")
    assert (s.basis, s.suggested_price_cents, s.sample_size) == ("market", 34000, 4)

    s = pricing.suggest_price(comparables=None, fmv_cents=50000, settlement_cents=10000,
                              description="", grade="A")
    assert (s.basis, s.suggested_price_cents) == ("fmv", 50000)

    # Cost-plus, at the published markup, over the sheet's settlement column.
    s = pricing.suggest_price(comparables=None, fmv_cents=None, settlement_cents=10000,
                              description="", grade="A")
    assert (s.basis, s.base_cents, s.suggested_price_cents) == ("cost", 16000, 16000)

    # Nothing to go on: a blank suggestion, not a made-up number.
    s = pricing.suggest_price(comparables=None, fmv_cents=None, settlement_cents=None,
                              description="", grade="A")
    assert (s.basis, s.suggested_price_cents, s.base_cents) == ("none", None, None)


def test_a_market_average_is_only_used_when_the_row_names_a_grade():
    """A model-wide average would price a D unit off A units, so an ungraded row falls through."""
    s = pricing.suggest_price(comparables={"sample_size": 9, "avg_cents": 34000}, fmv_cents=12000,
                              settlement_cents=None, description="", grade=None)
    assert (s.basis, s.suggested_price_cents) == ("fmv", 12000), "the grade-less row fell through"

    # And an empty sample is not a basis either.
    s = pricing.suggest_price(comparables={"sample_size": 0, "avg_cents": None}, fmv_cents=None,
                              settlement_cents=10000, description="", grade="B")
    assert s.basis == "cost"


def test_the_description_moves_the_price_and_every_hit_is_itemised():
    s = pricing.suggest_price(comparables={"sample_size": 2, "avg_cents": 100000}, fmv_cents=None,
                              settlement_cents=None, grade="B",
                              description="Cosmetic: cracked screen, heavy wear")
    assert s.adjustment_pct == -20, "cracked (-12) and heavy wear (-8)"
    assert s.suggested_price_cents == 80000
    assert {r["label"] for r in s.reasons} == {"cracked", "heavy wear"}
    assert {r["phrase"] for r in s.reasons} == {"cracked", "heavy wear"}


def test_a_signal_scores_once_however_often_the_description_spells_it():
    """Three ways of saying "there are marks" is one claim, not three."""
    pct, applied, _ = pricing.condition_adjustment("scuffed, scratched and marked")
    assert pct == -4 and len(applied) == 1


def test_the_descriptions_total_effect_is_clamped_in_both_directions():
    down = pricing.suggest_price(comparables={"sample_size": 1, "avg_cents": 100000}, fmv_cents=None,
                                 settlement_cents=None, grade="A",
                                 description="for parts, water damage, cracked, heavy wear, dented")
    assert down.adjustment_pct == pricing.ADJUSTMENT_FLOOR_PCT
    assert down.suggested_price_cents == 70000

    up = pricing.suggest_price(comparables={"sample_size": 1, "avg_cents": 100000}, fmv_cents=None,
                               settlement_cents=None, grade="A",
                               description="sealed, pristine, battery health 98%, excellent, warranty")
    assert up.adjustment_pct == pricing.ADJUSTMENT_CEILING_PCT
    assert up.suggested_price_cents == 115000


def test_a_negated_fault_is_dismissed_rather_than_scored():
    """The sheet saying a fault is ABSENT must not read as damage - and the operator can see it."""
    pct, applied, dismissed = pricing.condition_adjustment("Cosmetic: no cracks, no scuffs, no dents")
    assert pct == 0 and applied == []
    assert set(dismissed) == {"cracked", "cosmetic marks", "dented"}

    pct, applied, dismissed = pricing.condition_adjustment(
        "Functional: no faults, battery health 96%, pristine")
    assert pct == 14 and dismissed == [], "a clean unit keeps its positives"
    assert {r["label"] for r in applied} == {"strong battery", "as new"}


def test_margin_prefers_the_canonical_cost_and_falls_back_to_the_sheet():
    v = pricing.margin_verdict(sale_price_cents=30000, suggested_price_cents=None,
                               cost_cents=None, settlement_cents=29000)
    assert (v.cost_cents, v.cost_source) == (29000, "settlement")

    v = pricing.margin_verdict(sale_price_cents=30000, suggested_price_cents=None,
                               cost_cents=25000, settlement_cents=9000)
    assert (v.cost_cents, v.cost_source) == (25000, "cost_cents"), "the schema's own cost wins"


def test_margin_measures_the_sheets_price_and_falls_back_to_the_suggestion():
    v = pricing.margin_verdict(sale_price_cents=30000, suggested_price_cents=5000,
                               cost_cents=None, settlement_cents=29000)
    assert (v.price_cents, v.price_source) == (30000, "resale")
    assert v.band == "low" and round(v.margin_pct, 1) == 3.3

    v = pricing.margin_verdict(sale_price_cents=None, suggested_price_cents=24000,
                               cost_cents=None, settlement_cents=12000)
    assert (v.price_cents, v.price_source, v.band) == (24000, "suggested", "healthy")


def test_the_low_margin_boundary_is_the_published_one():
    """Exactly at the threshold is not below it - the boundary the report prints is the one used."""
    at = pricing.margin_verdict(sale_price_cents=20000, suggested_price_cents=None,
                                cost_cents=None, settlement_cents=17000)
    assert round(at.margin_pct, 1) == pricing.LOW_MARGIN_PCT and at.band == "healthy"

    under = pricing.margin_verdict(sale_price_cents=20000, suggested_price_cents=None,
                                   cost_cents=None, settlement_cents=17001)
    assert under.band == "low"


def test_an_absent_cost_is_unknown_rather_than_a_catastrophic_margin():
    v = pricing.margin_verdict(sale_price_cents=30000, suggested_price_cents=None,
                               cost_cents=None, settlement_cents=None)
    assert (v.band, v.margin_pct, v.low) == ("unknown", None, False)
    assert pricing.margin_warning(v) is None, "nothing to warn about - the workbook is silent"


def test_the_warning_says_below_cost_when_the_price_is_under_it():
    v = pricing.margin_verdict(sale_price_cents=20000, suggested_price_cents=None,
                               cost_cents=None, settlement_cents=25000)
    msg = pricing.margin_warning(v)
    assert "sells below cost" in msg and "-25.0%" in msg
    assert "the sheet's resale price" in msg and "settlement" in msg


# ---------------------------------------------------------------------------
# The door. Same parse, same numbers, and a warning that refuses nothing.
# ---------------------------------------------------------------------------

def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


def _tag() -> str:
    return "pytest-smart-" + uuid.uuid4().hex[:10]


async def _staff(client, role: str) -> tuple[str, str]:
    """A tagged identity for this test, returned with its email so cleanup can touch only ours."""
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    sid, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()["access_token"], email


async def _cleanup_identity(email: str):
    """Remove only the identity this test made.

    Deliberately NOT the `DELETE FROM staff_users WHERE email LIKE 'pytest-%'` sweep the sibling
    suites use: that sweep deletes identities belonging to tests running CONCURRENTLY in this
    shared dev database, and a peer's bootstrap blowing up mid-run is a flake that looks like a
    defect in whatever they were testing.
    """
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN"
                             " (SELECT id FROM staff_users WHERE email = :e)"), {"e": email})
        await c.execute(text("DELETE FROM staff_users WHERE email = :e"), {"e": email})
        await c.execute(text("DELETE FROM users WHERE email = :e"), {"e": email})


async def _purge(tag: str):
    """What the app role may remove, and only when nothing references it.

    A committed import cannot be undone from here - `stock_movements` is append-only BY GRANT and
    its FK pins the asset (see `test_product_import._purge`) - so the units stay. They are harmless:
    they carry no listed status, so the shop never sees them, and their model string is unique to
    this test, so no other suite's market averages can absorb them.
    """
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text(
            # The product groups FIRST: the importer declares one per brand+model+grade on the
            # sheet (`_ensure_product_groups`), they hang off the BRAND, and nothing here knew that
            # until they started appearing under this suite's tag after every run.
            "DELETE FROM product_groups WHERE brand_id IN"
            " (SELECT id FROM brands WHERE name LIKE :p)"), {"p": tag + "%"})
        await c.execute(text(
            "DELETE FROM products WHERE slug LIKE :p AND NOT EXISTS"
            " (SELECT 1 FROM assets a WHERE a.product_id = products.id)"), {"p": tag + "%"})
        await c.execute(text(
            "DELETE FROM lots WHERE lot_number LIKE :p AND NOT EXISTS"
            " (SELECT 1 FROM assets a WHERE a.lot_id = lots.id)"), {"p": tag + "%"})
        await c.execute(text(
            "DELETE FROM brands WHERE name LIKE :p AND NOT EXISTS"
            " (SELECT 1 FROM products p WHERE p.brand_id = brands.id)"), {"p": tag + "%"})


def _row(tag: str, serial: str, **over) -> list:
    """One sheet row. The description columns default to EMPTY so a test controls every signal."""
    values = {"Asset": "TAG-" + serial, "Status": "received", "Lot": tag + "-LOT-1",
              "Class": "Phones", "Mfg": tag, "Model": tag + "-MODEL", "Grade": "B",
              "Serial#": serial, "Resale": "", "FMV": "", "Settlement": "",
              "Audit": "", "Cosmetic": "", "Functional": ""}
    values.update(over)
    return [values[c] for c in HEADER]


def _sheet(rows: list[list] | None = None) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(HEADER)
    for row in (rows or []):
        writer.writerow(row)
    return buf.getvalue().encode("utf-8")


async def _post(client, tok, data, phase="preview", name="sheet.csv"):
    return await client.post(f"/staff/imports/products/{phase}",
                             files={"file": (name, data)}, headers=_h(tok))


async def _stored(serial: str) -> dict | None:
    eng = get_engine()
    async with eng.begin() as c:
        row = (await c.execute(text(
            "SELECT suggested_price_cents, suggested_price_basis, sale_price_cents FROM assets"
            " WHERE serial_number::text = :s"), {"s": serial})).mappings().first()
    return dict(row) if row else None


async def test_a_priced_comparable_drives_the_suggestion_and_the_commit_writes_it(client):
    """The whole claim of Price Intelligence, end to end through the real door.

    The comparable is created by the import itself (a priced row lands as an asset carrying the
    model and grade of its sheet), so the market this test prices against is one this test built -
    not whatever the shared dev database happened to hold.
    """
    tag = _tag()
    tok, email = await _staff(client, "admin")
    model = tag + "-MODEL"
    try:
        first = await _post(client, tok, _sheet([
            _row(tag, tag + "-C1", Model=model, Resale="300.00")]), phase="commit")
        assert first.status_code == 200, first.text

        # The subject: same model, same grade, a $290.00 settlement, and one description signal.
        data = _sheet([_row(tag, tag + "-S1", Model=model, Lot=tag + "-LOT-2",
                            Resale="300.00", Settlement="290.00", Cosmetic="Light scuffs")])
        r = await _post(client, tok, data)
        assert r.status_code == 200, r.text
        body = r.json()
        row = body["sample"][0]

        assert row["pricing"]["basis"] == "market"
        assert row["pricing"]["sample_size"] == 1, "the one unit this test committed"
        assert row["pricing"]["base_cents"] == 30000, "what that comparable actually sold at"
        assert row["pricing"]["adjustment_pct"] == -4, "Light scuffs"
        assert row["pricing"]["suggested_price_cents"] == 28800, "30000 less 4%"
        assert row["pricing"]["delta_vs_resale_cents"] == -1200, "the sheet asks 30000"

        assert row["margin"]["cost_cents"] == 29000
        assert row["margin"]["cost_source"] == "settlement"
        assert row["margin"]["price_source"] == "resale"
        assert row["margin"]["margin_pct"] == 3.3 and row["margin"]["band"] == "low"
        assert len(row["warnings"]) == 1
        assert "low margin" in row["warnings"][0]["message"]
        assert row["warnings"][0]["row"] == row["row"]

        # A WARNING IS NOT AN ISSUE. This is the pair of assertions the whole design exists to keep
        # apart: the row is flagged, and the row is not blocked.
        assert row["issues"] == []
        assert body["summary"]["blocked"] == 0
        assert body["summary"]["low_margin"] == 1
        assert body["summary"]["suggested"] == 1
        assert body["pricing"]["low_margin_pct"] == pricing.LOW_MARGIN_PCT
        assert body["pricing"]["by_basis"]["market"] == 1

        # And the file commits - the guard never refuses one.
        sheet_name = tag + ".csv"
        commit = await _post(client, tok, data, phase="commit", name=sheet_name)
        assert commit.status_code == 200, commit.text
        written = commit.json()["assets"][0]
        assert written["suggested_price_cents"] == 28800, "the preview's number is the written one"
        assert written["suggested_price_basis"] == "market"
        assert written["sale_price_cents"] == 30000, "the sheet's own price is untouched"

        stored = await _stored(tag + "-S1")
        assert stored == {"suggested_price_cents": 28800, "suggested_price_basis": "market",
                          "sale_price_cents": 30000}

        # The guard's finding rides on the audit trail with the file that produced it.
        eng = get_engine()
        async with eng.begin() as c:
            trail = (await c.execute(text(
                "SELECT \"after\"->>'low_margin' AS low FROM audit_log"
                " WHERE entity = 'import' AND action = 'product_import'"
                " AND \"after\"->>'file' = :f ORDER BY id DESC LIMIT 1"),
                {"f": sheet_name})).scalar_one_or_none()
        assert trail == "1", "the imported sheet recorded one low-margin row"
    finally:
        await _purge(tag)
        await _cleanup_identity(email)


async def test_the_ladder_walks_down_and_a_row_with_nothing_says_so(client):
    """No market for this model, so each row falls to its OWN evidence - and the basis says which."""
    tag = _tag()
    tok, email = await _staff(client, "admin")
    model = tag + "-MODEL"
    try:
        data = _sheet([
            _row(tag, tag + "-F1", Model=model, FMV="450.00"),                     # tier 2
            _row(tag, tag + "-C2", Model=model, Settlement="100.00"),              # tier 3
            _row(tag, tag + "-N3", Model=model),                                   # nothing
        ])
        r = await _post(client, tok, data)
        assert r.status_code == 200, r.text
        body = r.json()
        by_row = {row["serial_number"]: row for row in body["sample"]}

        fmv = by_row[tag + "-F1"]
        assert (fmv["pricing"]["basis"], fmv["pricing"]["suggested_price_cents"]) == ("fmv", 45000)
        assert fmv["margin"]["band"] == "unknown", "no settlement on this row to measure against"
        assert fmv["warnings"] == []

        cost = by_row[tag + "-C2"]
        assert (cost["pricing"]["basis"], cost["pricing"]["suggested_price_cents"]) == ("cost", 16000)
        assert (cost["margin"]["price_source"], cost["margin"]["band"]) == ("suggested", "healthy")

        none = by_row[tag + "-N3"]
        assert none["pricing"]["basis"] == "none"
        assert none["pricing"]["suggested_price_cents"] is None
        assert none["warnings"] == [] and none["issues"] == []

        assert body["pricing"]["by_basis"] == {"market": 0, "fmv": 1, "cost": 1, "none": 1}
        assert body["summary"]["suggested"] == 2
        assert body["summary"]["cost_unknown"] == 2
        assert body["summary"]["low_margin"] == 0
    finally:
        await _purge(tag)
        await _cleanup_identity(email)


async def test_a_file_of_thin_margins_still_imports(client):
    """The guard at its noisiest: every row flagged, and not one row blocked."""
    tag = _tag()
    tok, email = await _staff(client, "admin")
    try:
        rows = [_row(tag, tag + "-L" + str(n), Lot=tag + "-LOT-1",
                     Resale="100.00", Settlement="95.00") for n in range(1, 4)]
        data = _sheet(rows)
        # Assert the STATUS before reading the payload. A peer suite's `pytest-%` sweep can delete
        # this test's identity between the login and this call, and without this line that arrives
        # as `KeyError: 'summary'` - an error that reads like a defect in the pricing payload
        # rather than the 401 it actually is.
        r = await _post(client, tok, data)
        assert r.status_code == 200, r.text
        preview = r.json()
        assert preview["summary"]["low_margin"] == 3
        assert preview["summary"]["blocked"] == 0
        assert len(preview["warnings"]) == 3

        commit = await _post(client, tok, data, phase="commit")
        assert commit.status_code == 200, commit.text
        assert commit.json()["summary"]["assets_created"] == 3
    finally:
        await _purge(tag)
        await _cleanup_identity(email)
