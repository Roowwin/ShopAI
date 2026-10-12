"""Corporate spreadsheet import: read a supplier/vendor sheet, map it onto the asset model, write.

WHY THIS FILE EXISTS. The backoffice could take one photo and one serial at a time
(`staff_ops.scan_in`), and its intake drop zone deliberately REFUSED spreadsheets - no parser
dependency existed and no service took a sheet. A corporate refresh lot arrives as one workbook of
hundreds of rows, so the intake screen had nothing to offer the one flow that actually carries
volume. This module is the reader that was missing.

THE COLUMN CONTRACT. A corporate sheet names its columns the way the supplier's system does:
Asset, Status, Lot, Class, Mfg, Model, Grade, Serial#, Resale, plus the three free-text condition
columns (Audit, Cosmetic, Functional). We map:

    Class            -> category      (a categories row, created if the name is new)
    Mfg              -> brand         (a brands row, created if the name is new)
    Model            -> product model AND product title
    Serial#          -> assets.serial_number
    Resale           -> assets.sale_price_cents
    Grade            -> assets.grade
    Status           -> assets.status
    Lot              -> lots.lot_number (find-or-create; this is the grouping key)
    Audit + Cosmetic + Functional -> one merged technical-notes block

Matching is done on a NORMALISED header (case folded, punctuation and spacing dropped), so
"Serial#", "Serial No" and "SERIAL NUMBER" are one column, and "Mfg"/"Manufacturer"/"Make" are one
column. Every header is accounted for in the report: mapped ones are listed with their target, and
unmapped ones are listed by name. Nothing is dropped in silence - a column the operator expected to
land and did not is the single most expensive way for an import to be wrong quietly.

WHERE THE MERGED TEXT GOES. The brief asks for a "technical_notes field for the AI Studio". No
column named `technical_notes` exists (checked repo-wide), so the merged block is written to
`assets.notes` - the asset free-text field - and the same three parts are ALSO kept structured in
`assets.condition_report` JSONB, keyed `audit` / `cosmetic` / `functional` / `technical_notes`.
`assets.notes` is what the asset workbench surfaces (`GET /staff/assets/{id}` returns it); the
chat assistant's `asset_details` answer does NOT read it, so the studio reaches the merged text
through the asset detail view, not through a chat question. That is stated here because a comment
claiming "the AI Studio reads this" would be a claim nobody could check.

THE IMPORT IS ALL-OR-NOTHING. Preview parses, maps and validates and writes NOTHING. Commit runs
the identical parse and refuses with the same report (HTTP 422) if a single row is blocked, so the
transaction never opens on a file that is known to be partly wrong. A half-imported lot is worse
than a refused one: the operator cannot tell by looking which half landed.

WHAT IS DELIBERATELY NOT HERE. This door is HTTP-only and is NOT chat-dispatchable - it is absent
from `staff_ops.GUARDED_ACTIONS` and `staff_ai.TOOL_ROLES` on purpose (those two tables are pinned
equal by `test_autonomy_execute.py` and `test_chat_tool_roles.py`, and a grant is only meaningful
for an action the rail can actually run). `_require_role` is therefore called with `db=None`, which
makes the ADR 0008 agent-grant branch unreachable: an agent identity is refused here exactly like
any other identity without the role.
"""

import csv
import re
import unicodedata
import uuid
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from io import BytesIO, StringIO

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError

from app.api.v1.deps import require_roles
# Reused, not re-declared: the in-body guard, the 409 translator and the lot-number generator are
# one implementation each, and a second copy of the guard is exactly the drift the sibling file's
# comment warns about. Importing the private names is deliberate - a duplicated guard is worse
# than a shared underscore.
from app.api.v1.staff_ops import _409, _gen_lot_number, _require_role
from app.core.db import get_db
from app.models import Asset, Lot, StockMovement
from app.services.audit import audit

router = APIRouter(prefix="/staff", tags=["staff-imports"])

# The importer mints stock in bulk from a file the operator owns, so it sits with product creation
# rather than with single-unit intake: admin and manager only. The tuple is declared here and NOT
# in staff_ops.py because that file's tuples are the chat rail's authorization surface; this action
# has no chat door, so putting it there would invite a grant for something the rail cannot run.
ROLES_CORPORATE_IMPORT = ("admin", "manager")
# Deliberately NOT a key in staff_ops.GUARDED_ACTIONS. It is passed to _require_role only so the
# refusal path is shared; with `db=None` the grant lookup is unreachable either way.
ACTION_CORPORATE_IMPORT = "corporate_import"

# Bounds. A corporate workbook is hundreds of rows, not a database dump; refusing early beats
# spending a transaction on a file that was never meant for this door.
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
MAX_ROWS = 5000
# How many parsed rows the preview returns. The SUMMARY always counts every row - this only caps
# the sample, and the payload says so, so the number on screen can never be read as the total.
PREVIEW_ROWS = 50

# Canonical field -> the header spellings that mean it, already normalised by _norm_header. The
# FIRST alias is the canonical name the report prints.
_ALIASES: dict[str, tuple[str, ...]] = {
    "asset": ("asset", "assetid", "assetname", "assettag", "assettagid", "assetnumber"),
    "status": ("status", "assetstatus", "state"),
    "lot": ("lot", "lotnumber", "lotno", "lotid", "lotref", "lotreference"),
    "category": ("class", "category", "productclass", "assetclass", "type"),
    "brand": ("mfg", "manufacturer", "make", "brand", "oem", "vendor"),
    "model": ("model", "productname", "product", "modelname", "modelno", "modelnumber"),
    "grade": ("grade", "grading", "conditiongrade", "cosmeticgrade", "assetgrade"),
    "serial": ("serial", "serialnumber", "serialno", "sn", "imei", "imeinumber"),
    "price": ("resale", "resaleprice", "resalevalue", "price", "saleprice", "listingprice"),
    "audit": ("audit", "auditnotes", "auditdescription", "auditdesc", "auditreport"),
    "cosmetic": ("cosmetic", "cosmeticnotes", "cosmeticdescription", "cosmeticdesc", "cosmetics"),
    "functional": ("functional", "functionalnotes", "functionaldescription", "functionaldesc",
                   "functionality"),
    "notes": ("notes", "note", "comments", "comment", "remarks", "remark"),
}

# Human labels for the report - the operator reads these, so they say what the value is FOR.
FIELD_LABELS = {
    "asset": "Asset tag", "status": "Asset status", "lot": "Lot", "category": "Category",
    "brand": "Brand", "model": "Product name", "grade": "Grade", "serial": "Serial number",
    "price": "Resale price", "audit": "Audit description", "cosmetic": "Cosmetic description",
    "functional": "Functional description", "notes": "Notes",
}
# Serial and lot are the two the DB cannot be told to invent: lot_id is NOT NULL, and a serial is
# what the whole unit ledger is keyed on. Everything else has a defensible default.
REQUIRED_FIELDS = ("serial", "lot")

# The asset status vocabulary, mirrored from the DB CHECK. Kept as a literal here rather than
# imported because the DB constraint is the authority and this is a pre-flight copy of it - the
# import is refused before it reaches the constraint, and the constraint stays the last word.
_STATUS_VALUES = ("received", "tested", "in_repair", "graded", "listed", "reserved", "sold",
                  "shipped", "returned", "scrapped")
# A status write that lands on `listed` also makes the unit catalog-visible (the assets trigger
# flips its lot active), so it is called out in the report rather than performed quietly.
_STATUS_BY_NORM = {re.sub(r"[^a-z0-9]+", "", s): s for s in _STATUS_VALUES}


def _norm_header(value: object) -> str:
    """Fold a header to its comparable core: ascii, lowercase, letters and digits only.

    This is what makes "Serial#", "Serial No" and "serial_number" one column. Unicode is folded to
    ascii first so a supplier sheet with an accented or non-breaking-space header still matches.
    """
    s = unicodedata.normalize("NFKD", str(value or ""))
    s = s.encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def _clean(value: object) -> str:
    """A cell as the text a person would have typed: trimmed, internal newlines collapsed."""
    if value is None:
        return ""
    s = str(value).strip()
    return re.sub(r"\s+", " ", s)


def _slugify(value: str) -> str:
    """Same slug shape as staff_ops: lowercase, runs of non-alphanumerics become one dash."""
    return re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower()).strip("-")[:160]


def _parse_grade(raw: str) -> tuple[str | None, str | None]:
    """A grade cell -> one of A-D, or an issue. Accepts 'A', 'Grade A', 'A - Excellent'."""
    s = _clean(raw).upper()
    if not s:
        return None, None
    m = re.match(r"^(?:GRADE\s*)?([ABCD])(?![A-Z0-9])", s)
    if m:
        return m.group(1), None
    m = re.search(r"\b([ABCD])\b", s)
    if m:
        return m.group(1), None
    return None, f"grade {raw!r} does not resolve to one of A, B, C, D"


def _parse_status(raw: str) -> tuple[str | None, str | None]:
    """A status cell -> a DB status value, or an issue. Blank means the intake default."""
    s = _clean(raw)
    if not s:
        return "received", None
    canonical = _STATUS_BY_NORM.get(_norm_header(s))
    if canonical is None:
        return None, f"status {raw!r} is not one of: " + ", ".join(_STATUS_VALUES)
    return canonical, None


def _parse_price(raw: str) -> tuple[int | None, str | None]:
    """A money cell -> integer cents, or an issue.

    Currency symbols, thousands separators and a trailing currency code are stripped; what is left
    must be a number. Anything else is refused rather than coerced, because a silently mis-read
    price is the one import error that reaches a customer.
    """
    s = _clean(raw)
    if not s:
        return None, None
    cleaned = re.sub(r"[^0-9.\-]", "", s)
    if cleaned in ("", "-", ".", "-.", "--"):
        return None, f"resale price {raw!r} is not a number"
    try:
        amount = Decimal(cleaned)
    except InvalidOperation:
        return None, f"resale price {raw!r} is not a number"
    if amount < 0:
        return None, f"resale price {raw!r} is negative"
    cents = int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return cents, None


def _merge_technical_notes(values: dict[str, str]) -> str:
    """Fold Audit + Cosmetic + Functional (and any stray Notes) into one labelled block.

    Each source keeps its own label so the reader - and the model that reads this later - can tell
    which column a sentence came from. An empty column contributes nothing, so a sheet that fills
    only one of the three does not produce two empty headings.
    """
    chunks = []
    for key, label in (("audit", "Audit"), ("cosmetic", "Cosmetic"), ("functional", "Functional"),
                       ("notes", "Notes")):
        body = _clean(values.get(key, ""))
        if body:
            chunks.append(f"{label}: {body}")
    return "\n".join(chunks)


def _decode_text(data: bytes) -> str:
    """Bytes -> text. BOM-led UTF-16 is respected; otherwise UTF-8, falling back to cp1252.

    cp1252 rather than latin-1 as the fallback because a European supplier sheet is far more often
    Windows-1252 than ISO-8859-1, and the two differ exactly in the punctuation those sheets use.
    """
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return data.decode("utf-16")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace")


def _sniff_delimiter(sample: str, filename: str) -> str:
    """Guess the delimiter from the header line, preferring csv.Sniffer and falling back to count."""
    if filename.lower().endswith(".tsv"):
        return "\t"
    first = sample.splitlines()[0] if sample.splitlines() else ""
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        counts = {d: first.count(d) for d in (",", ";", "\t", "|")}
        best = max(counts, key=lambda d: counts[d])
        return best if counts[best] else ","


def _rows_from_csv(data: bytes, filename: str) -> tuple[list[list[str]], str]:
    text = _decode_text(data)
    sample = text[:8192]
    delimiter = _sniff_delimiter(sample, filename)
    reader = csv.reader(StringIO(text), delimiter=delimiter)
    rows = [[_clean(c) for c in r] for r in reader]
    # A sheet saved from Excel routinely ends with blank rows; they carry no data and would each
    # become a "missing serial" issue, burying the real ones.
    while rows and not any(rows[-1]):
        rows.pop()
    return rows, delimiter


def _rows_from_xlsx(data: bytes) -> tuple[list[list[str]], str]:
    """First worksheet of an .xlsx/.xlsm workbook. Imported lazily so a CSV-only deployment that
    never built openpyxl into the image still serves the CSV path."""
    try:
        from openpyxl import load_workbook
    except ImportError:  # pragma: no cover - the image installs openpyxl; this is the honest guard
        raise HTTPException(status_code=422,
                            detail="this server has no XLSX reader installed; upload a CSV instead")
    try:
        wb = load_workbook(BytesIO(data), read_only=True, data_only=True)
    except Exception:
        raise HTTPException(
            status_code=422,
            detail="that file could not be read as a workbook - re-save it as .xlsx or upload a CSV",
        )
    try:
        title = wb.sheetnames[0]
        ws = wb[title]
        rows = [[_clean(c) for c in r] for r in ws.iter_rows(values_only=True)]
    finally:
        wb.close()
    while rows and not any(rows[-1]):
        rows.pop()
    return rows, title


def read_table(data: bytes, filename: str) -> tuple[list[list[str]], str]:
    """Dispatch on the file name; refuse anything that is neither a delimited text sheet nor a
    modern workbook, naming what IS accepted rather than letting a parser traceback escape."""
    name = (filename or "").lower()
    if name.endswith((".xlsx", ".xlsm")):
        return _rows_from_xlsx(data)
    if name.endswith(".xls"):
        # openpyxl reads the OOXML formats only; the pre-2007 binary format needs a different
        # library and is not worth carrying for a flow whose sheets are re-saved in seconds.
        raise HTTPException(status_code=422,
                            detail="legacy .xls is not supported - re-save the sheet as .xlsx or CSV")
    if name.endswith((".csv", ".tsv", ".txt")) or "." not in name:
        return _rows_from_csv(data, filename)
    raise HTTPException(status_code=422,
                        detail="unsupported file type - upload a .csv, .tsv, .xlsx or .xlsm sheet")


def map_columns(header: list[str]) -> dict:
    """Header row -> {field: column index}, plus the unmapped headers and the missing required ones.

    A field claimed by two headers keeps the leftmost and reports the other as unmapped, so the
    operator can see the collision instead of one of the two vanishing.
    """
    mapping: dict[str, int] = {}
    detected = []
    unmapped = []
    for idx, head in enumerate(header):
        norm = _norm_header(head)
        field = None
        if norm:
            for candidate, aliases in _ALIASES.items():
                if norm in aliases and candidate not in mapping:
                    field = candidate
                    break
        if field is None:
            if _clean(head):
                unmapped.append(_clean(head))
            continue
        mapping[field] = idx
        detected.append({"header": _clean(head), "field": field,
                         "label": FIELD_LABELS.get(field, field), "index": idx})
    missing = [f for f in REQUIRED_FIELDS if f not in mapping]
    return {"mapping": mapping, "detected": detected, "unmapped": unmapped, "missing": missing}


def _cell(row: list[str], index: int | None) -> str:
    if index is None or index >= len(row):
        return ""
    return _clean(row[index])


async def _lookup_existing_serials(db, serials: list[str]) -> set[str]:
    """Which of these serials already exist, case-insensitively (the column is CITEXT)."""
    if not serials:
        return set()
    lowered = [s.lower() for s in serials]
    rows = (await db.execute(
        text("SELECT lower(serial_number::text) AS s FROM assets WHERE lower(serial_number::text) = ANY(:ss)"),
        {"ss": lowered})).scalars().all()
    return set(rows)


async def parse_and_validate(db, data: bytes, filename: str) -> dict:
    """The one parse+map+validate pass. Preview returns its report; commit refuses the same one.

    Doing the work once is the point: a preview that maps the columns differently from the commit
    would be a preview of a different file.
    """
    table, sheet = read_table(data, filename)
    if not table:
        raise HTTPException(status_code=422, detail="the sheet is empty - nothing to import")
    header, body = table[0], table[1:]
    mapped = map_columns(header)

    report = {
        "file": {"name": filename, "sheet": sheet, "rows": len(body)},
        "columns": {"detected": mapped["detected"], "unmapped": mapped["unmapped"],
                    "missing": mapped["missing"],
                    "missing_labels": [FIELD_LABELS.get(f, f) for f in mapped["missing"]]},
        "issues": [],
        "sample": [],
        "sample_limit": PREVIEW_ROWS,
        "truncated": False,
    }
    if len(body) > MAX_ROWS:
        raise HTTPException(status_code=422,
                            detail=f"that sheet has {len(body)} rows - the limit is {MAX_ROWS} per import")

    idx = mapped["mapping"]
    parsed: list[dict] = []
    seen: dict[str, int] = {}
    issues: list[dict] = []

    for offset, row in enumerate(body):
        row_no = offset + 2  # 1-based, and row 1 is the header - the number the operator sees
        row_issues: list[dict] = []

        def flag(field: str, message: str, _row=row_no, _bag=row_issues):
            _bag.append({"row": _row, "field": field, "message": message})

        serial = _cell(row, idx.get("serial"))
        lot_number = _cell(row, idx.get("lot"))
        if not serial:
            flag("serial", "serial number is blank")
        if not lot_number:
            flag("lot", "lot is blank - every asset must belong to a lot")

        grade, grade_err = _parse_grade(_cell(row, idx.get("grade")))
        if grade_err:
            flag("grade", grade_err)
        status, status_err = _parse_status(_cell(row, idx.get("status")))
        if status_err:
            flag("status", status_err)
        price, price_err = _parse_price(_cell(row, idx.get("price")))
        if price_err:
            flag("price", price_err)

        if status == "listed" and price is None and not price_err:
            flag("price", "status is listed but there is no resale price - the shop cannot list a unit with no price")
        if status == "listed" and grade is None and not grade_err:
            flag("grade", "status is listed but there is no grade - the shop cannot list an ungraded unit")

        brand = _cell(row, idx.get("brand"))
        category = _cell(row, idx.get("category"))
        model = _cell(row, idx.get("model"))
        supplied = [bool(brand), bool(category), bool(model)]
        if any(supplied) and not all(supplied):
            flag("model", "a product needs Class, Mfg and Model together - this row supplies only some")

        if serial:
            key = serial.lower()
            if key in seen:
                flag("serial", f"serial also appears on row {seen[key]} of this file")
            else:
                seen[key] = row_no

        parts = {k: _cell(row, idx.get(k)) for k in ("audit", "cosmetic", "functional", "notes")}
        technical_notes = _merge_technical_notes(parts)

        parsed.append({
            "row": row_no, "serial_number": serial, "lot_number": lot_number, "grade": grade,
            "status": status, "sale_price_cents": price, "brand": brand, "category": category,
            "model": model, "asset_tag": _cell(row, idx.get("asset")),
            "technical_notes": technical_notes, "technical_parts": parts, "issues": row_issues,
        })
        if row_issues:
            issues.extend(row_issues)

    # The DB check has to happen after the file-wide pass: a duplicate INSIDE the file is a
    # different operator mistake from a serial that is already on the shelf, and they read
    # differently in the report.
    existing = await _lookup_existing_serials(db, [r["serial_number"] for r in parsed if r["serial_number"]])
    for record in parsed:
        if record["serial_number"] and record["serial_number"].lower() in existing:
            issue = {"row": record["row"], "field": "serial",
                     "message": "this serial is already in the system"}
            record["issues"].append(issue)
            issues.append(issue)

    blocked = [r for r in parsed if r["issues"]]
    report["issues"] = issues
    report["sample"] = [{k: v for k, v in r.items()} for r in parsed[:PREVIEW_ROWS]]
    report["truncated"] = len(parsed) > PREVIEW_ROWS
    report["summary"] = {
        "rows": len(parsed),
        "ready": len(parsed) - len(blocked),
        "blocked": len(blocked),
        "lots": len({r["lot_number"] for r in parsed if r["lot_number"]}),
        "would_list": len([r for r in parsed if r["status"] == "listed" and not r["issues"]]),
        "issues": len(issues),
    }
    return {"report": report, "parsed": parsed, "blocked": len(blocked) > 0}


async def _resolve_brand(db, name: str) -> int:
    """Find a brand by name (case-insensitive) or create one. brands.name is UNIQUE."""
    slug = _slugify(name)
    row = (await db.execute(text("SELECT id FROM brands WHERE lower(name) = lower(:n)"),
                            {"n": name})).scalar_one_or_none()
    if row is not None:
        return row
    taken = (await db.execute(text("SELECT 1 FROM brands WHERE slug = :s"), {"s": slug})).scalar_one_or_none()
    if taken:
        slug = f"{slug}-{uuid.uuid4().hex[:8]}"
    return (await db.execute(text(
        "INSERT INTO brands (name, slug) VALUES (:n, :s) RETURNING id"),
        {"n": name, "s": slug})).scalar_one()


async def _resolve_category(db, name: str) -> int:
    """Find a category by name OR slug (case-insensitive) or create one. categories.slug is UNIQUE."""
    slug = _slugify(name)
    row = (await db.execute(text("SELECT id FROM categories WHERE lower(name) = lower(:n) OR slug = :s"),
                            {"n": name, "s": slug})).scalar_one_or_none()
    if row is not None:
        return row
    taken = (await db.execute(text("SELECT 1 FROM categories WHERE slug = :s"), {"s": slug})).scalar_one_or_none()
    if taken:
        slug = f"{slug}-{uuid.uuid4().hex[:8]}"
    return (await db.execute(text(
        "INSERT INTO categories (name, slug) VALUES (:n, :s) RETURNING id"),
        {"n": name, "s": slug})).scalar_one()


async def _resolve_product(db, brand: str, category: str, model: str) -> tuple[int, bool]:
    """Find a product by (brand, category, model) or create it. Returns (id, created).

    The identity of a product here is the triple the corporate sheet supplies, matched
    case-insensitively, so re-importing the same sheet - or a later lot of the same model - lands on
    the product that already exists instead of minting a near-duplicate the storefront would then
    show twice. Products created this way are 'active' like `staff_ops.create_product`'s: the
    catalog query additionally requires listed stock in an active lot, so an empty product still
    cannot reach the shop.
    """
    brand_id = await _resolve_brand(db, brand)
    category_id = await _resolve_category(db, category)
    row = (await db.execute(text(
        "SELECT id FROM products WHERE brand_id = :b AND category_id = :c AND lower(model) = lower(:m)"
        " ORDER BY id LIMIT 1"), {"b": brand_id, "c": category_id, "m": model})).scalar_one_or_none()
    if row is not None:
        return row, False

    base = _slugify(f"{brand} {model}") or "imported-product"
    slug = base
    for suffix in range(2, 50):
        if not (await db.execute(text("SELECT 1 FROM products WHERE slug = :s"), {"s": slug})).scalar_one_or_none():
            break
        slug = f"{base}-{suffix}"
    else:
        slug = f"{base}-{uuid.uuid4().hex[:8]}"
    product_id = (await db.execute(text("""
        INSERT INTO products (brand_id, category_id, model, title, slug, description, specs, status)
        VALUES (:b, :c, :m, :t, :s, '', '{}'::jsonb, 'active')
        RETURNING id
    """), {"b": brand_id, "c": category_id, "m": model, "t": model, "s": slug})).scalar_one()
    return product_id, True


async def _run_import(db, staff: dict, parsed: list[dict], filename: str) -> dict:
    """Write the parsed rows. One transaction: every lot, product, asset and movement or none."""
    lot_ids: dict[str, int] = {}
    lots_created: list[dict] = []
    lots_reused: list[str] = []
    for number in dict.fromkeys(r["lot_number"] for r in parsed if r["lot_number"]):
        existing = (await db.execute(select(Lot).where(Lot.lot_number == number))).scalars().first()
        if existing is not None:
            lot_ids[number] = existing.id
            lots_reused.append(number)
            continue
        lot = Lot(lot_number=number, status="intake", notes="corporate import")
        db.add(lot)
        await db.flush()
        lot_ids[number] = lot.id
        lots_created.append({"lot_number": number, "id": lot.id})

    products_created: list[dict] = []
    product_ids: dict[tuple[str, str, str], int | None] = {}
    for record in parsed:
        triple = (record["brand"].lower(), record["category"].lower(), record["model"].lower())
        if not all(triple):
            product_ids[triple] = None
            continue
        if triple in product_ids:
            continue
        product_id, created = await _resolve_product(db, record["brand"], record["category"], record["model"])
        product_ids[triple] = product_id
        if created:
            products_created.append({"id": product_id, "brand": record["brand"],
                                     "category": record["category"], "model": record["model"]})

    assets = []
    for record in parsed:
        triple = (record["brand"].lower(), record["category"].lower(), record["model"].lower())
        asset = Asset(
            serial_number=record["serial_number"],
            product_id=product_ids.get(triple),
            status=record["status"],
            grade=record["grade"],
            sale_price_cents=record["sale_price_cents"],
            notes=record["technical_notes"] or None,
            condition_report=_condition_report(record),
            lot_id=lot_ids[record["lot_number"]],
        )
        db.add(asset)
        assets.append((asset, record))
    await db.flush()

    for asset, record in assets:
        db.add(StockMovement(asset_id=asset.id, qty=1, reason="corporate_import",
                             actor_staff_id=staff["id"]))
        await audit(db, "staff", entity="asset", entity_id=asset.id, action="corporate_import",
                    actor_id=staff["id"],
                    after={"serial": record["serial_number"], "lot": record["lot_number"],
                           "status": record["status"], "row": record["row"]})
    await audit(db, "staff", entity="import", action="corporate_import", actor_id=staff["id"],
                after={"file": filename, "rows": len(parsed), "lots": len(lot_ids),
                       "listed": len([r for r in parsed if r["status"] == "listed"])},
                meta={"source": "corporate", "products_created": len(products_created)})
    return {"lots_created": lots_created, "lots_reused": lots_reused,
            "products_created": products_created,
            "assets": [{"row": r["row"], "asset_id": a.id, "serial_number": a.serial_number,
                        "lot_number": r["lot_number"], "status": a.status, "grade": a.grade,
                        "sale_price_cents": a.sale_price_cents} for a, r in assets]}


def _condition_report(record: dict) -> dict | None:
    """The structured twin of the merged note. Returns None when the row carried nothing.

    An empty JSONB object is a claim that the row HAD a condition report and it was blank; None
    says the sheet did not describe this unit at all. The difference matters when someone later
    asks which units were imported without a condition description.
    """
    structured = record.get("technical_parts") or {}
    report = {k: _clean(structured.get(k, "")) for k in ("audit", "cosmetic", "functional")}
    if record.get("asset_tag"):
        report["corporate_asset_tag"] = record["asset_tag"]
    if record.get("technical_notes"):
        report["technical_notes"] = record["technical_notes"]
    report = {k: v for k, v in report.items() if v}
    return report or None


@router.post("/imports/corporate/preview")
async def preview_corporate_import(file: UploadFile = File(...),
                                   staff: dict = Depends(require_roles(*ROLES_CORPORATE_IMPORT)),
                                   db=Depends(get_db)):
    """Read the sheet and report what WOULD happen. Writes nothing, ever."""
    await _require_role(staff, ROLES_CORPORATE_IMPORT, ACTION_CORPORATE_IMPORT, None)
    data = await _read_upload(file)
    outcome = await parse_and_validate(db, data, file.filename or "")
    report = outcome["report"]
    report["mode"] = "preview"
    return report


@router.post("/imports/corporate/commit")
async def commit_corporate_import(file: UploadFile = File(...),
                                  staff: dict = Depends(require_roles(*ROLES_CORPORATE_IMPORT)),
                                  db=Depends(get_db)):
    """Write the sheet's rows. Refuses the whole file if any row is blocked."""
    await _require_role(staff, ROLES_CORPORATE_IMPORT, ACTION_CORPORATE_IMPORT, None)
    data = await _read_upload(file)
    outcome = await parse_and_validate(db, data, file.filename or "")
    if outcome["blocked"]:
        report = outcome["report"]
        report["mode"] = "refused"
        report["detail"] = (f"{report['summary']['blocked']} of {report['summary']['rows']} rows "
                            "cannot be imported - nothing was written")
        raise HTTPException(status_code=422, detail=report)
    try:
        written = await _run_import(db, staff, outcome["parsed"], file.filename or "")
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback()
        _409(e)

    report = outcome["report"]
    return {
        "mode": "committed",
        "file": report["file"],
        "summary": {
            "rows": report["summary"]["rows"],
            "assets_created": len(written["assets"]),
            "lots_created": len(written["lots_created"]),
            "lots_reused": len(written["lots_reused"]),
            "products_created": len(written["products_created"]),
            "listed": len([a for a in written["assets"] if a["status"] == "listed"]),
        },
        "lots_created": written["lots_created"],
        "lots_reused": written["lots_reused"],
        "products_created": written["products_created"],
        "assets": written["assets"],
    }


async def _read_upload(file: UploadFile) -> bytes:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=422, detail="the uploaded file is empty")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413,
                            detail=f"that file is {len(data) // 1024} KiB - the limit is "
                                   f"{MAX_UPLOAD_BYTES // (1024 * 1024)} MiB")
    return data
