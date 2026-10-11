#!/usr/bin/env python
"""Daily-ops rehearsal - drives the REAL HTTP API through one scored business day.

seed_demo.py *seeds* the demo store; this script *rehearses a day on it*. Everything it does goes
through the same endpoints the backoffice and the storefront call: an intake batch, the CMS
duties (deal of the month, offers), a customer signing up and reading their own zone, and the
assistant turns (staff requests without the execute flag, shopper questions). The one thing that
cannot go over HTTP is the rehearsal staff admin: there is no public "create staff" endpoint, so
it is created with ``app.bootstrap_staff`` and, on a re-run (when bootstrap cannot hand the
password back a second time), its password is reset directly so this script can log in again -
the seed_demo idiom. The two counters the safety checks compare (total assets, audit rows) are
read through the same shared engine, read-only: the audit trail has no HTTP door, and it is the
general tripwire (every staff mutation writes a row).

WHAT IS SCORED. Only deterministic invariants - no model in the loop: a staff turn without
execute:true may not write stock or audit rows; the two trust zones stay shut; the batch counters
move by exactly the number of units scanned in; the CMS round-trips land. Everything a model
*said* - proposal or answer, product or price - is reported and never failed: a rehearsal scored
on a model's sentence would be scoring the wrong thing.

WHAT IT LEAVES BEHIND. Products, lots, units and ledger rows are append-only, so the day's own
namespace is keyed by the run stamp (product ``rehearse-day-<stamp>``, lot ``REHEARSE-<stamp>``,
serials ``RX-DAY-<stamp>-NN``) and a same-day re-run finishes that day instead of stacking up new
rows - pass a fresh --stamp for a fresh day. The home page's deal of the month is restored to
what it held before the run (over the CMS's own write path, which carries exactly the keys the
staff view exposes) and the two offers the day creates are retired at the end, so a rehearsal
leaves no live storefront content changed. The rehearsal customer is per-run unique: a shopper
account cannot be re-created or re-passworded over HTTP.

NOT run by the builder - this drives a live model and writes to the live demo store. Run it
inside the stack:
    docker compose run --rm api python scripts/rehearse_day.py
    docker compose run --rm api python scripts/rehearse_day.py --stamp 20261011
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import secrets
import string
import sys
from datetime import date

# Invoked as ``python scripts/rehearse_day.py``, Python puts scripts/ - not the app root - on
# sys.path, so ``import app`` would fail without this.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.bootstrap_staff import bootstrap  # noqa: E402
from app.core.db import get_engine  # noqa: E402
from app.core.security import hash_password  # noqa: E402

GRADES = ("A", "B", "C", "D")
GRADE_FACTOR = {"A": 1.00, "B": 0.85, "C": 0.70, "D": 0.55}
BASE_PRICE_CENTS = 45900        # grade-A list price for the rehearsal handset
BATCH = 10                      # units the day scans in

OFFERS = (
    {"name": "Rehearsal {stamp} Free Shipping", "kind": "fixed", "value": 1500},
    {"name": "Rehearsal {stamp} Trade-In 5%", "kind": "percent", "value": 5},
)
STAFF_TURNS = (                 # staff requests that ASK for a write; none carries execute:true
    "scan in serial {pending} into lot {lot}",
    "grade serial {listed} as B",
    "move serial {listed} to WH-DAY-B2",
)
STORE_QUESTIONS = (             # shopper questions for the public store assistant
    "Do you have any {model} in stock, and what do they cost?",
    "What is the cheapest {model} you have right now?",
    "Can I get a {model} graded A today?",
)
# A structurally valid guest checkout body, pointed at a unit id that cannot exist: the zone-wall
# probe below must fail on the credential alone, and a broken wall must not be able to write.
CHECKOUT = {"asset_ids": [0], "shipping_country": "AU", "ship_to_name": "Rehearsal shopper",
            "ship_line1": "1 Rehearsal St", "ship_city": "Melbourne", "ship_state": "VIC",
            "ship_postcode": "3000"}
# Staff write doors, each addressed at ids/lots that do not exist: if a wall ever fails, the probe
# reports a non-401 and touches nothing on the way.
STAFF_WRITE_DOORS = (
    ("/staff/lots", {"notes": "rehearsal door probe"}),
    ("/staff/assets/scan-in", {"lot_number": "REHEARSE-NO-SUCH-LOT", "serial_number": "RX-DAY-PROBE"}),
    ("/staff/products", {"brand_slug": "apple", "category_slug": "phones",
                         "model": "Rehearsal probe", "title": "Rehearsal probe"}),
    ("/staff/cms/promotions", {"name": "Rehearsal door probe", "kind": "percent", "value": 5}),
    ("/staff/assets/0/move", {"location": "WH-PROBE"}),
    ("/staff/assets/0/status", {"status": "scrapped"}),
    ("/staff/ai/chat", {"message": "scan in serial RX-DAY-PROBE into lot REHEARSE-NO-SUCH-LOT"}),
)


def unit_price(base_cents: int, grade: str) -> int:
    """Grade-scaled price, rounded to whole AUD so the storefront reads cleanly."""
    return int(round(base_cents * GRADE_FACTOR[grade] / 100.0)) * 100


class Api:
    """Thin authed HTTP client - every call in this script goes through it.

    Two zones, one client: the staff bearer rides only on /staff calls, the customer bearer only
    on /store calls (a staff token on a store endpoint is a 401 by design). ``as_`` overrides the
    bearer so the zone-wall probes can hand the wrong zone the right credential on purpose.
    """

    def __init__(self, base_url: str):
        # Longer than seed_demo's 30s: the assistant turns wait on a live model.
        self.http = httpx.Client(base_url=base_url, timeout=180.0)
        self.token: str | None = None
        self.customer_token: str | None = None

    def _headers(self, path: str, as_: str) -> dict:
        if as_ == "none":
            return {}
        if as_ == "staff":
            return {"Authorization": "Bearer " + self.token} if self.token else {}
        if as_ == "customer":
            return {"Authorization": "Bearer " + self.customer_token} if self.customer_token else {}
        if self.token and path.startswith("/staff"):
            return {"Authorization": "Bearer " + self.token}
        if self.customer_token and path.startswith("/store"):
            return {"Authorization": "Bearer " + self.customer_token}
        return {}

    def get(self, path: str, as_: str = "auto", **kw) -> httpx.Response:
        return self.http.get(path, headers=self._headers(path, as_), **kw)

    def post(self, path: str, body=None, as_: str = "auto", **kw) -> httpx.Response:
        return self.http.post(path, headers=self._headers(path, as_), json=body, **kw)

    def put(self, path: str, body=None, as_: str = "auto", **kw) -> httpx.Response:
        return self.http.put(path, headers=self._headers(path, as_), json=body, **kw)

    def patch(self, path: str, body=None, as_: str = "auto", **kw) -> httpx.Response:
        return self.http.patch(path, headers=self._headers(path, as_), json=body, **kw)

    def need(self, r: httpx.Response, code: int) -> httpx.Response:
        if r.status_code != code:
            raise RuntimeError(f"{r.request.method} {r.request.url.path} -> {r.status_code}: {r.text[:300]}")
        return r


class Scorecard:
    """Per-step outcomes. Only the deterministic rows decide PASS/FAIL.

    check() records an invariant: zone walls, counters, a CMS round-trip - everything that holds
    with no model in the loop. note() records what a model said: always printed, never scored.
    """

    def __init__(self, stamp: str):
        self.stamp = stamp
        self.checks: list[tuple[str, bool, str]] = []
        self.notes: list[tuple[str, str]] = []

    def check(self, name: str, ok: bool, detail: str = "") -> None:
        self.checks.append((name, bool(ok), detail))

    def note(self, name: str, detail: str = "") -> None:
        self.notes.append((name, detail))

    def failed(self) -> list[str]:
        return [n for n, ok, _ in self.checks if not ok]

    def print(self) -> None:
        print()
        print(f"=== rehearsal scorecard (stamp {self.stamp}) ===")
        print("  -- invariants (deterministic: no model in the loop) --")
        for name, ok, detail in self.checks:
            print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"   [{detail}]" if detail else ""))
        print("  -- report only (live model output: printed, never scored) --")
        for name, detail in self.notes:
            print(f"  ....  {name}" + (f"   [{detail}]" if detail else ""))
        bad = self.failed()
        print()
        print(f"  invariants {len(self.checks) - len(bad)}/{len(self.checks)} PASS   "
              f"report-only {len(self.notes)}")
        print("  RESULT: " + (f"FAIL ({len(bad)} invariant(s))" if bad else "PASS"))


# ---------------------------------------------------------------- rehearsal admin


async def ensure_admin(api: Api, email: str, password_arg: str | None) -> None:
    """Create the rehearsal admin (or make an existing one loggable-again) and sign in."""
    signin, created, generated = await _ensure_admin_row(email, password_arg)
    if generated:
        # Print the moment it is set, not only in the summary: a run that dies later must not
        # leave the rehearsal admin with an unknown password.
        print(f"rehearsal admin {email}: password set to {signin} (shown once)")
    r = api.need(api.post("/staff/auth/login", {"email": email, "password": signin}), 200)
    j = r.json()
    if j.get("requires_mfa"):
        raise RuntimeError(f"rehearsal admin {email} has TOTP enabled - disable it to run the day")
    api.token = j["access_token"]


async def _ensure_admin_row(email: str, password_arg: str | None) -> tuple[str, int, bool]:
    """Bootstrap, then (if needed) reset the password - both inside the ONE loop main() runs in.

    bootstrap() disposes the shared engine, and an asyncpg connection belongs to the loop that
    created it, so a second event loop would await a future from the first (now dead) one:
    "Event loop is closed" / "attached to a different loop". The whole day therefore runs in a
    single asyncio.run(), which is why this is awaited rather than wrapped in its own.

    Returns (password, created, generated) - generated is True only when this run invented the
    password, so the caller knows there is something worth printing once.
    """
    _, bootstrap_pw = await bootstrap(email, "admin")
    if bootstrap_pw is not None:
        return bootstrap_pw, True, False      # bootstrap already printed it
    # bootstrap only returns a password when it creates the user; an existing rehearsal admin is
    # reset to --admin-password, or to a fresh random one the caller prints once.
    password = password_arg or strong_password()
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("""
            INSERT INTO staff_passwords (staff_id, password_hash)
            SELECT id, :h FROM staff_users WHERE email = :e
            ON CONFLICT (staff_id) DO UPDATE SET password_hash = EXCLUDED.password_hash
        """), {"h": hash_password(password), "e": email})
    return password, False, password_arg is None


def strong_password() -> str:
    alphabet = string.ascii_letters + string.digits
    while True:
        pw = "".join(secrets.choice(alphabet) for _ in range(16))
        if any(c.isdigit() for c in pw) and any(c.isalpha() for c in pw):
            return pw


async def counts() -> tuple[int, int]:
    """Total assets and audit rows - the two counters a stray write would move.

    Read-only. The audit trail is not exposed over HTTP, and it is the general tripwire: every
    staff mutation writes a row, so this pair catches a wrong-side grade or move, not only a new
    asset.
    """
    eng = get_engine()
    async with eng.begin() as c:
        assets = (await c.execute(text("SELECT count(*) FROM assets"))).scalar_one()
        audit = (await c.execute(text("SELECT count(*) FROM audit_log"))).scalar_one()
    return assets, audit


# ---------------------------------------------------------------- lookups (all HTTP)


def existing_products(api: Api) -> dict[str, int]:
    rows = api.need(api.get("/staff/cms/products"), 200).json()
    return {row["slug"]: row["id"] for row in rows}


def find_lot(api: Api, lot_number: str) -> dict | None:
    offset = 0
    while offset < 2000:
        page = api.need(api.get("/staff/lots", params={"limit": 100, "offset": offset}), 200).json()
        for lot in page:
            if lot["lot_number"] == lot_number:
                return lot
        if len(page) < 100:
            return None
        offset += 100
    return None


def assets_in_lot(api: Api, lot_number: str) -> list[dict]:
    return api.need(api.get("/staff/assets", params={"lot_number": lot_number, "limit": 100}), 200).json()


# ---------------------------------------------------------------- the day's own rows


def ensure_product(api: Api, known: dict[str, int], slug: str, model: str) -> tuple[int, bool]:
    if slug in known:
        return known[slug], False
    r = api.post("/staff/products", {"brand_slug": "apple", "category_slug": "phones", "model": model,
                                     "title": model, "slug": slug,
                                     "specs": {"storage": "128GB"},
                                     "description": "Rehearsal handset - certified refurbished, graded and serialised."})
    api.need(r, 201)
    row = r.json()
    known[slug] = row["id"]
    return row["id"], True


def ensure_lot(api: Api, stamp: str) -> tuple[int, str, bool]:
    lot_number = "REHEARSE-" + stamp
    r = api.post("/staff/lots", {"lot_number": lot_number, "warehouse": "WH-DAY",
                                 "notes": "daily-ops rehearsal"})
    if r.status_code == 201:
        return r.json()["id"], lot_number, True
    if r.status_code == 409:
        lot = find_lot(api, lot_number)
        if lot is None:
            raise RuntimeError(f"lot {lot_number} reported as duplicate but not found")
        return lot["id"], lot_number, False
    api.need(r, 201)
    raise RuntimeError("unreachable")


def ensure_unit(api: Api, product_id: int, lot_number: str, serial: str, grade: str, price: int) -> bool:
    """Scan in and list one unit. True when this run created it.

    A serial already in the lot is walked forward only as far as it needs, so an interrupted
    day can be finished by a re-run: every step is a legal transition from where the unit
    actually is (received -> tested -> graded -> listed, the DB's own state machine).
    """
    r = api.post("/staff/assets/scan-in", {"serial_number": serial, "lot_number": lot_number,
                                           "product_id": product_id})
    if r.status_code == 201:
        aid, status, created = r.json()["id"], "received", True
    elif r.status_code == 409:
        row = next((a for a in assets_in_lot(api, lot_number) if a["serial_number"] == serial), None)
        if row is None:
            raise RuntimeError(f"serial {serial} reported as duplicate but not in lot {lot_number}")
        aid, status, created = row["id"], row["status"], False
    else:
        api.need(r, 201)
        raise RuntimeError("unreachable")
    if status == "received":
        api.need(api.post(f"/staff/assets/{aid}/status", {"status": "tested"}), 200)
        status = "tested"
    if status == "tested":
        api.need(api.post(f"/staff/assets/{aid}/grade", {"grade": grade}), 200)
        status = "graded"
    if status == "graded":
        api.need(api.post(f"/staff/assets/{aid}/price", {"sale_price_cents": price}), 200)
        api.need(api.post(f"/staff/assets/{aid}/status", {"status": "listed"}), 200)
    return created


def ensure_lot_active(api: Api, lot_number: str, lot_id: int) -> bool:
    """Activate a lot, skipping the call when a GET shows it is already active."""
    lot = find_lot(api, lot_number)
    if lot is not None and lot["status"] == "active":
        return False
    api.need(api.post(f"/staff/lots/{lot_id}/activate"), 200)
    return True


async def open_day(api: Api, score: Scorecard, stamp: str, model: str, slug: str) -> dict:
    known = existing_products(api)
    product_id, created = ensure_product(api, known, slug, model)
    lot_id, lot_number, lot_created = ensure_lot(api, stamp)
    score.note("day namespace",
               f"{slug} id={product_id} ({'created' if created else 'existing'}), "
               f"{lot_number} id={lot_id} ({'created' if lot_created else 'existing'})")
    return {"stamp": stamp, "slug": slug, "model": model, "product_id": product_id,
            "lot_id": lot_id, "lot_number": lot_number}


# ---------------------------------------------------------------- the day's steps


async def run_intake(api: Api, score: Scorecard, ctx: dict) -> None:
    """The day's batch: BATCH units in, exactly BATCH on the shelf - never one more.

    The duplicate probe is the "no more" direction (a repeated scan must not double-count); the
    storefront read is the "no less" direction, grades and prices included.
    """
    created = 0
    for i in range(1, BATCH + 1):
        grade = GRADES[(i - 1) % len(GRADES)]
        created += int(ensure_unit(api, ctx["product_id"], ctx["lot_number"],
                                   f"RX-DAY-{ctx['stamp']}-{i:02d}", grade,
                                   unit_price(BASE_PRICE_CENTS, grade)))
    ensure_lot_active(api, ctx["lot_number"], ctx["lot_id"])

    async def lot_units() -> list[dict]:
        return assets_in_lot(api, ctx["lot_number"])

    rows = await lot_units()
    listed = sorted(a["serial_number"] for a in rows)
    ctx["listed_serial"] = listed[0] if listed else f"RX-DAY-{ctx['stamp']}-01"
    ctx["pending_serial"] = f"RX-DAY-{ctx['stamp']}-99"      # never scanned: a write would add one
    score.check(f"intake batch holds exactly {BATCH} units in {ctx['lot_number']}",
                len(rows) == BATCH, f"scanned in {created} new this run, lot holds {len(rows)}")

    dup = api.post("/staff/assets/scan-in", {"serial_number": f"RX-DAY-{ctx['stamp']}-01",
                                             "lot_number": ctx["lot_number"],
                                             "product_id": ctx["product_id"]})
    rows2 = await lot_units()
    score.check("a repeated scan-in is refused (409) and adds no unit",
                dup.status_code == 409 and len(rows2) == len(rows),
                f"duplicate -> {dup.status_code}, lot holds {len(rows2)}")

    want = sorted((GRADES[(i - 1) % len(GRADES)], unit_price(BASE_PRICE_CENTS, GRADES[(i - 1) % len(GRADES)]))
                  for i in range(1, BATCH + 1))
    pub = api.need(api.get("/store/catalog/" + ctx["slug"]), 200).json()
    got = sorted((u["grade"], int(u["sale_price_cents"])) for u in pub["units"])
    score.check("the batch is on the storefront with the grades and prices we set", got == want,
                f"{len(got)} listed, {min(got)[1]}-{max(got)[1]} cents" if got else "no listed units")


def run_deal(api: Api, score: Scorecard, ctx: dict) -> None:
    """The deal of the month: pin it to the day's own product, prove the storefront publishes it,
    then put the home page back the way it was - a rehearsal is not a merchandising decision.
    """
    before = api.need(api.get("/staff/cms/home"), 200).json()
    api.need(api.put("/staff/cms/home", {"hero_title": before.get("hero_title"),
                                         "hero_sub": before.get("hero_sub"),
                                         "cta_label": before.get("cta_label"),
                                         "deal_of_month": {"product_slug": ctx["slug"],
                                                           "title": "Rehearsal deal of the day"}}), 200)
    pub = api.need(api.get("/store/home-content"), 200).json()
    deal = pub.get("deal_of_month") or {}
    score.check("the deal card publishes on the day's own listed stock",
                deal.get("product_slug") == ctx["slug"] and bool(deal.get("price_from_cents")),
                f"slug={deal.get('product_slug')} price_from={deal.get('price_from_cents')}")

    restore = {k: before[k] for k in ("hero_title", "hero_sub", "cta_label") if k in before}
    if before.get("deal_of_month"):
        restore["deal_of_month"] = before["deal_of_month"]
    api.need(api.put("/staff/cms/home", restore), 200)
    after = api.need(api.get("/store/home-content"), 200).json()
    was = (before.get("deal_of_month") or {}).get("product_slug")
    now = (after.get("deal_of_month") or {}).get("product_slug")
    score.check("the home page is back to its pre-run deal", now == was, f"deal_of_month {was} -> {now}")


def run_promotions(api: Api, score: Scorecard, ctx: dict) -> None:
    """Two offers go live through the CMS, show on the public route, then come back down."""
    known = {p["name"]: p["id"] for p in api.need(api.get("/staff/cms/promotions"), 200).json()}
    names, ids = [], []
    for spec in OFFERS:
        body = {"name": spec["name"].format(stamp=ctx["stamp"]), "kind": spec["kind"], "value": spec["value"]}
        pid = known.get(body["name"])
        if pid is None:
            r = api.post("/staff/cms/promotions", body)
            api.need(r, 200)
            pid = r.json()["id"]
        else:
            # A same-day re-run finds the offer already there (the earlier run retired it):
            # bring it back up so the day behaves the same either way.
            api.need(api.patch(f"/staff/cms/promotions/{pid}",
                               {"active": True, "kind": body["kind"], "value": body["value"]}), 200)
        names.append(body["name"])
        ids.append(pid)

    live = {p["name"]: p for p in api.need(api.get("/store/promotions"), 200).json()}
    score.check("both offers are live on the public promotions route",
                all(n in live and live[n]["value"] == spec["value"]
                    for n, spec in zip(names, OFFERS)),
                ", ".join(f"{n}={live[n]['kind']} {live[n]['value']}" for n in names if n in live)
                or "neither is live")
    for pid in ids:
        api.need(api.patch(f"/staff/cms/promotions/{pid}", {"active": False}), 200)
    gone = {p["name"] for p in api.need(api.get("/store/promotions"), 200).json()}
    score.check("the offers are retired again (the rehearsal leaves no live offer)",
                not (set(names) & gone), ", ".join(sorted(set(names) & gone)) or "none live")


def run_customer(api: Api, score: Scorecard, ctx: dict) -> None:
    """A customer signs up over the public door and reads their own zone."""
    email = f"rehearse-{ctx['stamp']}-{secrets.token_hex(3)}@rfo.local"   # per-run unique
    pw = strong_password()
    api.need(api.post("/store/auth/register", {"email": email, "password": pw,
                                               "display_name": "Rehearsal shopper"}), 200)
    r = api.post("/store/auth/login", {"email": email, "password": pw})
    api.need(r, 200)
    api.customer_token = r.json()["access_token"]
    print(f"rehearsal customer {email}: password {pw} (shown once - a throwaway account)")
    me = api.need(api.get("/store/me"), 200).json()
    score.check("a fresh customer account reads its own zone", me.get("email") == email,
                str(me.get("email")))


def run_doors(api: Api, score: Scorecard, ctx: dict) -> None:
    """The two trust zones, probed with the day's own real credentials.

    Nothing here is addressed at a row that exists, so a wall that ever fails reports itself
    without being able to write anything.
    """
    r = api.post("/store/checkout", CHECKOUT, as_="staff")
    score.check("a staff bearer is refused by the store door", r.status_code == 401,
                f"/store/checkout -> {r.status_code}")

    codes = {path: api.post(path, body, as_="customer").status_code for path, body in STAFF_WRITE_DOORS}
    leaked = {p: c for p, c in codes.items() if c != 401}
    score.check("a customer bearer is refused by every staff write door", not leaked,
                f"{len(codes) - len(leaked)}/{len(codes)} -> 401"
                + (f", leaked: {leaked}" if leaked else ""))

    r = api.put("/staff/cms/home", {"hero_title": "rehearsal door probe"}, as_="customer")
    score.check("... including the CMS write door", r.status_code == 401,
                f"PUT /staff/cms/home -> {r.status_code}")

    r = api.post("/staff/lots", {"notes": "rehearsal door probe"}, as_="none")
    score.check("an unauthenticated staff write is refused", r.status_code == 401,
                f"/staff/lots -> {r.status_code}")


async def run_staff_turns(api: Api, score: Scorecard, ctx: dict) -> None:
    """Three staff requests go up WITHOUT execute:true: nothing may be written, whatever the
    model decides. The audit counter catches every kind of staff write, not only a new row.
    """
    before = await counts()
    kinds: dict[str, int] = {}
    for i, tmpl in enumerate(STAFF_TURNS, start=1):
        message = tmpl.format(pending=ctx["pending_serial"], listed=ctx["listed_serial"],
                              lot=ctx["lot_number"])
        r = api.post("/staff/ai/chat", {"message": message})       # no execute flag
        if r.status_code != 200:
            # The model (or its endpoint) being unreachable is not a safety failure - it is
            # reported, and the counters below still decide whether anything was written.
            kinds[f"http-{r.status_code}"] = kinds.get(f"http-{r.status_code}", 0) + 1
            score.note(f"staff turn {i}", f"HTTP {r.status_code}: {r.text[:120]}")
            continue
        j = r.json()
        kind = str(j.get("type"))
        kinds[kind] = kinds.get(kind, 0) + 1
        detail = (f'action={j.get("action")} args={json.dumps(j.get("args") or {})[:70]}'
                  if kind == "proposed" else f'answer="{str(j.get("answer") or "")[:90]}"')
        score.check(f"staff turn {i} did not execute without the flag", j.get("type") != "executed",
                    f"type={kind}")
        score.note(f"staff turn {i}: type={kind}", detail)

    after = await counts()
    score.check("no staff turn wrote stock or audit rows (count deltas zero)", after == before,
                f"assets {before[0]}->{after[0]}, audit {before[1]}->{after[1]}")
    score.note("proposal type counts", json.dumps(kinds, sort_keys=True))


def run_store_questions(api: Api, score: Scorecard, ctx: dict) -> None:
    """Three shopper questions to the public store assistant. Report only: what it answers is a
    model's sentence, and this rehearsal scores invariants, not sentences.
    """
    session = "rehearse-" + ctx["stamp"] + "-" + secrets.token_hex(3)    # fresh: 6 turns per session
    for i, tmpl in enumerate(STORE_QUESTIONS, start=1):
        r = api.post("/store/assistant/chat", {"message": tmpl.format(model=ctx["model"]),
                                               "session_id": session})
        if r.status_code == 404:
            raise RuntimeError("the public store assistant is off (PUBLIC_CHAT_ENABLED) - "
                               "turn it on to rehearse the shopper side")
        if r.status_code != 200:
            score.note(f"shopper question {i}", f"HTTP {r.status_code}: {r.text[:120]}")
            continue
        j = r.json()
        offered = (j.get("products") or [])
        score.note(f"shopper question {i}: {len(offered)} product(s)",
                   f'"{str(j.get("text") or "")[:110]}"'
                   + (f" | {', '.join(p['title'] for p in offered[:3])}" if offered else ""))


# ---------------------------------------------------------------- main


async def main() -> int:
    ap = argparse.ArgumentParser(description="Rehearse one business day through the real API.")
    ap.add_argument("--base-url", default=os.environ.get("API_INTERNAL_URL", "http://api:8000"),
                    help="internal API base URL (default: $API_INTERNAL_URL or http://api:8000)")
    ap.add_argument("--stamp", default=date.today().strftime("%Y%m%d"),
                    help="day namespace for the rehearsal's own product/lot/serials (default: today)")
    ap.add_argument("--admin-email", default="rehearse-admin@rfo.local", help="rehearsal staff admin")
    ap.add_argument("--admin-password", default=None,
                    help="password to set for an existing rehearsal admin (default: generate one, printed once)")
    args = ap.parse_args()

    api = Api(args.base_url)
    score = Scorecard(args.stamp)
    model = f"Rehearsal day {args.stamp} handset"
    try:
        await ensure_admin(api, args.admin_email, args.admin_password)
        ctx = await open_day(api, score, args.stamp, model, "rehearse-day-" + args.stamp)
        print()
        print(f"rehearsing {args.stamp}: lot {ctx['lot_number']}, product {ctx['slug']} "
              f"(id {ctx['product_id']})")
        await run_intake(api, score, ctx)
        run_deal(api, score, ctx)
        run_promotions(api, score, ctx)
        run_customer(api, score, ctx)
        run_doors(api, score, ctx)
        await run_staff_turns(api, score, ctx)
        run_store_questions(api, score, ctx)
        score.print()
        print()
        print("  storefront: https://rfo.localhost   backoffice: https://admin.rfo.localhost")
        return 1 if score.failed() else 0
    finally:
        await get_engine().dispose()


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except RuntimeError as e:
        print(f"rehearse_day failed: {e}", file=sys.stderr)
        sys.exit(1)
