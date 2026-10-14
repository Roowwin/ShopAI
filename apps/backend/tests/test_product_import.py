"""The product spreadsheet importer: read a supplier sheet, map it, refuse it or write it.

Unlike the other intake suites this one CANNOT leave its rows behind: the importer mints lots,
products and hundreds of assets per call, and a dev DB that accumulates them would drift the
catalogue and the hand-seeded stock every count-asserting suite depends on. So every test picks a
unique tag, uses it for the serial numbers, the lot numbers and the brand name, and purges exactly
those rows in a finally. The audit log and the identities follow test_intake's rule and are left
alone (the audit trail is append-only; pytest-% identities are cleaned by _cleanup).

The tag is load-bearing in one more way: the importer matches products on (brand, category, model),
so a tag-unique brand makes "the product this test created" unambiguous without touching the
seeded catalogue.
"""

import csv
import io
import uuid

from openpyxl import Workbook
from sqlalchemy import text

from app.api.v1 import staff_imports
from app.bootstrap_staff import bootstrap
from app.core.db import get_engine

# The product sheet's header, as the brief spells it. Order is deliberately not the mapping
# order, so a test that passes proves the mapping is by NAME and not by position.
PRODUCT_HEADER = ["Asset", "Status", "Lot", "Class", "Mfg", "Model", "Grade", "Serial#",
                    "Resale", "Audit", "Cosmetic", "Functional"]


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def _staff(client, role: str) -> str:
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    sid, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    return r.json()["access_token"]


async def _cleanup_identities():
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN (SELECT id FROM staff_users WHERE email LIKE 'pytest-%')"))
        await c.execute(text("DELETE FROM staff_users WHERE email LIKE 'pytest-%'"))
        await c.execute(text("DELETE FROM users WHERE email LIKE 'pytest-%'"))


async def _purge(tag: str):
    """Best-effort removal of what this test created, and only what the app role may remove.

    A COMMITTED import cannot be undone from here, and that is a property of the database rather
    than an oversight: `rfo_app` holds SELECT and INSERT on stock_movements and nothing else
    (checked against information_schema on 2026-10-13), so the ledger row is append-only by GRANT,
    and the ledger's FK then pins the asset it points at. A committed unit therefore stays in dev
    exactly as a scan-in unit does - `test_intake` records the same concession for the same reason.

    What this leaves behind is confined and invisible: the lots carry the pytest tag, and the
    products were created with no listed stock, which is what the storefront's catalogue query
    requires, so none of it reaches a shop page. Products, lots and brands that NOTHING references
    are still removed, which means a test that only previewed leaves no trace at all.
    """
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text(
            "DELETE FROM products WHERE slug LIKE :p AND NOT EXISTS"
            " (SELECT 1 FROM assets a WHERE a.product_id = products.id)"), {"p": tag + "%"})
        await c.execute(text(
            "DELETE FROM lots WHERE lot_number LIKE :p AND NOT EXISTS"
            " (SELECT 1 FROM assets a WHERE a.lot_id = lots.id)"), {"p": tag + "%"})
        await c.execute(text(
            "DELETE FROM brands WHERE name LIKE :p AND NOT EXISTS"
            " (SELECT 1 FROM products p WHERE p.brand_id = brands.id)"), {"p": tag + "%"})


def _tag() -> str:
    return "pytest-ci-" + uuid.uuid4().hex[:10]


def _csv(rows, header=None) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(header or PRODUCT_HEADER)
    for row in rows:
        writer.writerow(row)
    return buf.getvalue().encode("utf-8")


def _row(tag: str, serial: str, **over) -> list:
    """One product row, all twelve columns in the header's order."""
    values = {
        "Asset": "TAG-" + serial,
        "Status": "received",
        "Lot": tag + "-LOT-1",
        "Class": "Phones",
        "Mfg": tag,
        "Model": "Model One",
        "Grade": "B",
        "Serial#": serial,
        "Resale": "279.00",
        "Audit": "audit notes",
        "Cosmetic": "cosmetic notes",
        "Functional": "functional notes",
    }
    values.update(over)
    return [values[c] for c in PRODUCT_HEADER]


async def _post(client, tok, data, name="products.csv", phase="preview"):
    return await client.post(f"/staff/imports/products/{phase}",
                             files={"file": (name, data)}, headers=_h(tok))


async def _xlsx(rows, header=None) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.append(header or PRODUCT_HEADER)
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def _counts(tag: str) -> dict:
    eng = get_engine()
    async with eng.begin() as c:
        assets = (await c.execute(text(
            "SELECT count(*) FROM assets WHERE serial_number::text LIKE :p"), {"p": tag + "%"})).scalar_one()
        lots = (await c.execute(text(
            "SELECT count(*) FROM lots WHERE lot_number LIKE :p"), {"p": tag + "%"})).scalar_one()
        products = (await c.execute(text(
            "SELECT count(*) FROM products WHERE slug LIKE :p"), {"p": tag + "%"})).scalar_one()
    return {"assets": assets, "lots": lots, "products": products}


async def test_preview_maps_columns_and_merges_technical_notes(client):
    """The mapping contract, and proof that a preview writes nothing."""
    tag = _tag()
    try:
        tok = await _staff(client, "admin")
        data = _csv([_row(tag, tag + "-S1"), _row(tag, tag + "-S2")])
        r = await _post(client, tok, data)
        assert r.status_code == 200, r.text
        body = r.json()

        by_field = {c["field"]: c["header"] for c in body["columns"]["detected"]}
        assert by_field == {
            "asset": "Asset", "status": "Status", "lot": "Lot", "category": "Class",
            "brand": "Mfg", "model": "Model", "grade": "Grade", "serial": "Serial#",
            "price": "Resale", "audit": "Audit", "cosmetic": "Cosmetic",
            "functional": "Functional",
        }, by_field
        assert body["columns"]["missing"] == []
        assert body["columns"]["unmapped"] == []

        assert body["summary"]["rows"] == 2
        assert body["summary"]["ready"] == 2
        assert body["summary"]["blocked"] == 0
        assert body["summary"]["lots"] == 1

        first = body["sample"][0]
        assert first["serial_number"] == tag + "-S1"
        assert first["grade"] == "B"
        assert first["status"] == "received"
        assert first["sale_price_cents"] == 27900
        assert first["brand"] == tag and first["category"] == "Phones" and first["model"] == "Model One"
        assert first["technical_notes"] == (
            "Audit: audit notes\nCosmetic: cosmetic notes\nFunctional: functional notes")

        assert (await _counts(tag)) == {"assets": 0, "lots": 0, "products": 0}
    finally:
        await _purge(tag)


# The owner's workbook: all twenty-six columns, in the sheet's own order and spelling. This is the
# contract 0015_excel_foundation and the widened importer exist to serve, so the header is written
# out in full rather than abbreviated - a column missing from this list is a column the test would
# not notice going unmapped.
EXCEL_HEADER = [
    "Asset", "Status", "Lot", "Class", "Account", "Mfg", "Model", "Model #",
    "Upgrade Description", "Audit Description", "Cosmetics Description",
    "Functional Description", "Upgrade", "FMV", "Resale", "Settlement", "Grade", "Channel",
    "Serial#", "Load ID", "On Shelf", "Pallet", "Location", "Warehouse", "SKU #", "Zone",
]


def _excel_row(tag: str, serial: str) -> list:
    """One row of the workbook, in EXCEL_HEADER's order.

    Settlement is DELIBERATELY below Resale (249.00 against 279.00). Settlement is the margin guard's
    cost basis for stock that arrived on a supplier sheet (services/margin), so a workbook row whose
    Settlement sat above its Resale would now be a loss-maker the importer refuses outright - which is
    correct behavior, but it is not what THIS test is about. The values here are chosen to be
    sellable so the test can go on proving that all twenty-six columns land.
    """
    return [
        "TAG-" + serial, "Active", tag + "-XLOT-1", "Phones", "ACME Account", tag, "Model One",
        "M1-128-AU", "Battery replaced", "No faults", "Light scuffs", "All ports pass", "BAT",
        "450.00", "279.00", "249.00", "B", "eBay", serial, "LOAD-7", "Y", "PAL-3",
        "WH-A-01-12", "Sydney DC", "SKU-" + serial, "Z2",
    ]


async def test_the_full_twenty_six_column_workbook_lands_every_column(client):
    """Every header in the owner's sheet maps, translates, and reaches the database.

    Three things this is here to catch, none of which a twelve-column sheet can: a header that
    normalises to the same core as another and silently loses its column ("Model" vs "Model #"), a
    supplier spelling the old contract never listed ("Cosmetics" against `cosmetic`), and a new
    value that needs translating rather than refusing ("Active", "Y").
    """
    tag = _tag()
    serial = tag + "-X1"
    try:
        tok = await _staff(client, "admin")
        data = _csv([_excel_row(tag, serial)], header=EXCEL_HEADER)

        r = await _post(client, tok, data)
        assert r.status_code == 200, r.text
        body = r.json()

        # 1. twenty-six headers, twenty-six mappings, nothing dropped in silence.
        assert body["columns"]["unmapped"] == [], body["columns"]["unmapped"]
        assert body["columns"]["missing"] == [], body["columns"]["missing"]
        assert len(body["columns"]["detected"]) == 26, body["columns"]["detected"]
        by_header = {c["header"]: c["field"] for c in body["columns"]["detected"]}
        assert by_header["Model #"] == "model_number", by_header
        assert by_header["Model"] == "model", by_header
        assert by_header["SKU #"] == "sku", by_header
        assert by_header["Serial#"] == "serial", by_header
        assert by_header["Cosmetics Description"] == "cosmetic", by_header

        # 2. the translation layer still rewrites the supplier's words, and reports each one.
        first = body["sample"][0]
        assert first["status"] == "received" and first["on_shelf"] is True
        made = {(t["field"], t["from"], t["to"]) for t in first["translations"]}
        assert ("status", "Active", "received") in made, made
        assert ("on_shelf", "Y", "yes") in made, made

        # 3. money is cents, like every other amount in this schema.
        assert first["fmv_cents"] == 45000
        assert first["settlement_cents"] == 24900
        assert first["sale_price_cents"] == 27900
        assert first["model_number"] == "M1-128-AU"

        # 4. commit, then read the unit back through the mirror the sheet came from.
        c = await _post(client, tok, data, phase="commit")
        assert c.status_code == 200, c.text
        got = c.json()["assets"][0]
        assert got["class"] == "Phones" and got["channel"] == "eBay" and got["sku"] == "SKU-" + serial
        assert got["on_shelf"] is True and got["pallet"] == "PAL-3" and got["location"] == "WH-A-01-12"
        assert got["load_id"] == "LOAD-7" and got["account"] == "ACME Account" and got["zone"] == "Z2"

        eng = get_engine()
        async with eng.connect() as conn:
            row = (await conn.execute(text(
                'SELECT "Model #", "Upgrade Description", "FMV", "Settlement", "On Shelf",'
                ' "Account", "Load ID", "SKU #", "Zone", "Warehouse"'
                ' FROM excel_assets WHERE "Serial#" = :s'), {"s": serial})).mappings().first()
        assert row is not None, "the mirror must show the unit that was just imported"
        assert row["Model #"] == "M1-128-AU"
        assert row["Upgrade Description"] == "Battery replaced"
        assert row["FMV"] == 45000 and row["Settlement"] == 24900
        assert row["On Shelf"] is True and row["Warehouse"] == "Sydney DC"
        assert row["Account"] == "ACME Account" and row["Load ID"] == "LOAD-7"
        assert row["SKU #"] == "SKU-" + serial and row["Zone"] == "Z2"
    finally:
        await _purge(tag)


async def test_preview_accepts_alternative_header_spellings(client):
    """'Manufacturer', 'Serial No' and 'Resale Price' are the same columns as Mfg/Serial#/Resale."""
    tag = _tag()
    try:
        tok = await _staff(client, "admin")
        header = ["Manufacturer", "Serial No", "Lot No", "Product Class", "Product Name",
                  "Resale Price", "Condition Grade", "Asset Status", "Asset Tag"]
        data = _csv([["Acme", tag + "-S1", tag + "-LOT-1", "Laptops", "Trail Blazer", "1,199.50",
                      "Grade A", "Tested", "T-1"]], header=header)
        r = await _post(client, tok, data)
        assert r.status_code == 200, r.text
        body = r.json()
        by_field = {c["field"]: c["header"] for c in body["columns"]["detected"]}
        assert by_field["brand"] == "Manufacturer"
        assert by_field["serial"] == "Serial No"
        assert by_field["price"] == "Resale Price"
        # 'ConditioN Grade' normalises onto the grade aliases, 'Tested' onto the status vocabulary.
        assert by_field["grade"] == "Condition Grade"
        assert by_field["status"] == "Asset Status"
        row = body["sample"][0]
        assert row["grade"] == "A"
        assert row["status"] == "tested"
        assert row["sale_price_cents"] == 119950
    finally:
        await _purge(tag)


async def test_preview_reports_a_missing_required_column(client):
    """A sheet with no serial column is refused by name, not silently imported with blank serials."""
    tag = _tag()
    try:
        tok = await _staff(client, "admin")
        header = [c for c in PRODUCT_HEADER if c != "Serial#"]
        row = [v for c, v in zip(PRODUCT_HEADER, _row(tag, tag + "-S1")) if c != "Serial#"]
        data = _csv([row], header=header)
        r = await _post(client, tok, data)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["columns"]["missing"] == ["serial"]
        assert body["columns"]["missing_labels"] == ["Serial number"]
        assert body["summary"]["blocked"] == 1
        assert any("serial number is blank" in i["message"] for i in body["issues"])
    finally:
        await _purge(tag)


async def test_preview_reads_an_xlsx_workbook(client):
    """The .xlsx path, not just CSV."""
    tag = _tag()
    try:
        tok = await _staff(client, "admin")
        data = await _xlsx([_row(tag, tag + "-S1")])
        r = await _post(client, tok, data, name="products.xlsx")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["file"]["name"] == "products.xlsx"
        assert body["summary"]["ready"] == 1
        assert body["sample"][0]["serial_number"] == tag + "-S1"
    finally:
        await _purge(tag)


async def test_preview_refuses_an_unsupported_file_type(client):
    tok = await _staff(client, "admin")
    r = await _post(client, tok, b"not a sheet", name="products.xls")
    assert r.status_code == 422, r.text
    assert "xls" in r.json()["detail"].lower()


async def test_commit_creates_lots_products_and_assets(client):
    """The write path: lots grouped by the Lot column, one product per (brand, class, model)."""
    tag = _tag()
    try:
        tok = await _staff(client, "admin")
        rows = [
            _row(tag, tag + "-S1", **{"Lot": tag + "-LOT-1", "Model": "Model One"}),
            _row(tag, tag + "-S2", **{"Lot": tag + "-LOT-1", "Model": "Model One"}),
            _row(tag, tag + "-S3", **{"Lot": tag + "-LOT-2", "Model": "Model Two"}),
        ]
        r = await _post(client, tok, _csv(rows), phase="commit")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["mode"] == "committed"
        assert body["summary"]["assets_created"] == 3
        assert body["summary"]["lots_created"] == 2
        assert body["summary"]["products_created"] == 2
        assert {l["lot_number"] for l in body["lots_created"]} == {tag + "-LOT-1", tag + "-LOT-2"}

        assert (await _counts(tag)) == {"assets": 3, "lots": 2, "products": 2}

        eng = get_engine()
        async with eng.begin() as c:
            # The two rows of LOT-1 share one lot row, and every asset carries its mapped fields.
            grouped = (await c.execute(text("""
                SELECT l.lot_number, count(*) AS n FROM assets a JOIN lots l ON l.id = a.lot_id
                WHERE a.serial_number::text LIKE :p GROUP BY l.lot_number ORDER BY l.lot_number
            """), {"p": tag + "%"})).mappings().all()
            assert [(g["lot_number"], g["n"]) for g in grouped] == [(tag + "-LOT-1", 2), (tag + "-LOT-2", 1)]

            mapped = (await c.execute(text("""
                SELECT a.status, a.grade, a.sale_price_cents, a.notes, a.condition_report,
                       p.model, p.title FROM assets a LEFT JOIN products p ON p.id = a.product_id
                WHERE a.serial_number::text = :s
            """), {"s": tag + "-S1"})).mappings().one()
            assert mapped["status"] == "received"
            assert mapped["grade"] == "B"
            assert mapped["sale_price_cents"] == 27900
            assert mapped["model"] == "Model One" and mapped["title"] == "Model One"
            assert mapped["notes"] == (
                "Audit: audit notes\nCosmetic: cosmetic notes\nFunctional: functional notes")
            assert mapped["condition_report"]["audit"] == "audit notes"
            assert mapped["condition_report"]["technical_notes"] == mapped["notes"]

            # One ledger movement per unit, labelled with this door's reason.
            movements = (await c.execute(text("""
                SELECT count(*) FROM stock_movements m JOIN assets a ON a.id = m.asset_id
                WHERE a.serial_number::text LIKE :p AND m.reason = 'product_import' AND m.qty = 1
            """), {"p": tag + "%"})).scalar_one()
            assert movements == 3
    finally:
        await _purge(tag)


async def test_commit_refuses_the_whole_file_when_one_row_is_blocked(client):
    """Atomicity: one unreadable grade and NOTHING is written - not even the rows that were fine."""
    tag = _tag()
    try:
        tok = await _staff(client, "admin")
        rows = [_row(tag, tag + "-S1"), _row(tag, tag + "-S2", **{"Grade": "Z"})]
        r = await _post(client, tok, _csv(rows), phase="commit")
        assert r.status_code == 422, r.text
        detail = r.json()["detail"]
        assert detail["summary"]["blocked"] == 1
        assert any(i["row"] == 3 and i["field"] == "grade" for i in detail["issues"])
        assert (await _counts(tag)) == {"assets": 0, "lots": 0, "products": 0}
    finally:
        await _purge(tag)


async def test_commit_rejects_duplicate_serials(client):
    """A serial twice in one file, and a serial already on the shelf - both are blocking."""
    tag = _tag()
    try:
        tok = await _staff(client, "admin")
        twice = _csv([_row(tag, tag + "-S1"), _row(tag, tag + "-S1", **{"Asset": "TAG-dup"})])
        r = await _post(client, tok, twice, phase="commit")
        assert r.status_code == 422, r.text
        assert any("also appears on row 2" in i["message"] for i in r.json()["detail"]["issues"])
        assert (await _counts(tag))["assets"] == 0

        good = _csv([_row(tag, tag + "-S1")])
        assert (await _post(client, tok, good, phase="commit")).status_code == 200
        # Re-importing the same sheet must not double the stock.
        again = await _post(client, tok, good, phase="commit")
        assert again.status_code == 422, again.text
        assert any("already in the system" in i["message"] for i in again.json()["detail"]["issues"])
        assert (await _counts(tag))["assets"] == 1
    finally:
        await _purge(tag)


async def test_commit_blocks_a_listed_row_with_no_price(client):
    """The DB's own constraint, caught before the transaction opens."""
    tag = _tag()
    try:
        tok = await _staff(client, "admin")
        rows = [_row(tag, tag + "-S1", **{"Status": "listed", "Resale": ""})]
        r = await _post(client, tok, _csv(rows), phase="commit")
        assert r.status_code == 422, r.text
        assert any("no resale price" in i["message"] for i in r.json()["detail"]["issues"])
        assert (await _counts(tag))["assets"] == 0
    finally:
        await _purge(tag)


async def test_commit_accepts_a_listed_row_when_price_and_grade_are_present(client):
    """The same row WITH a price and grade lands - and the report says it is catalog-visible."""
    tag = _tag()
    try:
        tok = await _staff(client, "admin")
        rows = [_row(tag, tag + "-S1", **{"Status": "listed", "Resale": "AUD $1,234.56", "Grade": "A"})]
        r = await _post(client, tok, _csv(rows), phase="commit")
        assert r.status_code == 200, r.text
        assert r.json()["summary"]["listed"] == 1
        eng = get_engine()
        async with eng.begin() as c:
            price = (await c.execute(text(
                "SELECT sale_price_cents FROM assets WHERE serial_number::text = :s"),
                {"s": tag + "-S1"})).scalar_one()
        assert price == 123456
    finally:
        await _purge(tag)


async def test_import_requires_admin_or_manager(client):
    """The door is closed to anyone else, and to nobody at all."""
    tag = _tag()
    try:
        await _cleanup_identities()
        data = _csv([_row(tag, tag + "-S1")])
        for role in ("sales", "warehouse", "technician"):
            tok = await _staff(client, role)
            r = await _post(client, tok, data)
            assert r.status_code == 403, f"{role}: {r.status_code} {r.text}"
        anon = await client.post("/staff/imports/products/preview",
                                 files={"file": ("c.csv", data)})
        assert anon.status_code in (401, 403), anon.text
        assert (await _counts(tag))["assets"] == 0
    finally:
        await _purge(tag)


async def test_translates_active_to_received_and_reports_it(client):
    """The supplier's 'Active' imports as `received` - the first rung - and the preview says so."""
    tag = _tag()
    try:
        tok = await _staff(client, "admin")
        rows = [
            _row(tag, tag + "-S1", **{"Status": "Active"}),
            _row(tag, tag + "-S2", **{"Status": "Active"}),
            _row(tag, tag + "-S3", **{"Status": "received"}),
        ]
        r = await _post(client, tok, _csv(rows))
        assert r.status_code == 200, r.text
        body = r.json()
        # Not blocked: this is the case that used to refuse the whole sheet.
        assert body["summary"]["blocked"] == 0
        assert [row["status"] for row in body["sample"]] == ["received", "received", "received"]
        assert body["summary"]["translated"] == 2, "only the two Active rows were translated"
        assert body["translations"] == [
            {"field": "status", "from": "Active", "to": "received", "rows": 2}]
    finally:
        await _purge(tag)


async def test_translates_unassessed_to_no_grade_and_imports_ungraded(client):
    """'Unassessed' is an absence, not an error: the unit lands with a null grade, importable."""
    tag = _tag()
    try:
        tok = await _staff(client, "admin")
        rows = [_row(tag, tag + "-S1", **{"Grade": "Unassessed", "Status": "Active"})]
        r = await _post(client, tok, _csv(rows), phase="commit")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["summary"]["assets_created"] == 1
        assert body["assets"][0]["grade"] is None
        assert body["assets"][0]["status"] == "received"

        eng = get_engine()
        async with eng.begin() as c:
            grade = (await c.execute(text(
                "SELECT grade FROM assets WHERE serial_number::text = :s"),
                {"s": tag + "-S1"})).scalar_one()
        assert grade is None, "the column really is null, not an empty string"
    finally:
        await _purge(tag)


async def test_other_no_grade_spellings_also_resolve_to_no_grade(client):
    """The other spellings that state the same absence, so one supplier's wording is not a cliff."""
    tag = _tag()
    try:
        tok = await _staff(client, "admin")
        rows = [_row(tag, tag + f"-S{i}", **{"Grade": g}) for i, g in
                enumerate(["Unassessed", "ungraded", "N/A", "None", "TBD"])]
        r = await _post(client, tok, _csv(rows))
        assert r.status_code == 200, r.text
        body = r.json()
        assert [row["grade"] for row in body["sample"]] == [None] * 5
        assert body["summary"]["blocked"] == 0
        assert body["summary"]["translated"] == 5
    finally:
        await _purge(tag)


async def test_a_grade_that_is_neither_is_still_refused(client):
    """The list is CLOSED, and this is the guard that keeps it closed.

    A cell that is neither a grade nor a stated absence ("-", a typo, a stray note) is still an
    issue. Without this the translation layer would be a fuzzy catch-all that quietly swallows
    whatever it cannot read - which is the one way it could lose a real grade.
    """
    tag = _tag()
    try:
        tok = await _staff(client, "admin")
        rows = [_row(tag, tag + "-S1", **{"Grade": "-"}),
                _row(tag, tag + "-S2", **{"Grade": "see attached note"})]
        r = await _post(client, tok, _csv(rows))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["summary"]["blocked"] == 2
        assert [i["field"] for i in body["issues"]] == ["grade", "grade"]
    finally:
        await _purge(tag)


async def test_a_real_grade_is_never_translated_away(client):
    """The guard on the other side: a grade the operator DID mean must survive the new paths."""
    tag = _tag()
    try:
        tok = await _staff(client, "admin")
        rows = [_row(tag, tag + "-S1", **{"Grade": "A"}),
                _row(tag, tag + "-S2", **{"Grade": "Grade C"}),
                _row(tag, tag + "-S3", **{"Grade": "D - parts only"})]
        r = await _post(client, tok, _csv(rows))
        assert r.status_code == 200, r.text
        body = r.json()
        assert [row["grade"] for row in body["sample"]] == ["A", "C", "D"]
        assert body["translations"] == []
        assert body["summary"]["translated"] == 0
    finally:
        await _purge(tag)


async def test_a_listed_unassessed_row_is_still_blocked(client):
    """Translation must not become a way past the DB's own rule: listed needs a real grade."""
    tag = _tag()
    try:
        tok = await _staff(client, "admin")
        rows = [_row(tag, tag + "-S1", **{"Status": "listed", "Grade": "Unassessed", "Resale": "99.00"})]
        r = await _post(client, tok, _csv(rows), phase="commit")
        assert r.status_code == 422, r.text
        assert any("no grade" in i["message"] for i in r.json()["detail"]["issues"])
        assert (await _counts(tag))["assets"] == 0
    finally:
        await _purge(tag)


async def test_preview_returns_up_to_the_cap(client):
    """The preview cap, pinned on BOTH sides: the constant's value and what it does to a big file.

    Named for the cap rather than for a number, because the number has moved twice - 50, then 200
    when an operator wanted more of a lot to check the mapping against, then 20 when 200 turned the
    preview into a wall nobody read. The literal assertion below is the point: a cap that a test
    reads off the constant cannot catch the constant moving by accident, and this one moved twice on
    purpose.
    """
    tag = _tag()
    try:
        tok = await _staff(client, "admin")
        assert staff_imports.PREVIEW_ROWS == 20
        # A file ten times the cap, so what is measured is the cap and not the sheet.
        rows = [_row(tag, f"{tag}-S{i:04d}") for i in range(205)]
        r = await _post(client, tok, _csv(rows))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["summary"]["rows"] == 205
        assert body["sample_limit"] == 20
        assert len(body["sample"]) == 20
        assert body["truncated"] is True
    finally:
        await _purge(tag)


async def test_preview_keeps_fractional_cents_exact(client):
    """Money is parsed to cents, not floats: 1234.565 rounds half-up, never to a float artefact."""
    tag = _tag()
    try:
        tok = await _staff(client, "admin")
        rows = [_row(tag, tag + "-S1", **{"Resale": "$1,234.565"})]
        r = await _post(client, tok, _csv(rows))
        assert r.status_code == 200, r.text
        assert r.json()["sample"][0]["sale_price_cents"] == 123457
    finally:
        await _purge(tag)
