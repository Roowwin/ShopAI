"""Logistics intelligence: what needs attention today, which carrier to use, and which order a
bank credit paid for.

WHY THIS FILE EXISTS. `orders.status` has always admitted `shipped` and `delivered`, and until
0018_logistics nothing could write either - so the platform took money and then stopped being able
to say what happened to it. Three questions follow directly from that gap, and this module answers
all three from the same two facts (a parcel and a bank credit):

  1. ALERTS - which orders need a human today: paid and not shipped, past the carrier's promise,
     sitting in transit too long, delivered with money still unreconciled, or never paid at all.
  2. CARRIER ANALYSIS - what each carrier actually costs and how long it actually takes, and which
     one to use for the next parcel.
  3. RECONCILIATION - which order(s) a credit on the bank statement settled.

WHY IT IS DETERMINISTIC AND NOT AN LLM. All three are "read this data and tell me what it means",
and the obvious build is a model call. It is the wrong build here for the same reasons it was wrong
in `services/pricing.py`, plus two of its own:

  * AN ALERT IS A CLAIM ABOUT MONEY, repeated on a screen every morning. "Order #501 is 6 days
    overdue" has to be the same sentence tomorrow for the same data, and has to be checkable by
    looking at order #501. A model that phrases it differently each run is not a faster analyst,
    it is an unverifiable one.
  * THE THRESHOLDS ARE THE PRODUCT. "Overdue" is a number somebody chose; it is published in
    `describe_rules()`, printed on the screen, and asserted at the boundary in the tests. A model
    call would hide the one part an operator would want to argue with.
  * RECONCILIATION IS BOOKKEEPING. A wrong match moves money in the accounts, and the suggestion
    therefore has to show its working - which payment, which amount, which date gap - so a human
    can confirm it in the second it takes to read. The engine returns the arithmetic, not a verdict.

THE ENGINES ARE PURE. Each takes already-fetched rows and returns plain structures; the SQL lives
in `api/v1/staff_logistics.py`. That split is what lets the interesting half - the thresholds, the
sample floor, the match scoring - be tested as arithmetic instead of through a request, and it is
the same division `services/pricing.py` uses.

WHAT THIS MODULE DOES NOT DO. It never writes. It has no database handle, no session, no time
source: every "days ago" it reads was measured by the caller against `now()`. A pure function that
called `now()` itself would be untestable at its own boundaries, and every alert here is a boundary
case.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime

# ---------------------------------------------------------------------------
# The published rules. Module level so the report can print them back and the tests can assert the
# boundary the screen documents rather than a copy of the number.
# ---------------------------------------------------------------------------

# Money is in and nothing has moved. Three days is the promise the storefront's own copy makes
# ("dispatched within 2 business days"), so day 3 is the first day it is actually broken.
OVERDUE_SHIP_DAYS = 3
# How late a parcel must be before a carrier's own promise counts as slipped. One day, because a
# promise date is a day, not an instant, and flagging the same day reads as noise.
PROMISE_SLIP_DAYS = 1
# A parcel with no delivery scan this long after dispatch is not "in transit", it is unaccounted
# for. Set above the longest domestic AU transit a sane carrier quotes (5-6 days) so the alert does
# not fire on every interstate parcel.
STALE_TRANSIT_DAYS = 7
# Delivered, money in the bank, nothing reconciled. The grace exists because a card settlement does
# not land the same day as the delivery scan, and an alert that fires during the normal lag is an
# alert nobody reads.
UNRECONCILED_DAYS = 2
# Never paid. Well past the reservation window, so an abandoned checkout is not mistaken for a slow
# payer.
ABANDONED_DAYS = 7
# The fewest DELIVERED parcels a carrier needs before its average is allowed to drive a
# recommendation. Below this a carrier is listed (the operator can see it exists) but is excluded
# from "cheapest" and "fastest", because one 4-day parcel and one 40-dollar parcel are not a
# performance record - and a recommendation built on them would be an accident with a number
# attached.
MIN_CARRIER_SAMPLE = 3
# How many payments one payout may be matched to as a COMBINATION. A bank credit that settles a
# basket of orders is normal; a credit that needs twenty orders to add up is almost certainly the
# wrong credit, and an unbounded subset search would be both slow and confidently wrong.
MAX_COMBINATION = 4

ALERT_CRITICAL = "critical"
ALERT_WARNING = "warning"

# Kind -> (severity, the sentence's shape). The severity is the module's judgement and lives here
# with the threshold that produces it, not in the UI: "the customer paid and we have not shipped" is
# critical in a way "this parcel is ageing" is not, and a page that re-decided that could disagree
# with the API about it.
ALERT_KINDS: dict[str, str] = {
    "paid_not_shipped": ALERT_CRITICAL,
    "promise_slipped": ALERT_WARNING,
    "stale_transit": ALERT_WARNING,
    "delivered_unreconciled": ALERT_WARNING,
    "never_paid": ALERT_WARNING,
}

# Match confidence bands. Named so the UI can say "strong match" rather than showing a bare number
# whose scale the operator has no way to calibrate.
CONFIDENCE_STRONG = "strong"
CONFIDENCE_LIKELY = "likely"
CONFIDENCE_POSSIBLE = "possible"


def _money(cents: int) -> str:
    return f"${cents / 100:,.2f}"


def _days(n: int) -> str:
    return f"{n} day" + ("" if n == 1 else "s")


# ---------------------------------------------------------------------------
# 1. Alerts
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Alert:
    """One order that needs a human, in the words the screen prints.

    `kind` is the machine-readable condition and `message` is the sentence; both travel, because the
    UI groups by kind while the operator reads the message. `order_id` is in the message as well as
    the field - the brief's own example ("Order #501 is overdue for shipping") is the right shape:
    an alert that does not name the order makes the operator go and find it.
    """
    kind: str
    severity: str
    order_id: int
    message: str
    days: int = 0
    amount_cents: int = 0

    def as_dict(self) -> dict:
        return {"kind": self.kind, "severity": self.severity, "order_id": self.order_id,
                "message": self.message, "days": self.days, "amount_cents": self.amount_cents,
                "href": f"/admin/orders?order={self.order_id}"}


def order_alerts(rows: list[dict]) -> list[Alert]:
    """The alert feed, one entry per condition, ordered worst-first.

    The row contract, and it is deliberately FACTS rather than judgements - every day count below
    was measured by the caller against its own `now()`, so this function has no clock:

        order_id              int
        status                one of the orders_status_check vocabulary
        days_since_placed     int
        days_since_paid       int | None       (None = never paid)
        total_cents           int
        shipment              None, or {carrier, dispatched_days_ago, promised_days_ago | None,
                                        delivered, delivered_days_ago | None}
        unmatched_paid_cents  int              (money taken that no payout has settled)

    AT MOST ONE ALERT PER SHIPMENT. A parcel that is both past its promise and long in transit is
    one problem, and the promise is the more actionable of the two ("ring the carrier, you have a
    date to quote"), so the slip wins and the stale-transit alert is suppressed for that parcel.
    Two rows for one parcel is how an alert list stops being read.
    """
    alerts: list[Alert] = []
    for r in rows:
        oid = int(r["order_id"])
        status = r["status"]
        shipment = r.get("shipment") or {}

        if status == "paid" and not shipment and r.get("days_since_paid") is not None \
                and int(r["days_since_paid"]) >= OVERDUE_SHIP_DAYS:
            d = int(r["days_since_paid"])
            alerts.append(Alert("paid_not_shipped", ALERT_KINDS["paid_not_shipped"], oid,
                                f"Order #{oid} has been paid for {_days(d)} and has not shipped.",
                                days=d, amount_cents=int(r.get("total_cents") or 0)))
            continue

        if shipment and not shipment.get("delivered"):
            slip = shipment.get("promised_days_ago")
            if slip is not None and int(slip) >= PROMISE_SLIP_DAYS:
                d = int(slip)
                alerts.append(Alert("promise_slipped", ALERT_KINDS["promise_slipped"], oid,
                                    f"Order #{oid} is {_days(d)} past {shipment['carrier']}'s "
                                    f"promise, dispatched {_days(int(shipment['dispatched_days_ago']))} ago.",
                                    days=d))
                continue
            transit = int(shipment.get("dispatched_days_ago") or 0)
            if transit >= STALE_TRANSIT_DAYS:
                alerts.append(Alert("stale_transit", ALERT_KINDS["stale_transit"], oid,
                                    f"Order #{oid} has been in transit {_days(transit)} with "
                                    f"{shipment['carrier']} and has no delivery scan.", days=transit))
                continue

        unmatched = int(r.get("unmatched_paid_cents") or 0)
        delivered_days = shipment.get("delivered_days_ago") if shipment else None
        if shipment and shipment.get("delivered") and unmatched > 0 and delivered_days is not None \
                and int(delivered_days) >= UNRECONCILED_DAYS:
            d = int(delivered_days)
            alerts.append(Alert("delivered_unreconciled", ALERT_KINDS["delivered_unreconciled"], oid,
                                f"Order #{oid} was delivered {_days(d)} ago and its "
                                f"{_money(unmatched)} is not matched to a bank payout.",
                                days=d, amount_cents=unmatched))
            continue

        if status == "pending" and int(r.get("days_since_placed") or 0) >= ABANDONED_DAYS:
            d = int(r["days_since_placed"])
            alerts.append(Alert("never_paid", ALERT_KINDS["never_paid"], oid,
                                f"Order #{oid} was placed {_days(d)} ago and was never paid.",
                                days=d, amount_cents=int(r.get("total_cents") or 0)))

    # Worst first: critical before warning, then the longest-standing, then the order number so the
    # list is stable between two reads of unchanged data (an alert list that reshuffles makes the
    # operator re-read all of it).
    rank = {ALERT_CRITICAL: 0, ALERT_WARNING: 1}
    alerts.sort(key=lambda a: (rank.get(a.severity, 2), -a.days, a.order_id))
    return alerts


def alert_counts(alerts: list[Alert]) -> dict:
    """The feed's summary: per-kind counts, and the two severities the dashboard tiles read."""
    by_kind: dict[str, int] = {kind: 0 for kind in ALERT_KINDS}
    for a in alerts:
        by_kind[a.kind] = by_kind.get(a.kind, 0) + 1
    return {
        "total": len(alerts),
        "critical": len([a for a in alerts if a.severity == ALERT_CRITICAL]),
        "warning": len([a for a in alerts if a.severity == ALERT_WARNING]),
        "by_kind": by_kind,
    }


# ---------------------------------------------------------------------------
# 2. Carrier analysis
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CarrierStat:
    """What one carrier has actually done: volume, lateness, speed and price."""
    carrier: str
    shipments: int
    delivered: int
    in_transit: int
    on_time: int
    on_time_pct: float | None
    avg_transit_days: float | None
    avg_cost_cents: int | None
    last_dispatched_days_ago: int | None

    @property
    def thin(self) -> bool:
        """Too few deliveries for its averages to mean anything - excluded from recommendations."""
        return self.delivered < MIN_CARRIER_SAMPLE

    def as_dict(self) -> dict:
        return {"carrier": self.carrier, "shipments": self.shipments, "delivered": self.delivered,
                "in_transit": self.in_transit, "on_time": self.on_time,
                "on_time_pct": (None if self.on_time_pct is None else round(self.on_time_pct, 1)),
                "avg_transit_days": (None if self.avg_transit_days is None
                                     else round(self.avg_transit_days, 1)),
                "avg_cost_cents": self.avg_cost_cents,
                "last_dispatched_days_ago": self.last_dispatched_days_ago,
                "thin": self.thin}


def carrier_stats(rows: list[dict]) -> list[CarrierStat]:
    """Per-carrier aggregates over shipments.

    The row contract: {carrier, cost_cents, dispatched_days_ago, delivered, transit_days | None,
    on_time | None}. `transit_days` and `on_time` are computed by the caller from the timestamps
    (SQL is the only place that knows both ends without a second clock), and are None for a parcel
    still moving - which is why every average below divides by DELIVERED counts, never by volume.

    ON-TIME IS ONLY MEASURED WHERE A PROMISE WAS MADE. A carrier that never quotes a promise date
    cannot miss one, and counting its parcels as on-time would let it win a race it did not run; the
    percentage is therefore None (not 100) when no promise exists, and the UI says "no promise
    recorded" rather than printing a perfect score.
    """
    buckets: dict[str, dict] = {}
    for r in rows:
        carrier = str(r["carrier"])
        b = buckets.setdefault(carrier, {"shipments": 0, "delivered": 0, "in_transit": 0, "on_time": 0,
                                         "promised": 0, "transit": [], "cost": [],
                                         "last": None})
        b["shipments"] += 1
        b["cost"].append(int(r.get("cost_cents") or 0))
        seen = r.get("dispatched_days_ago")
        if seen is not None and (b["last"] is None or int(seen) < b["last"]):
            b["last"] = int(seen)
        if r.get("delivered"):
            b["delivered"] += 1
            if r.get("transit_days") is not None:
                b["transit"].append(float(r["transit_days"]))
            if r.get("on_time") is not None:
                b["promised"] += 1
                if r["on_time"]:
                    b["on_time"] += 1
        else:
            b["in_transit"] += 1

    out: list[CarrierStat] = []
    for carrier, b in buckets.items():
        out.append(CarrierStat(
            carrier=carrier,
            shipments=b["shipments"],
            delivered=b["delivered"],
            in_transit=b["in_transit"],
            on_time=b["on_time"],
            on_time_pct=(100.0 * b["on_time"] / b["promised"]) if b["promised"] else None,
            avg_transit_days=(sum(b["transit"]) / len(b["transit"])) if b["transit"] else None,
            avg_cost_cents=(int(round(sum(b["cost"]) / len(b["cost"]))) if b["cost"] else None),
            last_dispatched_days_ago=b["last"],
        ))
    # Busiest first, then by name so two carriers with equal volume do not swap places between
    # reads.
    out.sort(key=lambda s: (-s.shipments, s.carrier))
    return out


def recommend_carrier(stats: list[CarrierStat], *, preference: str = "balanced") -> dict:
    """Which carrier to use next, from measured numbers, or an honest refusal to pick.

    `preference` is "cheapest", "fastest" or "balanced" and is a CLOSED set - the caller's three
    chips - because an unrecognised one silently grading to a default would answer a question
    nobody asked.

    The balanced score is `avg_transit / fastest_transit + avg_cost / cheapest_cost`, equal weights,
    computed over the ELIGIBLE set only. Normalising against the best in each column is what makes
    a dollar and a day comparable at all; an absolute formula would be a units error wearing a
    number. Ties break on the on-time rate, then on the carrier name, so the answer is stable.

    A carrier below `MIN_CARRIER_SAMPLE` deliveries is never recommended and never sets the bar, and
    when NOTHING clears the floor the answer is `carrier: None` with the reason spelled out. "No
    recommendation yet" is a real answer that a screen can act on; a pick made from two parcels is
    not.
    """
    eligible = [s for s in stats if not s.thin and s.avg_transit_days is not None
                and s.avg_cost_cents is not None]
    note = None
    if not eligible:
        note = (f"no carrier has {MIN_CARRIER_SAMPLE} or more DELIVERED parcels with both a transit "
                "time and a cost on record yet, so nothing here is a performance record")
        return {"preference": preference, "carrier": None, "why": None, "fastest": None,
                "cheapest": None, "eligible": 0, "note": note}

    fastest = min(eligible, key=lambda s: (s.avg_transit_days, s.carrier))
    cheapest = min(eligible, key=lambda s: (s.avg_cost_cents, s.carrier))
    if preference == "fastest":
        pick, why = fastest, "the quickest average transit among the carriers with a record"
    elif preference == "cheapest":
        pick, why = cheapest, "the lowest average cost among the carriers with a record"
    else:
        best_transit = fastest.avg_transit_days or 1.0
        best_cost = max(cheapest.avg_cost_cents or 1, 1)
        pick = min(eligible, key=lambda s: (s.avg_transit_days / best_transit
                                            + s.avg_cost_cents / best_cost,
                                            -(s.on_time_pct or 0), s.carrier))
        why = "the best balance of measured transit time and measured cost"

    return {
        "preference": preference,
        "carrier": pick.carrier,
        "why": why,
        "fastest": {"carrier": fastest.carrier, "avg_transit_days": round(fastest.avg_transit_days, 1),
                    "avg_cost_cents": fastest.avg_cost_cents},
        "cheapest": {"carrier": cheapest.carrier, "avg_cost_cents": cheapest.avg_cost_cents,
                     "avg_transit_days": round(cheapest.avg_transit_days, 1)},
        "eligible": len(eligible),
        "note": (f"from {pick.delivered} delivered parcels ({pick.on_time_pct:.0f}% on time)"
                 if pick.on_time_pct is not None
                 else f"from {pick.delivered} delivered parcels (no promise dates recorded)"),
    }


# ---------------------------------------------------------------------------
# 3. Reconciliation
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class MatchSuggestion:
    """A candidate settlement of one bank credit: which payments, how sure, and why.

    `reasons` is the working, not decoration. A reconciliation a human cannot check in one read is
    one they will either rubber-stamp or ignore, and both are worse than doing it by hand.
    """
    payment_ids: list[int] = field(default_factory=list)
    order_ids: list[int] = field(default_factory=list)
    total_cents: int = 0
    score: int = 0
    confidence: str = CONFIDENCE_POSSIBLE
    reasons: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"payment_ids": self.payment_ids, "order_ids": self.order_ids,
                "total_cents": self.total_cents, "score": self.score,
                "confidence": self.confidence, "reasons": self.reasons}


def _reference_hit(bank_ref: str, provider_ref: str | None, order_id: int) -> bool:
    """Does the bank's own reference mention this payment or its order?

    Compared on letters and digits only, so `RF-501`, `rf 501` and `RF/000501` all hit order 501 -
    banks punctuate a reference their own way and a strict comparison would miss the strongest signal
    there is. Guarded to >= 3 characters so a two-digit reference cannot match a large fraction of
    the order book by accident.

    A BARE NUMBER MUST BE A TOKEN, which is a second guard the first one does not give you. Three
    digits is common enough to hide inside anything: a reference carrying an operator's own free-text
    tag (`PYTEST-LOG-ABC123 ORDER 716`) collapses to a run of hex in which some other order's id -
    `123` here - appears as a substring, and that order's payment would earn the full reference bonus
    for a coincidence. Observed for real: it put a stranger's payment at the top of the list, ahead of
    the one the reference actually named. So a digits-only candidate is matched against the ORIGINAL
    reference, delimited by a non-alphanumeric character or an end - `ORDER 716`, `INV-716`, `716` all
    hit; `ABC716` and `7160` do not. Alphanumeric references keep the substring test, because a
    provider's `stub-4f2a` is not a thing that occurs by accident.
    """
    def core(s: str) -> str:
        return "".join(ch for ch in s.lower() if ch.isalnum())

    raw = (bank_ref or "").lower()
    ref = core(raw)
    if not ref:
        return False
    for candidate in (provider_ref, str(order_id)):
        c = core(candidate or "")
        if len(c) < 3:
            continue
        if c.isdigit():
            if re.search(r"(?<![0-9a-z])" + c + r"(?![0-9a-z])", raw):
                return True
            continue
        if c in ref:
            return True
    return False


def _date_bonus(received_on: date | datetime, paid_on: date | datetime | None) -> tuple[int, str | None]:
    """How much the dates support a match: a credit cannot settle money taken after it landed.

    Returns (bonus, reason). A payment dated AFTER the payout is contradicted by the statement and
    scores zero with the contradiction stated, rather than being silently ranked low - the operator
    needs to see that the engine noticed.
    """
    if paid_on is None:
        return 0, None
    received = received_on.date() if isinstance(received_on, datetime) else received_on
    paid = paid_on.date() if isinstance(paid_on, datetime) else paid_on
    gap = (received - paid).days
    if gap < 0:
        return 0, f"paid {abs(gap)} day(s) AFTER the credit landed, which the statement contradicts"
    if gap <= 3:
        return 20, f"paid {gap} day(s) before the credit landed"
    if gap <= 14:
        return 10, f"paid {gap} days before the credit landed (inside a fortnight)"
    return 0, f"paid {gap} days before the credit landed - a long gap for a card settlement"


def match_payout(payout: dict, candidates: list[dict]) -> list[MatchSuggestion]:
    """Rank the ways this credit could be the settlement of the payments in `candidates`.

    The payout contract: {amount_cents, received_on, bank_ref}. The candidate contract, one per
    UNMATCHED payment - matched ones are the caller's job to exclude, and re-offering money that is
    already reconciled is how a double-match gets confirmed: {payment_id, order_id, amount_cents,
    status, paid_on | None, provider_ref | None}.

    TWO SHAPES, scored apart. A single payment for the exact amount is the ordinary case and starts
    at 60; a COMBINATION of up to `MAX_COMBINATION` payments summing exactly to the credit starts at
    40, because a basket is a real thing that genuinely needs a human to look at the basket. Both
    then earn the same bonuses: up to 20 for dates that agree, 20 for the bank's reference naming
    the payment or its order.

    Only EXACT totals are offered, single or combined. "Close enough" is not a concept in
    reconciliation: a credit of $279.00 against a payment of $278.99 is either a fee that needs its
    own line or a different order, and a fuzzier matcher would confidently conflate the two.
    """
    amount = int(payout["amount_cents"])
    bank_ref = str(payout.get("bank_ref") or "")
    received_on = payout["received_on"]
    out: list[MatchSuggestion] = []

    singles = [c for c in candidates if int(c["amount_cents"]) == amount]
    for c in singles:
        bonus, why = _date_bonus(received_on, c.get("paid_on"))
        reasons = [f"the credit is exactly this order's payment ({_money(amount)})"]
        if why:
            reasons.append(why)
        score = 60 + bonus
        if _reference_hit(bank_ref, c.get("provider_ref"), int(c["order_id"])):
            score += 20
            reasons.append(f"the bank's reference {bank_ref!r} names this order or its payment")
        if c.get("status") != "succeeded":
            reasons.append(f"the payment is {c.get('status')!r}, not a completed one")
            score -= 15
        out.append(MatchSuggestion([int(c["payment_id"])], [int(c["order_id"])], amount,
                                   max(score, 1), _confidence(score), reasons))

    # Combinations, smallest first so "this credit settles these two" outranks "these four", and
    # bounded by MAX_COMBINATION so the search stays linear-ish in a statement-sized candidate list.
    pool = sorted((c for c in candidates if int(c["amount_cents"]) < amount),
                  key=lambda c: -int(c["amount_cents"]))
    for combo in _combinations(pool, amount, MAX_COMBINATION):
        ids = [int(c["payment_id"]) for c in combo]
        orders = [int(c["order_id"]) for c in combo]
        reasons = [f"{len(combo)} payments of {', '.join(_money(int(c['amount_cents'])) for c in combo)}"
                   f" add up to the credit exactly"]
        score = 40
        dated = [c for c in combo if c.get("paid_on") is not None]
        if dated:
            oldest = min(dated, key=lambda c: c["paid_on"])
            bonus, why = _date_bonus(received_on, oldest["paid_on"])
            score += bonus // 2  # halved: the dates of a basket agree at best with its oldest line
            if why:
                reasons.append(why)
        if all(_reference_hit(bank_ref, c.get("provider_ref"), int(c["order_id"])) for c in combo):
            score += 20
            reasons.append("the bank's reference names every order in the basket")
        out.append(MatchSuggestion(ids, orders, amount, max(score, 1), _confidence(score), reasons))

    # Best first, then the smaller basket, then the ids - a stable order, because two suggestions
    # that swap places between reads look like two different answers.
    out.sort(key=lambda m: (-m.score, len(m.payment_ids), m.order_ids))
    return out


def _combinations(pool: list[dict], target: int, limit: int) -> list[list[dict]]:
    """Every subset of `pool` of size 2..limit whose amounts sum exactly to `target`.

    Depth-first with the remaining sum carried down, so a branch is abandoned the moment it
    overshoots - on a real statement this prunes almost everything and the search stays trivial. The
    pool is passed largest-first and the walk is index-forward, so no subset is generated twice.
    """
    found: list[list[dict]] = []

    def walk(start: int, remaining: int, chosen: list[dict]):
        if remaining == 0 and len(chosen) >= 2:
            found.append(list(chosen))
            return
        if len(chosen) >= limit:
            return
        for i in range(start, len(pool)):
            amount = int(pool[i]["amount_cents"])
            if amount > remaining:
                continue
            chosen.append(pool[i])
            walk(i + 1, remaining - amount, chosen)
            chosen.pop()

    walk(0, target, [])
    return found


def _confidence(score: int) -> str:
    if score >= 85:
        return CONFIDENCE_STRONG
    if score >= 60:
        return CONFIDENCE_LIKELY
    return CONFIDENCE_POSSIBLE


def describe_rules() -> dict:
    """The rules the payload's own numbers were produced by, printed on the screen that shows them.

    An operator is being asked to act on "overdue" and "fastest"; both are thresholds this module
    chose, so both are published with the alerts and the recommendation rather than living only in
    a source file the person reading the screen cannot open.
    """
    return {
        "overdue_ship_days": OVERDUE_SHIP_DAYS,
        "promise_slip_days": PROMISE_SLIP_DAYS,
        "stale_transit_days": STALE_TRANSIT_DAYS,
        "unreconciled_days": UNRECONCILED_DAYS,
        "abandoned_days": ABANDONED_DAYS,
        "min_carrier_sample": MIN_CARRIER_SAMPLE,
        "max_combination": MAX_COMBINATION,
        "alert_kinds": ALERT_KINDS,
        "note": ("Alerts and matches are advisory: nothing here writes. A match is confirmed by a "
                 "person, and a shipment is recorded by a person."),
    }
