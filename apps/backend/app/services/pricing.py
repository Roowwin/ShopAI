"""Smart pricing for the import door: a SUGGESTED price, and the margin guard beside it.

WHY THIS FILE EXISTS. The importer writes what the sheet says and refuses to guess. That is right
for the fields the sheet owns - a serial, a grade, a status - but it leaves the one number the
whole business turns on unexamined: what the unit should sell for. `Resale` arrives as the
supplier's own asking price, and until now nothing in the import compared it to anything. This
module is that comparison, in two halves:

  1. PRICE INTELLIGENCE - a suggested price for every row, from the best evidence the row and the
     catalogue can offer (see the ladder below).
  2. MARGIN GUARD - a WARNING (never a refusal) on rows whose price leaves too little between the
     sheet's cost column and what the unit sells for.

WHY IT IS DETERMINISTIC AND NOT AN LLM. "Read the product description" is a natural-language
instruction, and the obvious build is a model call per row. That build is wrong here, for four
reasons that are properties of this door rather than tastes:

  * THE FILE IS ALL-OR-NOTHING. Preview and commit run the identical parse, and the number the
    operator approves is the number that is written. A model that answers differently on the second
    call breaks that identity - the operator would be approving a preview of a different file.
  * LATENCY AND COST SCALE WITH THE FILE, not with the request: a corporate workbook is hundreds of
    rows and the cap is 5000, so a per-row round trip is minutes-to-hours of preview for a screen
    that must answer before the operator presses anything.
  * THE IMPORT IS NOT CHAT-DISPATCHABLE. `staff_imports` is deliberately absent from
    `staff_ops.GUARDED_ACTIONS` and `staff_ai.TOOL_ROLES`, so an agent can never run this door; a
    model inside it would be an agent reachable by a route with no grant surface.
  * A SUGGESTION NOBODY CAN AUDIT IS NOT A SUGGESTION. The description signals below are a closed,
    spelled-out lexicon, so every cent of the number can be traced to a phrase in the row or to a
    named aggregate in the database. `reasons` carries that trail onto the row.

WHAT IS READ FROM THE DESCRIPTION. The merged technical block the importer already builds
(Audit + Cosmetic + Functional, plus the free-text Notes column) is scanned for the condition
phrases in `_CONDITION_SIGNALS`, and each hit moves the price by a fixed percentage. The lexicon is
small on purpose: a large one starts matching prose that was never a condition claim, and a wrong
price that reaches a shop page is the one error here a customer sees. Two properties make it safe
to run on real sheets:

  * NEGATION IS DISMISSED. "No cracks", "no scuffs", "without charger" are the sheet saying the
    fault is ABSENT, so a phrase preceded within a couple of words by a negator is skipped rather
    than scored - see `_NEGATED_BEFORE`. Without this the single most common way to describe a
    CLEAN unit would read as damage.
  * THE TOTAL IS CLAMPED to `ADJUSTMENT_FLOOR_PCT`..`ADJUSTMENT_CEILING_PCT`. A description is
    free text; the clamp is what keeps a chatty one from running the price away from its basis.

THE LADDER. A suggestion is only as good as its basis, so the basis is chosen in a fixed order and
NAMED on every row rather than blended:

  1. `market`  - the average `sale_price_cents` of OTHER units of the same model at the same grade.
                 This is the strongest evidence available because it is what human operators
                 actually committed for that model at that grade. It is the same aggregate the Set
                 Price dialog's Market Hint shows, and it is scoped the same way and for the same
                 reason (see `staff_ai.market_hint`): on the model STRING and the grade, not on
                 `product_id`, because one model arrives under several product records.
  2. `fmv`     - the sheet's own FMV column: the supplier's statement of fair market value.
  3. `cost`    - the sheet's Settlement column marked up by `TARGET_MARKUP_PCT`. The floor of the
                 ladder: it is a cost-plus guess and it says so.
  4. `none`    - nothing to go on, and `suggested_price_cents` is null. A blank is the honest
                 answer here; a made-up number is not. The row is still imported exactly as the
                 sheet wrote it.

`GRADE_REQUIRED_FOR_MARKET` is why tier 1 needs a grade: a model-wide average across grades would
quietly price a D unit off A units. With no grade the row falls to the sheet's own columns, which
is the weaker but truthful basis.

THE MARGIN GUARD IS A WARNING. It never blocks an import and never edits a price. A low-margin lot
is a commercial decision - a corporate contract may clear stock at 8% deliberately - so the guard's
job is to make the operator look, and the report counts the rows it looked at. It is deliberately
NOT in `report["issues"]`: that list is what refuses a file (the importer's all-or-nothing gate),
and promoting a commercial opinion onto it would make a perfectly legal lot un-importable. That
distinction is load-bearing, not cosmetic.

WHAT IT COMPARES. Margin needs a cost, and the import has exactly one cost column: Settlement, the
amount this unit was settled for. `cost_basis_cents` prefers `cost_cents` - the schema's canonical
cost field - and falls back to the sheet's settlement, so the guard states the same arithmetic the
rest of the app would. Rows with neither cannot be judged: they are counted under `cost_unknown`
in the report and carry no warning, because "no cost column on this sheet" is a fact about the
WORKBOOK, and repeating it on six hundred rows is noise rather than a finding.

The price the margin is measured against is the sheet's Resale when it has one, and the SUGGESTED
price when it does not - a row the supplier left unpriced is exactly where the guard has something
to add. `price_source` says which of the two was used.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

# ---------------------------------------------------------------------------
# The published numbers. These are the guard's settings, not constants of nature: they are module
# level so the report can print them back to the operator, and so a test asserts the boundary it
# documents rather than a copy of it.
# ---------------------------------------------------------------------------

# Below this gross margin a row is flagged. Gross margin is the share of the sale price that is not
# the unit's cost: (price - cost) / price. It is measured against the PRICE, not the cost, because
# "half of what I sell it for is gone" is the way the number is read out loud.
LOW_MARGIN_PCT = 15.0
# The cost-plus fallback. 60% markup over settlement is the mid-point of the refurb desk's own
# ranges and is a STATED assumption - the basis label prints it, so a reader who disagrees with the
# number knows precisely which assumption to argue with.
TARGET_MARKUP_PCT = 60
# The clamp on the description's total effect. Asymmetric on purpose: the lexicon is more confident
# about faults than about praise (a "pristine" claim in a supplier sheet is marketing, a "cracked
# screen" is a fact), so a description may talk a price down further than it may talk it up.
ADJUSTMENT_FLOOR_PCT = -30
ADJUSTMENT_CEILING_PCT = 15

# Basis names. Carried on every row so the UI can label the number and a test can assert WHICH
# evidence produced it rather than only the cents, which several bases could coincidentally share.
BASIS_MARKET = "market"
BASIS_FMV = "fmv"
BASIS_COST = "cost"
BASIS_NONE = "none"

BASIS_LABELS = {
    BASIS_MARKET: "average resale of other units of this model at the same grade",
    BASIS_FMV: "the sheet's own FMV for this unit",
    BASIS_COST: f"settlement cost plus a {TARGET_MARKUP_PCT}% markup",
    BASIS_NONE: "no comparables, no FMV and no settlement on this row",
}

# Band names for the margin verdict, and the label a person reads.
BAND_LOW = "low"
BAND_HEALTHY = "healthy"
BAND_UNKNOWN = "unknown"

# ---------------------------------------------------------------------------
# The condition lexicon: (pattern, percent, label). Order does not matter - every pattern that
# matches is applied and the hits are summed - so a row whose cosmetic column says "cracked screen,
# otherwise pristine" carries both, which is what the operator wrote.
#
# Each pattern is anchored on a word boundary and keeps to vocabulary a condition column actually
# uses. The negative entries are the ones that matter commercially, so they carry the larger
# movements; the positive ones are small corrections, for the reason given at the clamp above.
# ---------------------------------------------------------------------------
_CONDITION_SIGNALS: tuple[tuple[str, int, str], ...] = (
    # Dead or parted-out: the unit stopped being a working machine.
    (r"\bfor parts\b|\bnot working\b|\bno power\b|\bdoes not (?:power|boot|charge|turn on)\b"
     r"|\bwon'?t (?:power|boot|turn on)\b|\bdead\b|\bfaulty\b|\bunbootable\b",
     -25, "does not work"),
    (r"\bwater damage\b|\bliquid damage\b|\bcorrosion\b", -20, "liquid damage"),
    # A cracked panel is the single most expensive cosmetic fault on a laptop or phone.
    (r"\bcrack(?:ed|s)?\b|\bshatter(?:ed)?\b|\bbroken screen\b", -12, "cracked"),
    (r"\bwon'?t charge\b|\bnot charging\b|\bno charge\b|\bfailed battery\b"
     r"|\bbattery (?:service|replace(?:ment)? needed)\b", -10, "charging or battery fault"),
    (r"\bheavy (?:wear|scratches|scuffing|dents)\b|\bheavily (?:worn|used)\b|\bdeep scratches\b",
     -8, "heavy wear"),
    (r"\bdent(?:ed|s)?\b|\bbent\b|\bwarped\b", -8, "dented"),
    (r"\bmissing (?:charger|parts|accessories|keyboard|battery|cover)\b|\bno charger\b"
     r"|\bcharger not included\b|\bmissing\b", -5, "missing parts"),
    (r"\bdiscolou?r(?:ed|ation)\b|\byellow(?:ed|ing)\b", -4, "discoloured"),
    # No bare "wear" here on purpose: it is the one word that appears inside a STRONGER signal's
    # own phrase, so "heavy wear" would score -8 and -4 for one sentence. The heavier phrase owns
    # that reading and this pattern keeps to marks that name a mark.
    (r"\bscratch(?:ed|es)?\b|\bscuff(?:ed|s|ing)?\b|\bmarks?\b", -4, "cosmetic marks"),
    # The repairs and condition claims that raise a price. Small, per the clamp's note.
    (r"\bsealed\b|\bunopened\b|\bnever used\b|\bbrand new\b", 10, "sealed or unused"),
    (r"\bpristine\b|\bas new\b|\blike new\b|\bimmaculate\b", 8, "as new"),
    (r"\bbattery health (?:9\d|100)\s?%", 6, "strong battery"),
    (r"\bexcellent\b", 5, "excellent"),
    (r"\bwarranty\b", 4, "warranty"),
    (r"\bnew (?:screen|battery|keyboard|ssd|housing|hinge)\b"
     r"|\b(?:screen|battery|keyboard|ssd|housing|hinge) replaced\b", 3, "part replaced"),
)
_COMPILED_SIGNALS = tuple((re.compile(p, re.I), pct, label) for p, pct, label in _CONDITION_SIGNALS)

# A negator in the couple of words immediately before a matched phrase inverts it: "no cracks" and
# "without a charger" are the sheet saying the fault is NOT there. Checked against the text
# preceding each match only, because the phrase itself is already consumed.
_NEGATED_BEFORE = re.compile(
    r"(?:\bno\b|\bnot\b|\bwithout\b|\bzero\b|\bnil\b|\bfree of\b|\bfree from\b|\bnone\b)"
    r"(?:\s+\w+){0,2}\s*$", re.I)


@dataclass(frozen=True)
class PriceSuggestion:
    """A suggested price and the trail that produced it. Cents in, cents out - never a float."""
    suggested_price_cents: int | None
    basis: str
    basis_label: str
    base_cents: int | None
    sample_size: int
    adjustment_pct: int
    reasons: list[dict] = field(default_factory=list)
    dismissed: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "suggested_price_cents": self.suggested_price_cents,
            "basis": self.basis,
            "basis_label": self.basis_label,
            "base_cents": self.base_cents,
            "sample_size": self.sample_size,
            "adjustment_pct": self.adjustment_pct,
            "reasons": self.reasons,
            "dismissed": self.dismissed,
        }


@dataclass(frozen=True)
class MarginVerdict:
    """What the price leaves after the unit's cost, or an honest admission that it is unknowable."""
    cost_cents: int | None
    cost_source: str | None
    price_cents: int | None
    price_source: str | None
    margin_pct: float | None
    band: str

    @property
    def low(self) -> bool:
        return self.band == BAND_LOW

    def as_dict(self) -> dict:
        return {
            "cost_cents": self.cost_cents,
            "cost_source": self.cost_source,
            "price_cents": self.price_cents,
            "price_source": self.price_source,
            "margin_pct": (None if self.margin_pct is None else round(self.margin_pct, 1)),
            "band": self.band,
        }


def condition_adjustment(*parts: str) -> tuple[int, list[dict], list[str]]:
    """The description's total effect on the price: (clamped percent, applied hits, dismissed hits).

    The two returned lists are the audit trail. `applied` is what moved the number, `dismissed` is
    what a negator turned off - kept separate and reported rather than silently dropped, because
    "the guard read my Cosmetic column as saying there are no cracks" is a claim the operator must
    be able to check from the preview alone.
    """
    text = " ".join(p for p in parts if p)
    total = 0
    applied: list[dict] = []
    dismissed: list[str] = []
    if not text:
        return 0, applied, dismissed
    for pattern, pct, label in _COMPILED_SIGNALS:
        # ONE SCORE PER SIGNAL, however many times the description spells it. A pattern is a claim
        # ("there are cosmetic marks here"), not a word to be counted: "scuffed, scratched, marked"
        # is one operator saying one thing three ways, and scoring it three times would make a
        # chatty description worth less than a terse one describing the same unit.
        hit = None
        negated = False
        for match in pattern.finditer(text):
            if _NEGATED_BEFORE.search(text[:match.start()]):
                negated = True
                continue
            hit = match
            break
        if hit is None:
            # Every appearance was negated: the sheet is asserting the fault is ABSENT, so the
            # label is reported as dismissed and nothing moves.
            if negated and label not in dismissed:
                dismissed.append(label)
            continue
        total += pct
        applied.append({"label": label, "pct": pct, "phrase": hit.group(0)})
    clamped = max(ADJUSTMENT_FLOOR_PCT, min(ADJUSTMENT_CEILING_PCT, total))
    return clamped, applied, dismissed


def _adjusted(cents: int, pct: int) -> int:
    """Apply a whole-percent adjustment in Decimal and land on whole cents.

    Integer arithmetic on a percentage is the classic place a price loses a cent, and this number is
    written to a money column, so it is quantised explicitly rather than truncated.
    """
    if pct == 0:
        return int(cents)
    return int((Decimal(int(cents)) * (100 + pct) / 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def suggest_price(*, comparables: dict | None, fmv_cents: int | None, settlement_cents: int | None,
                  description: str = "", grade: str | None = None) -> PriceSuggestion:
    """The ladder, walked once: the best basis this row has, adjusted by its description.

    `comparables` is `{"sample_size", "avg_cents"}` for this row's (model, grade) - already looked up
    in bulk by the caller, because a per-row query here would be hundreds of round trips for one
    preview. A missing or empty one simply means tier 1 is not available.
    """
    adjustment, reasons, dismissed = condition_adjustment(description)

    base: int | None = None
    basis = BASIS_NONE
    sample_size = 0
    # Tier 1 needs BOTH halves of a key: a model to match and a grade to match it at. A model-wide
    # average would price a D unit off A units, so a row without a grade falls through instead.
    if grade and comparables and int(comparables.get("sample_size") or 0) > 0 \
            and comparables.get("avg_cents") is not None:
        base = int(comparables["avg_cents"])
        sample_size = int(comparables["sample_size"])
        basis = BASIS_MARKET
    elif fmv_cents is not None:
        base = int(fmv_cents)
        basis = BASIS_FMV
    elif settlement_cents is not None:
        base = _adjusted(int(settlement_cents), TARGET_MARKUP_PCT)
        basis = BASIS_COST

    if base is None:
        # Nothing on this row and nothing in the catalogue: say so and move on. The row still
        # imports; only the suggestion is absent.
        return PriceSuggestion(None, BASIS_NONE, BASIS_LABELS[BASIS_NONE], None, 0, adjustment,
                                reasons, dismissed)

    # Tier 3's base is already the marked-up cost, so the condition adjustment is applied to it the
    # same way as to the others: the question every basis answers is "what is THIS unit worth",
    # and a damaged unit is worth less however the starting number was reached.
    price = _adjusted(base, adjustment)
    # A price of zero is not a price. The floor keeps a fully-clamped wreck from being suggested at
    # nothing, which the pricing door would then reject as a value anyway.
    price = max(price, 1)
    return PriceSuggestion(price, basis, BASIS_LABELS[basis], base, sample_size, adjustment,
                            reasons, dismissed)


def margin_verdict(*, sale_price_cents: int | None, suggested_price_cents: int | None,
                   cost_cents: int | None, settlement_cents: int | None) -> MarginVerdict:
    """The guard's arithmetic for one row: which cost, which price, what is left.

    Both halves may be genuinely absent and the verdict says so instead of printing a 0.0% that
    would read as a catastrophic margin when the truth is that the workbook never carried the
    column.
    """
    if cost_cents is not None:
        cost, cost_source = int(cost_cents), "cost_cents"
    elif settlement_cents is not None:
        cost, cost_source = int(settlement_cents), "settlement"
    else:
        cost, cost_source = None, None

    # The sheet's own price wins where it has one: it is what the operator will actually list at,
    # and the suggestion is advice beside it. The suggestion is used only where the sheet was
    # silent, which is the row the guard most needs to speak about.
    if sale_price_cents is not None:
        price, price_source = int(sale_price_cents), "resale"
    elif suggested_price_cents is not None:
        price, price_source = int(suggested_price_cents), "suggested"
    else:
        price, price_source = None, None

    if cost is None or price is None or price <= 0:
        return MarginVerdict(cost, cost_source, price, price_source, None, BAND_UNKNOWN)

    margin = (price - cost) / price * 100.0
    band = BAND_LOW if margin < LOW_MARGIN_PCT else BAND_HEALTHY
    return MarginVerdict(cost, cost_source, price, price_source, margin, band)


def margin_warning(verdict: MarginVerdict, currency: str = "AUD") -> str | None:
    """The sentence the operator reads on a flagged row, or None when there is nothing to say.

    Written here rather than in the UI so the API payload - which is what a test asserts on and what
    any other client would show - carries the same words the screen does.
    """
    if not verdict.low or verdict.margin_pct is None:
        return None
    where = "sells below cost" if verdict.margin_pct < 0 else "low margin"
    source = ("the sheet's resale price" if verdict.price_source == "resale"
              else "the suggested price")
    return (f"{where}: {verdict.margin_pct:.1f}% at ${verdict.price_cents / 100:,.2f} {currency} "
            f"against a {verdict.cost_source} cost of ${verdict.cost_cents / 100:,.2f} - "
            f"{source}; the guard asks for {LOW_MARGIN_PCT:.0f}%")


def describe_method() -> dict:
    """The report's own account of how the number was reached, thresholds included.

    The operator is being handed a price the app invented, so the payload states the rules it
    invented it by, in the same object that carries the number. A method described only in a source
    file is a method the person reading the screen cannot check.
    """
    return {
        "low_margin_pct": LOW_MARGIN_PCT,
        "target_markup_pct": TARGET_MARKUP_PCT,
        "adjustment_floor_pct": ADJUSTMENT_FLOOR_PCT,
        "adjustment_ceiling_pct": ADJUSTMENT_CEILING_PCT,
        "bases": [BASIS_MARKET, BASIS_FMV, BASIS_COST],
        "note": ("Suggestions are advisory: the importer never writes a price the sheet did not "
                 "carry. Margin flags are warnings and never refuse a file."),
    }
