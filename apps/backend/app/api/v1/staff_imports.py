"""Product import: read a supplier's product sheet, map it onto the asset model, write.

WHY THIS FILE EXISTS. The backoffice could take one photo and one serial at a time
(`staff_ops.scan_in`), and its intake drop zone deliberately REFUSED spreadsheets - no parser
dependency existed and no service took a sheet. A supplier refresh lot arrives as one workbook of
hundreds of rows, so the intake screen had nothing to offer the one flow that actually carries
volume. This module is the reader that was missing.

THE COLUMN CONTRACT. A product sheet names its columns the way the supplier's system does:
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

THE TRANSLATION LAYER. Column names are not the only thing the supplier spells differently: the
VALUES do too, and two of those mismatches used to block a whole sheet. "Active" is the supplier
word for a unit in service, which in this system is `received` (the bottom of the ladder, ready to
be tested and graded); "Unassessed" states there is no grade, which is a null and not an error. Both
are translated rather than refused - and every translation is REPORTED, aggregated, in the preview
payload, because rewriting the operator's data without telling them is not a translation, it is a
surprise. See the translation table below for the full list and the reasoning for each entry.

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
# The margin guard is one rule shared with the staff doors and the storefront (services/margin), so
# a row refused here is the same unit the shop would hide - not a second, differently-worded check.
from app.services.margin import margin_refusal

router = APIRouter(prefix="/staff", tags=["staff-imports"])

# The importer mints stock in bulk from a file the operator owns, so it sits with product creation
# rather than with single-unit intake: admin and manager only. The tuple is declared here and NOT
# in staff_ops.py because that file's tuples are the chat rail's authorization surface; this action
# has no chat door, so putting it there would invite a grant for something the rail cannot run.
ROLES_PRODUCT_IMPORT = ("admin", "manager")
# Deliberately NOT a key in staff_ops.GUARDED_ACTIONS. It is passed to _require_role only so the
# refusal path is shared; with `db=None` the grant lookup is unreachable either way.
ACTION_PRODUCT_IMPORT = "product_import"

# Bounds. A product workbook is hundreds of rows, not a database dump; refusing early beats
# spending a transaction on a file that was never meant for this door.
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
MAX_ROWS = 5000
# How many parsed rows the preview returns. The SUMMARY always counts every row - this only caps
# the sample, and the payload says so, so the number on screen can never be read as the total.
# Raised 50 -> 200 at the owner's request: a corporate lot runs to a few hundred lines and 50 was
# not enough of one to check the mapping against. Still a cap, and still reported as one.
PREVIEW_ROWS = 200

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
    # The plural spellings are the WORKBOOK's ("Cosmetics Description"), the singular ones are the
    # older sheets'. Normalising drops the difference in punctuation but not in letters, so
    # "cosmeticsdescription" and "cosmeticdescription" are two different cores and both have to be
    # listed - which is exactly how a column goes silently unmapped.
    "cosmetic": ("cosmetic", "cosmeticnotes", "cosmeticdescription", "cosmeticdesc", "cosmetics",
                 "cosmeticsdescription", "cosmeticsdesc", "cosmeticsnotes"),
    "functional": ("functional", "functionalnotes", "functionaldescription", "functionaldesc",
                   "functionality"),
    "notes": ("notes", "note", "comments", "comment", "remarks", "remark"),
    # ---- the rest of the supplier workbook (0015_excel_foundation gave each of these a column) ----
    # Added AFTER the original thirteen on purpose: a norm is matched against the candidates in
    # this dict's order, so every header the old contract already claimed is claimed by the same
    # field it always was, and this is purely additive to sheets that were importing yesterday.
    "model_number": ("modelnumber", "modelno", "mpn", "manufacturerpartnumber", "partnumber",
                     "partno"),
    "location": ("location", "loc", "storagelocation", "binlocation"),
    "warehouse": ("warehouse", "wh", "warehousename", "depot", "facility"),
    "account": ("account", "accountname", "accountnumber", "client", "clientname", "owner"),
    "upgrade": ("upgrade", "upgradecode", "upgradetype"),
    "upgrade_desc": ("upgradedescription", "upgradedesc", "upgradenotes"),
    "fmv": ("fmv", "fairmarketvalue", "fmvvalue", "marketvalue"),
    "settlement": ("settlement", "settlementamount", "settlementvalue", "settlementprice"),
    "channel": ("channel", "saleschannel", "marketplace", "listingchannel"),
    "load_id": ("loadid", "load", "loadno", "loadnumber", "shipmentid", "shipment"),
    "on_shelf": ("onshelf", "shelf", "displayed", "onshelfstatus"),
    "pallet": ("pallet", "palletid", "palletno", "palletnumber"),
    "sku": ("sku", "skunumber", "itemcode", "productcode", "stockkeepingunit"),
    "zone": ("zone", "zoneid", "zonename", "warehousezone"),
    # NOT one of the workbook's twenty-six. This is the margin guard's input (see services/margin):
    # a unit cannot be checked for a loss unless the sheet can say what it cost, and `assets`
    # has carried `cost_cents` since 0001 with no door that ever filled it from a file. Every
    # spelling here is a column a cost normally arrives under.
    "cost": ("cost", "unitcost", "costprice", "purchasecost", "buyprice", "acquisitioncost",
             "landedcost", "costegst", "costexgst"),
}

# THE HASH HEADERS. "Model #", "SKU #" and "Serial#" all normalise to the SAME core as their base
# column ("model", "sku", "serial") because _norm_header drops punctuation - so a sheet carrying
# both "Model" and "Model #" would map the first to `model` and leave the second either unmapped or
# silently colliding with it. That is not a mapping preference, it is a lost column: the operator
# would see "Model #" listed under unmapped and never learn why.
#
# The supplier's own convention is the way out - the columns that carry a CODE are the ones marked
# with a hash. A header whose cleaned text ends in "#" is therefore read as the code variant of its
# base name, and only then does the ordinary alias scan get a turn. A sheet with one "Serial#" is
# unaffected: it lands on `serial`, exactly as it does today.
_HASH_FIELDS: dict[str, str] = {"model": "model_number", "sku": "sku", "serial": "serial"}

# A cell whose header ends in '#' and whose base is not a known code column is still not an error:
# it falls through to the alias scan, which is what keeps a supplier sheet that writes "Lot #" (a
# real spelling of `lot`) working.

# Human labels for the report - the operator reads these, so they say what the value is FOR.
FIELD_LABELS = {
    "asset": "Asset tag", "status": "Asset status", "lot": "Lot", "category": "Category",
    "brand": "Brand", "model": "Product name", "grade": "Grade", "serial": "Serial number",
    "price": "Resale price", "audit": "Audit description", "cosmetic": "Cosmetic description",
    "functional": "Functional description", "notes": "Notes",
    # The workbook's remaining columns, labelled the way the sheet spells them so a preview reads
    # back to the operator in their own words rather than the column names of a database.
    "model_number": "Model #", "location": "Location", "warehouse": "Warehouse",
    "account": "Account", "upgrade": "Upgrade", "upgrade_desc": "Upgrade description",
    "fmv": "FMV", "settlement": "Settlement", "channel": "Channel", "load_id": "Load ID",
    "on_shelf": "On Shelf", "pallet": "Pallet", "sku": "SKU #", "zone": "Zone",
    "cost": "Cost",
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

# ---------------------------------------------------------------------------
# THE TRANSLATION LAYER: the supplier's vocabulary -> this system's vocabulary.
#
# The two gaps below are not malformed sheets. They are the supplier speaking their own language,
# and a mapper that refuses them makes the importer useless on exactly the sheets it exists to
# read. So it translates - and REPORTS every translation it made (the `translations` block in the
# preview payload) instead of rewriting in silence. A data change the operator never sees is a
# data change they never agreed to, and the second press on this screen is supposed to be an
# informed one.
#
# 1. STATUS. The supplier calls an in-service unit "Active". There is no `active` in the ASSET
#    status vocabulary at all - the ladder starts at `received`, which is precisely what an
#    in-service unit is here: taken in, not yet tested, not yet graded. Landing it on `received`
#    is what puts the unit on the first rung so the workbench can walk it up
#    received -> tested -> graded -> listed. Note the collision hazard: the LOT vocabulary does
#    have `active`, so this lookup is consulted for the asset-status column only and never shares
#    a table with lot status.
#
# 2. GRADE. The supplier's "Unassessed" says there IS no grade yet. The column is nullable and
#    only `listed` demands a grade, so the honest reading is a null - not a refusal, and above all
#    not a guessed letter. The unit lands ungraded and the Asset Workbench grades it later, which
#    is the flow the brief describes.
# ---------------------------------------------------------------------------
_STATUS_SYNONYMS: dict[str, str] = {
    "active": "received",
}
# Words that MEAN "there is no grade here". Each is an ABSENCE, not a grade, so each resolves to a
# null - the same result a blank cell gives - rather than to an issue. Kept a closed, spelled-out
# list on purpose: a fuzzy match in this direction would silently swallow a grade the operator did
# mean, which is the one error here that would reach a customer.
_NO_GRADE_VALUES: frozenset[str] = frozenset({
    "unassessed", "ungraded", "notassessed", "notgraded", "nograde", "gradeunassessed",
    "na", "none", "nil", "tbd", "pending",
})


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


# A translation is carried as data, not as a sentence to be parsed back: (field, from, to). The
# preview both lists them per row and counts them, and re-deriving either from a formatted string
# would be a parser for output this module just generated.
Translation = tuple[str, str, str]
# What a translated-away grade becomes, in words, for the report. The COLUMN gets a null; this
# label is only ever shown to a person.
NO_GRADE_LABEL = "no grade"


def _parse_grade(raw: str) -> tuple[str | None, str | None, Translation | None]:
    """A grade cell -> (grade or None, issue or None, translation or None).

    Three outcomes, and the third is the one this job added: a cell that STATES there is no grade
    ("Unassessed") is an ABSENCE - it yields None with no issue, because it is neither an error nor
    a grade. Accepts 'A', 'Grade A', 'A - Excellent'.
    """
    s = _clean(raw).upper()
    if not s:
        return None, None, None
    if _norm_header(s) in _NO_GRADE_VALUES:
        return None, None, ("grade", _clean(raw), NO_GRADE_LABEL)
    m = re.match(r"^(?:GRADE\s*)?([ABCD])(?![A-Z0-9])", s)
    if m:
        return m.group(1), None, None
    m = re.search(r"\b([ABCD])\b", s)
    if m:
        return m.group(1), None, None
    return None, f"grade {raw!r} does not resolve to one of A, B, C, D", None


def _parse_status(raw: str) -> tuple[str | None, str | None, Translation | None]:
    """A status cell -> (DB status, issue, translation). Blank means the intake default.

    The canonical vocabulary is consulted BEFORE the translation table, so a synonym can never
    shadow a real status value however the two are later edited.
    """
    s = _clean(raw)
    if not s:
        return "received", None, None
    norm = _norm_header(s)
    canonical = _STATUS_BY_NORM.get(norm)
    if canonical is not None:
        return canonical, None, None
    translated = _STATUS_SYNONYMS.get(norm)
    if translated is not None:
        return translated, None, ("status", s, translated)
    return None, f"status {raw!r} is not one of: " + ", ".join(_STATUS_VALUES), None


def _parse_price(raw: str, label: str = "resale price") -> tuple[int | None, str | None]:
    """A money cell -> integer cents, or an issue.

    Currency symbols, thousands separators and a trailing currency code are stripped; what is left
    must be a number. Anything else is refused rather than coerced, because a silently mis-read
    price is the one import error that reaches a customer.

    `label` is the one thing three money columns argue about. FMV and Settlement are the same parse
    and the same rules as Resale - one implementation, three call sites - but a message that says
    "resale price" about the FMV column sends the operator to the wrong cell in a 26-column sheet,
    which is how a correct refusal gets read as a wrong one.
    """
    s = _clean(raw)
    if not s:
        return None, None
    cleaned = re.sub(r"[^0-9.\-]", "", s)
    if cleaned in ("", "-", ".", "-.", "--"):
        return None, f"{label} {raw!r} is not a number"
    try:
        amount = Decimal(cleaned)
    except InvalidOperation:
        return None, f"{label} {raw!r} is not a number"
    if amount < 0:
        return None, f"{label} {raw!r} is negative"
    cents = int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return cents, None


# The words a supplier sheet uses for the On Shelf column. Kept beside _parse_status's own two
# tables rather than invented per call site, and reported through the same translation mechanism,
# so a rewritten "Y" reads back to the operator as "Y -> on shelf" instead of vanishing.
_TRUE_WORDS = ("y", "yes", "true", "t", "1", "on", "onshelf", "displayed", "active", "instock")
_FALSE_WORDS = ("n", "no", "false", "f", "0", "off", "notonshelf", "unshelved", "outofstock")
_ON_SHELF_BY_NORM = {**{w: True for w in _TRUE_WORDS}, **{w: False for w in _FALSE_WORDS}}


def _parse_truth(raw: str) -> tuple[bool | None, str | None, Translation | None]:
    """A yes/no cell -> (bool or None, issue or None, translation or None).

    Blank is an ABSENCE, not a false: a sheet that never filled the column is not the same claim as
    a sheet that said "No", and storing False for the first would put a wrong fact on every row of
    a workbook that simply does not track shelf state. The column is nullable for exactly this.

    "Y"/"N" and "0"/"1" are translated rather than refused - they are the same answer spelled the
    supplier's way - and the rewrite is reported per row like every other translation here.
    """
    s = _clean(raw)
    if not s:
        return None, None, None
    norm = _norm_header(s)
    value = _ON_SHELF_BY_NORM.get(norm)
    if value is None:
        return None, f"{raw!r} is not a yes or no", None
    # The report prints the operator's own spelling beside the meaning, so "Y" reads back as
    # "Y -> yes" rather than disappearing because it happened to be understood.
    word = "yes" if value else "no"
    translated = None if norm == word else ("on_shelf", s, word)
    return value, None, translated


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
        # A header marked with the supplier's hash is read as the CODE column first - see the note
        # on _HASH_FIELDS for why the normalised core alone cannot tell "Model" from "Model #".
        if norm and _clean(head).rstrip().endswith("#"):
            coded = _HASH_FIELDS.get(norm)
            if coded is not None and coded not in mapping:
                field = coded
        if field is None and norm:
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


async def _lookup_existing_skus(db, skus: list[str]) -> set[str]:
    """Which of these SKUs already exist, case-insensitively - the DB half of SKU uniqueness.

    `assets.sku` is a plain TEXT column added by 0015 and is NULL on every unit that predates it, so
    a NULL never matches and an empty input is an empty answer: "not recorded" is not the same claim
    as "recorded as this value", exactly as it is for cost in the margin guard.
    """
    if not skus:
        return set()
    lowered = [s.lower() for s in skus]
    rows = (await db.execute(
        text("SELECT lower(sku) AS s FROM assets WHERE sku IS NOT NULL AND lower(sku) = ANY(:ss)"),
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
    # SKU uniqueness, the in-file half. Keyed like `seen` (lowercased) because "sku" is matched the
    # way a person reads it - case is not a different SKU.
    seen_sku: dict[str, int] = {}
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

        grade, grade_err, grade_note = _parse_grade(_cell(row, idx.get("grade")))
        if grade_err:
            flag("grade", grade_err)
        status, status_err, status_note = _parse_status(_cell(row, idx.get("status")))
        if status_err:
            flag("status", status_err)
        row_translations = [n for n in (status_note, grade_note) if n]
        price, price_err = _parse_price(_cell(row, idx.get("price")))
        if price_err:
            flag("price", price_err)
        # The margin guard's input. Same parser and same refusal rules as the other money columns.
        cost, cost_err = _parse_price(_cell(row, idx.get("cost")), "Cost")
        if cost_err:
            flag("cost", cost_err)
        # The workbook's other two money columns. Same parser, same refusal rules, different labels.
        fmv, fmv_err = _parse_price(_cell(row, idx.get("fmv")), "FMV")
        if fmv_err:
            flag("fmv", fmv_err)
        settlement, settlement_err = _parse_price(_cell(row, idx.get("settlement")), "Settlement")
        if settlement_err:
            flag("settlement", settlement_err)
        on_shelf, shelf_err, shelf_note = _parse_truth(_cell(row, idx.get("on_shelf")))
        if shelf_err:
            flag("on_shelf", shelf_err)
        if shelf_note:
            row_translations.append(shelf_note)

        if status == "listed" and price is None and not price_err:
            flag("price", "status is listed but there is no resale price - the shop cannot list a unit with no price")
        if status == "listed" and grade is None and not grade_err:
            flag("grade", "status is listed but there is no grade - the shop cannot list an ungraded unit")
        # MARGIN GUARD (importer layer). A row priced below its cost basis is blocked, and because the
        # import is all-or-nothing the whole FILE is then refused: a sheet that would put loss-makers
        # on the shelf is one to correct, not one to import around. The basis is the same
        # COALESCE(cost, settlement) the storefront floor and the staff doors use (services/margin),
        # so a row refused here is exactly the row the shop would refuse to publish.
        margin_issue = margin_refusal(price, cost, settlement)
        if margin_issue:
            flag("price", margin_issue)

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

        # SKU UNIQUENESS, the in-file half. A workbook that carries the same SKU twice is stating
        # that two units are one item, and letting both in would make "which unit is SKU #X" a
        # question with two answers. The collision is reported with the row it collides with, which
        # is the only way the operator can find it in a five-thousand-row sheet.
        sku = _cell(row, idx.get("sku"))
        if sku:
            sku_key = sku.lower()
            if sku_key in seen_sku:
                flag("sku", f"SKU {sku!r} also appears on row {seen_sku[sku_key]} of this file")
            else:
                seen_sku[sku_key] = row_no

        parts = {k: _cell(row, idx.get(k)) for k in ("audit", "cosmetic", "functional", "notes")}
        technical_notes = _merge_technical_notes(parts)

        parsed.append({
            "row": row_no, "serial_number": serial, "lot_number": lot_number, "grade": grade,
            "status": status, "sale_price_cents": price, "brand": brand, "category": category,
            "model": model, "asset_tag": _cell(row, idx.get("asset")),
            "technical_notes": technical_notes, "technical_parts": parts, "issues": row_issues,
            "translations": [{"field": f, "from": s, "to": t} for f, s, t in row_translations],
            # ---- the columns 0015_excel_foundation added, in two groups ----
            # Unit facts, written on the asset row.
            # The sheet has ONE "Class" column and it does two jobs: it picks the product's category
            # (the original contract, which creates a categories row) and it is the asset's own
            # class text (the column 0015 added). One cell, one read, two destinations.
            "class": _cell(row, idx.get("category")),
            "model_number": _cell(row, idx.get("model_number")),
            "upgrade": _cell(row, idx.get("upgrade")), "upgrade_desc": _cell(row, idx.get("upgrade_desc")),
            "audit_desc": _cell(row, idx.get("audit")), "cosmetics_desc": _cell(row, idx.get("cosmetic")),
            "functional_desc": _cell(row, idx.get("functional")),
            "fmv_cents": fmv, "settlement_cents": settlement, "on_shelf": on_shelf,
            "channel": _cell(row, idx.get("channel")), "sku": sku,
            "cost_cents": cost,
            "location": _cell(row, idx.get("location")), "pallet": _cell(row, idx.get("pallet")),
            # Batch facts. They ride on the row but belong to the LOT, so they are namespaced here
            # and lifted onto the lot record in _run_import - see the note there about the first row
            # winning.
            "lot_load_id": _cell(row, idx.get("load_id")), "lot_account": _cell(row, idx.get("account")),
            "lot_zone": _cell(row, idx.get("zone")), "lot_warehouse": _cell(row, idx.get("warehouse")),
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

    # SKU UNIQUENESS, the DB half. Same shape as the serial check above and for the same reason: a
    # SKU already on the shelf is a different operator mistake from one repeated inside the file, and
    # the two read differently in the report.
    existing_sku = await _lookup_existing_skus(db, [r["sku"] for r in parsed if r["sku"]])
    for record in parsed:
        if record["sku"] and record["sku"].lower() in existing_sku:
            issue = {"row": record["row"], "field": "sku",
                     "message": f"SKU {record['sku']!r} is already in the system"}
            record["issues"].append(issue)
            issues.append(issue)

    blocked = [r for r in parsed if r["issues"]]
    report["issues"] = issues

    # Every translation the mapper made, aggregated by (field, from, to) with its row count. The
    # per-row translation stays on the row, but 200 rows all reading "Active -> received" is not a
    # summary - it is noise. The operator needs the distinct list and how many rows each covers.
    tally: dict[Translation, int] = {}
    for record in parsed:
        for made in record["translations"]:
            key = (made["field"], made["from"], made["to"])
            tally[key] = tally.get(key, 0) + 1
    report["translations"] = [
        {"field": field, "from": source, "to": target, "rows": n}
        for (field, source, target), n in sorted(tally.items())
    ]
    report["sample"] = [{k: v for k, v in r.items()} for r in parsed[:PREVIEW_ROWS]]
    report["truncated"] = len(parsed) > PREVIEW_ROWS
    report["summary"] = {
        "rows": len(parsed),
        "ready": len(parsed) - len(blocked),
        "blocked": len(blocked),
        "translated": len([r for r in parsed if r["translations"]]),
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

    The identity of a product here is the triple the product sheet supplies, matched
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
        # Load ID, Account, Zone and Warehouse are facts about the BATCH, but a workbook repeats
        # them on every row of it. The first row that states one wins, and the rest are ignored
        # rather than compared: two rows of one lot disagreeing about their account is a supplier
        # sheet telling two stories, and silently keeping the last one would be worse than keeping
        # the first - the report names the lot either way.
        batch = next((r for r in parsed if r["lot_number"] == number and
                      any(r.get(k) for k in ("lot_load_id", "lot_account", "lot_zone", "lot_warehouse"))),
                     None)
        lot = Lot(lot_number=number, status="intake", notes="product import",
                  load_id=(batch or {}).get("lot_load_id") or None,
                  account=(batch or {}).get("lot_account") or None,
                  zone=(batch or {}).get("lot_zone") or None,
                  warehouse=(batch or {}).get("lot_warehouse") or None)
        db.add(lot)
        await db.flush()
        lot_ids[number] = lot.id
        lots_created.append({"lot_number": number, "id": lot.id,
                             "load_id": lot.load_id, "account": lot.account,
                             "zone": lot.zone, "warehouse": lot.warehouse})

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
            # The margin guard's input, carried onto the unit so every later door (pricing, listing,
            # the storefront) has the cost to check against without re-reading the sheet.
            cost_cents=record["cost_cents"],
            notes=record["technical_notes"] or None,
            condition_report=_condition_report(record),
            lot_id=lot_ids[record["lot_number"]],
            # The workbook's own columns, stored as the sheet wrote them. The four description
            # columns are ALSO folded into `notes`/`condition_report` above - that merge is the
            # app's derived reading of them, and these keep the sheet's own spelling of each, so a
            # later export returns what the supplier sent rather than this app's summary of it.
            asset=record["asset_tag"] or None,
            asset_class=record["class"] or None,
            model_number=record["model_number"] or None,
            upgrade=record["upgrade"] or None,
            upgrade_desc=record["upgrade_desc"] or None,
            audit_desc=record["audit_desc"] or None,
            cosmetics_desc=record["cosmetics_desc"] or None,
            functional_desc=record["functional_desc"] or None,
            fmv_cents=record["fmv_cents"],
            settlement_cents=record["settlement_cents"],
            on_shelf=record["on_shelf"],
            channel=record["channel"] or None,
            sku=record["sku"] or None,
            location=record["location"] or None,
            pallet=record["pallet"] or None,
        )
        db.add(asset)
        assets.append((asset, record))
    await db.flush()

    for asset, record in assets:
        db.add(StockMovement(asset_id=asset.id, qty=1, reason="product_import",
                             actor_staff_id=staff["id"]))
        await audit(db, "staff", entity="asset", entity_id=asset.id, action="product_import",
                    actor_id=staff["id"],
                    after={"serial": record["serial_number"], "lot": record["lot_number"],
                           "status": record["status"], "row": record["row"]})
    await audit(db, "staff", entity="import", action="product_import", actor_id=staff["id"],
                after={"file": filename, "rows": len(parsed), "lots": len(lot_ids),
                       "listed": len([r for r in parsed if r["status"] == "listed"])},
                meta={"source": "product_import", "products_created": len(products_created)})
    return {"lots_created": lots_created, "lots_reused": lots_reused,
            "products_created": products_created,
            # The commit response carries the workbook's own columns back, not just the three the
            # original door echoed. An importer that reports only what it always reported cannot be
            # checked against the sheet it just consumed, and "did my Model # land" is the first
            # question anyone asks of a twenty-six-column import.
            "assets": [{"row": r["row"], "asset_id": a.id, "serial_number": a.serial_number,
                        "lot_number": r["lot_number"], "status": a.status, "grade": a.grade,
                        "sale_price_cents": a.sale_price_cents,
                        "cost_cents": a.cost_cents,
                        "asset": a.asset, "class": a.asset_class, "model_number": a.model_number,
                        "upgrade": a.upgrade, "upgrade_desc": a.upgrade_desc,
                        "fmv_cents": a.fmv_cents, "settlement_cents": a.settlement_cents,
                        "channel": a.channel, "on_shelf": a.on_shelf, "pallet": a.pallet,
                        "sku": a.sku, "location": a.location,
                        "load_id": r.get("lot_load_id") or None, "account": r.get("lot_account") or None,
                        "zone": r.get("lot_zone") or None, "warehouse": r.get("lot_warehouse") or None}
                       for a, r in assets]}


def _condition_report(record: dict) -> dict | None:
    """The structured twin of the merged note. Returns None when the row carried nothing.

    An empty JSONB object is a claim that the row HAD a condition report and it was blank; None
    says the sheet did not describe this unit at all. The difference matters when someone later
    asks which units were imported without a condition description.
    """
    structured = record.get("technical_parts") or {}
    report = {k: _clean(structured.get(k, "")) for k in ("audit", "cosmetic", "functional")}
    if record.get("asset_tag"):
        report["asset_tag"] = record["asset_tag"]
    if record.get("technical_notes"):
        report["technical_notes"] = record["technical_notes"]
    report = {k: v for k, v in report.items() if v}
    return report or None


@router.post("/imports/products/preview")
async def preview_product_import(file: UploadFile = File(...),
                                   staff: dict = Depends(require_roles(*ROLES_PRODUCT_IMPORT)),
                                   db=Depends(get_db)):
    """Read the sheet and report what WOULD happen. Writes nothing, ever."""
    await _require_role(staff, ROLES_PRODUCT_IMPORT, ACTION_PRODUCT_IMPORT, None)
    data = await _read_upload(file)
    outcome = await parse_and_validate(db, data, file.filename or "")
    report = outcome["report"]
    report["mode"] = "preview"
    return report


@router.post("/imports/products/commit")
async def commit_product_import(file: UploadFile = File(...),
                                  staff: dict = Depends(require_roles(*ROLES_PRODUCT_IMPORT)),
                                  db=Depends(get_db)):
    """Write the sheet's rows. Refuses the whole file if any row is blocked."""
    await _require_role(staff, ROLES_PRODUCT_IMPORT, ACTION_PRODUCT_IMPORT, None)
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
