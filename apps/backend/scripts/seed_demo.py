#!/usr/bin/env python
"""Demo-store seeder - drives the REAL HTTP API, never the database.

Every product, lot, asset, order, promotion and customer is created through the same
endpoints the storefront and the backoffice call. The one thing that cannot go over HTTP is
the seed staff admin: there is no public "create staff" endpoint, so it is created with
``app.bootstrap_staff`` and, on a re-run (when bootstrap cannot hand the password back a
second time), its password is reset directly so this script can log in again. There is no
default password: a re-run uses ``--admin-password`` when given, otherwise a random one, printed
once the moment it is set.

No other SQL runs: brand/category slugs are the known seed slugs and the API validates them;
every lookup (products, lots, assets, promotions) goes through a real GET.

Run inside the stack:
    docker compose run --rm api python scripts/seed_demo.py --products 3 --units-per 2 --orders 2

Idempotency: products are keyed by the ``seed-demo-*`` slug, lots by the ``SEED-DEMO-*`` lot
number and units by the ``RX-SEED-*`` serial, so a re-run creates nothing twice. Orders are
placed against a fixed set of seed units, so once those units are sold a re-run places no
further orders. Re-runs print the same summary with everything counted as "existing".
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import secrets
import string
import sys

# Invoked as ``python scripts/seed_demo.py``, Python puts scripts/ - not the app root - on
# sys.path, so ``import app`` would fail without this.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.bootstrap_staff import bootstrap  # noqa: E402
from app.core.db import get_engine  # noqa: E402
from app.core.security import hash_password  # noqa: E402

# (code, brand_slug, category_slug, model, title, base_price_cents, specs) for grade A.
# Spread over apple/samsung x phones/laptops/tablets; the first eight entries cover every
# category and both brands, so the default --products 8 fills all three catalog categories.
CATALOG = [
    ("ip12", "apple", "phones", "iPhone 12", "Refurbished iPhone 12", 45900,
     {"storage": "64GB", "screen": "6.1in", "network": "5G"}),
    ("ip13", "apple", "phones", "iPhone 13", "Refurbished iPhone 13", 62900,
     {"storage": "128GB", "screen": "6.1in", "network": "5G"}),
    ("gs21", "samsung", "phones", "Galaxy S21", "Refurbished Galaxy S21", 39900,
     {"storage": "128GB", "screen": "6.2in", "network": "5G"}),
    ("gs20", "samsung", "phones", "Galaxy S20", "Refurbished Galaxy S20", 23900,
     {"storage": "128GB", "screen": "6.2in", "network": "4G"}),
    ("mba-m1", "apple", "laptops", "MacBook Air (M1)", "Refurbished MacBook Air M1", 109900,
     {"storage": "256GB", "screen": "13.3in", "ram": "8GB"}),
    ("mbp13", "apple", "laptops", "MacBook Pro 13 (M1)", "Refurbished MacBook Pro 13 M1", 159900,
     {"storage": "512GB", "screen": "13.3in", "ram": "8GB"}),
    ("gb2", "samsung", "laptops", "Galaxy Book2", "Refurbished Galaxy Book2", 89900,
     {"storage": "256GB", "screen": "15.6in", "ram": "8GB"}),
    ("ipad-air4", "apple", "tablets", "iPad Air (4th generation)", "Refurbished iPad Air 4", 59900,
     {"storage": "64GB", "screen": "10.9in", "network": "Wi-Fi"}),
    ("tab-s7", "samsung", "tablets", "Galaxy Tab S7", "Refurbished Galaxy Tab S7", 54900,
     {"storage": "128GB", "screen": "11.0in", "network": "Wi-Fi"}),
]

GRADES = ("A", "B", "C", "D")
GRADE_FACTOR = {"A": 1.00, "B": 0.85, "C": 0.70, "D": 0.55}

PROMOTIONS = [
    {"name": "Demo Free Shipping Week", "kind": "fixed", "value": 1500},
    {"name": "Demo Trade-In Bonus", "kind": "percent", "value": 5},
]

AU_ADDRESSES = [
    {"ship_to_name": "Aisha Nguyen", "ship_line1": "12/45 Bourke Street", "ship_city": "Melbourne",
     "ship_state": "VIC", "ship_postcode": "3000"},
    {"ship_to_name": "Tom Whitfield", "ship_line1": "8 Kellett Street", "ship_city": "Sydney",
     "ship_state": "NSW", "ship_postcode": "2011"},
    {"ship_to_name": "Priya Raman", "ship_line1": "301/21 Adelaide Terrace", "ship_city": "Perth",
     "ship_state": "WA", "ship_postcode": "6000"},
    {"ship_to_name": "Liam O'Connor", "ship_line1": "77 Boundary Street", "ship_city": "Brisbane",
     "ship_state": "QLD", "ship_postcode": "4000"},
    {"ship_to_name": "Grace Miller", "ship_line1": "5 Rundle Mall", "ship_city": "Adelaide",
     "ship_state": "SA", "ship_postcode": "5000"},
    {"ship_to_name": "Noah Bennett", "ship_line1": "19 Elizabeth Street", "ship_city": "Hobart",
     "ship_state": "TAS", "ship_postcode": "7000"},
]


def unit_price(base_cents: int, grade: str) -> int:
    """Grade-scaled price, rounded to whole AUD so the storefront reads cleanly."""
    return int(round(base_cents * GRADE_FACTOR[grade] / 100.0)) * 100


class Api:
    """Thin authed HTTP client - every mutation in this script goes through it."""

    def __init__(self, base_url: str):
        self.http = httpx.Client(base_url=base_url, timeout=30.0)
        self.token: str | None = None

    def _headers(self, path: str) -> dict:
        # Two-zone API: the store endpoints answer "401 invalid token" for a staff bearer, so the
        # Authorization header rides only on /staff calls. Guest calls - checkout, pay,
        # simulate-payment, register - stay headerless, which is the house semantics.
        if self.token and path.startswith("/staff"):
            return {"Authorization": "Bearer " + self.token}
        return {}

    def get(self, path: str, **kw) -> httpx.Response:
        return self.http.get(path, headers=self._headers(path), **kw)

    def post(self, path: str, body=None, **kw) -> httpx.Response:
        return self.http.post(path, headers=self._headers(path), json=body, **kw)

    def need(self, r: httpx.Response, code: int) -> httpx.Response:
        if r.status_code != code:
            raise RuntimeError(f"{r.request.method} {r.request.url.path} -> {r.status_code}: {r.text[:300]}")
        return r


# ---------------------------------------------------------------- seed admin


def ensure_admin(api: Api, email: str, password_arg: str | None) -> tuple[str, bool]:
    """Create the seed admin (or make an existing one loggable-again) and sign in.

    Returns the password this run signed in with, and whether the admin was created. There is
    no default password: when the admin already exists bootstrap cannot hand the old one back,
    so the caller either passes --admin-password or this generates a random one for the caller
    to print once.
    """
    signin, created, generated = asyncio.run(_ensure_admin_row(email, password_arg))
    if generated:
        # Print the moment it is set, not only in the final summary: a run that dies later
        # (a 404, a dropped connection) must not leave the seed admin with an unknown password.
        print(f"seed admin {email}: password set to {signin} (shown once)")
    r = api.need(api.post("/staff/auth/login", {"email": email, "password": signin}), 200)
    j = r.json()
    if j.get("requires_mfa"):
        raise RuntimeError(f"seed admin {email} has TOTP enabled - disable it to run the seeder")
    api.token = j["access_token"]
    return signin, created


async def _ensure_admin_row(email: str, password_arg: str | None) -> tuple[str, bool, bool]:
    """Bootstrap, then (if needed) reset the password - both inside ONE event loop.

    bootstrap() disposes the shared engine, and an asyncpg connection belongs to the loop that
    created it, so a second asyncio.run() would await a future from the first (now dead) loop:
    "Event loop is closed" / "attached to a different loop". Keep it to a single loop.

    Returns (password, created, generated) - generated is True only when this run invented the
    password, so the caller knows there is something worth printing once.
    """
    _, bootstrap_pw = await bootstrap(email, "admin")
    if bootstrap_pw is not None:
        return bootstrap_pw, True, False      # bootstrap already printed it
    # bootstrap only returns a password when it creates the user; an existing seed admin is
    # reset to --admin-password, or to a fresh random one the caller prints once.
    password = password_arg or strong_password()
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("""
            INSERT INTO staff_passwords (staff_id, password_hash)
            SELECT id, :h FROM staff_users WHERE email = :e
            ON CONFLICT (staff_id) DO UPDATE SET password_hash = EXCLUDED.password_hash
        """), {"h": hash_password(password), "e": email})
    await eng.dispose()
    return password, False, password_arg is None


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


# ---------------------------------------------------------------- seeding steps


def ensure_product(api: Api, spec, known: dict[str, int]) -> tuple[int, bool]:
    code, brand, category, model, title, base, specs = spec
    slug = "seed-demo-" + code
    if slug in known:
        return known[slug], False
    r = api.post("/staff/products", {"brand_slug": brand, "category_slug": category, "model": model,
                                     "title": title, "slug": slug, "specs": specs,
                                     "description": f"Certified refurbished {model}. Graded and serialised."})
    api.need(r, 201)
    row = r.json()
    known[slug] = row["id"]
    return row["id"], True


def ensure_lot(api: Api, code: str) -> tuple[int, str, bool]:
    lot_number = "SEED-DEMO-" + code.upper()
    r = api.post("/staff/lots", {"lot_number": lot_number, "warehouse": "WH-DEMO",
                                 "notes": "seed_demo intake"})
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
    """Scan in and list one unit. Returns True if newly created, False if it already existed."""
    r = api.post("/staff/assets/scan-in", {"serial_number": serial, "lot_number": lot_number,
                                           "product_id": product_id})
    if r.status_code == 409:
        return False          # serial already seeded by an earlier run
    api.need(r, 201)
    aid = r.json()["id"]
    api.need(api.post(f"/staff/assets/{aid}/status", {"status": "tested"}), 200)
    api.need(api.post(f"/staff/assets/{aid}/grade", {"grade": grade}), 200)
    api.need(api.post(f"/staff/assets/{aid}/price", {"sale_price_cents": price}), 200)
    api.need(api.post(f"/staff/assets/{aid}/status", {"status": "listed"}), 200)
    return True


def ensure_lot_active(api: Api, lot_number: str, lot_id: int) -> bool:
    """Activate a lot, skipping the call when a GET shows it is already active."""
    lot = find_lot(api, lot_number)
    if lot is not None and lot["status"] == "active":
        return False
    api.need(api.post(f"/staff/lots/{lot_id}/activate"), 200)
    return True


# ---------------------------------------------------------------- optional phases


def rehabilitate(api: Api, count: int) -> int:
    """Push existing RX-BULK units live through the real listing flow.

    Two shape notes, both forced by the schema:
    - the units are already 'graded', and the DB trigger allows graded -> listed (it does NOT
      allow graded -> tested), so the flow resumes at grade rather than at test;
    - a listed unit is only catalog-visible when its lot is ACTIVE, and the bulk lot can sit at
      'completed', so the unit's own lot is activated before it is listed. (An asset cannot be
      re-lotted: /assets/{id}/move sets the warehouse location, and assets.lot_id is NOT NULL.)
    """
    if count <= 0:
        return 0
    graded = api.need(api.get("/staff/assets", params={"status": "graded", "limit": 100}), 200).json()
    bulk = sorted((a for a in graded if (a["serial_number"] or "").startswith("RX-BULK-")),
                  key=lambda a: a["serial_number"])[:count]
    seen_lots: set[str] = set()
    for a in bulk:
        lot_number = a["lot_number"]
        if lot_number and lot_number not in seen_lots:
            lot = find_lot(api, lot_number)
            if lot is not None:
                ensure_lot_active(api, lot_number, lot["id"])
            seen_lots.add(lot_number)
        api.need(api.post(f"/staff/assets/{a['id']}/grade", {"grade": "B"}), 200)
        api.need(api.post(f"/staff/assets/{a['id']}/price", {"sale_price_cents": 27900}), 200)
        api.need(api.post(f"/staff/assets/{a['id']}/status", {"status": "listed"}), 200)
    return len(bulk)


def seed_orders(api: Api, lots: list[tuple[str, str, int]], count: int) -> tuple[int, int]:
    """Place `count` paid guest orders over a FIXED set of seed units.

    Checkout performs the hold itself (the cart button reads "unit reserved instantly"), so
    no separate /store/reservations call is needed - and reserving first would in fact break
    checkout, which rejects anything not in state 'listed'.
    """
    targets: list[dict] = []
    for _code, lot_number, _lot_id in lots:
        targets.extend(sorted(assets_in_lot(api, lot_number), key=lambda a: a["serial_number"]))
    placed = skipped = 0
    for asset in targets[:count]:
        if asset["status"] != "listed":
            skipped += 1      # sold by an earlier run - leave it be (idempotent re-run)
            continue
        addr = AU_ADDRESSES[placed % len(AU_ADDRESSES)]
        r = api.post("/store/checkout", {"asset_ids": [asset["id"]], "shipping_country": "AU", **addr})
        api.need(r, 200)
        order_id = r.json()["order_public_id"]
        api.need(api.post(f"/store/orders/{order_id}/pay"), 200)
        api.need(api.post(f"/store/orders/{order_id}/simulate-payment"), 200)
        placed += 1
    return placed, skipped


def seed_promotions(api: Api) -> int:
    have = {p["name"] for p in api.need(api.get("/staff/cms/promotions"), 200).json()}
    created = 0
    for promo in PROMOTIONS:
        if promo["name"] in have:
            continue
        api.need(api.post("/staff/cms/promotions", promo), 200)
        created += 1
    return created


def strong_password() -> str:
    alphabet = string.ascii_letters + string.digits
    while True:
        pw = "".join(secrets.choice(alphabet) for _ in range(16))
        if any(c.isdigit() for c in pw) and any(c.isalpha() for c in pw):
            return pw


def seed_customers(api: Api, count: int) -> tuple[list[tuple[str, str]], int]:
    created: list[tuple[str, str]] = []
    existing = 0
    for i in range(count):
        email = f"seed-demo-c{i + 1}@rfo.local"
        pw = strong_password()
        r = api.post("/store/auth/register", {"email": email, "password": pw,
                                              "display_name": f"Demo Customer {i + 1}"})
        if r.status_code == 409:
            existing += 1
            continue
        api.need(r, 200)
        created.append((email, pw))
    return created, existing


# ---------------------------------------------------------------- main


def main() -> int:
    ap = argparse.ArgumentParser(description="Seed a demo refurb store through the real API.")
    ap.add_argument("--base-url", default=os.environ.get("API_INTERNAL_URL", "http://api:8000"),
                    help="internal API base URL (default: $API_INTERNAL_URL or http://api:8000)")
    ap.add_argument("--products", type=int, default=8, help="catalog products to create")
    ap.add_argument("--units-per", type=int, default=5, help="units per product lot")
    ap.add_argument("--orders", type=int, default=6, help="paid guest orders to place")
    ap.add_argument("--customers", type=int, default=3, help="customer accounts to register")
    ap.add_argument("--rehabilitate", type=int, default=0, help="existing RX-BULK units to list")
    ap.add_argument("--admin-email", default="seed-demo-admin@rfo.local", help="seed staff admin")
    ap.add_argument("--admin-password", default=None,
                    help="password to set for an existing seed admin (default: generate one, printed once)")
    args = ap.parse_args()

    n_products = max(0, min(args.products, len(CATALOG)))
    if args.products > len(CATALOG):
        print(f"note: --products capped at {len(CATALOG)} (demo catalog size)")

    api = Api(args.base_url)
    ensure_admin(api, args.admin_email, args.admin_password)

    known = existing_products(api)
    p_new = u_new = lot_new = 0
    lots: list[tuple[str, str, int]] = []
    for i, spec in enumerate(CATALOG[:n_products]):
        code = spec[0]
        product_id, created = ensure_product(api, spec, known)
        p_new += int(created)
        lot_id, lot_number, lot_created = ensure_lot(api, code)
        lot_new += int(lot_created)
        for u in range(1, args.units_per + 1):
            grade = GRADES[(i + u) % len(GRADES)]
            serial = f"RX-SEED-{code.upper()}-{u}"
            u_new += int(ensure_unit(api, product_id, lot_number, serial, grade,
                                     unit_price(spec[5], grade)))
        ensure_lot_active(api, lot_number, lot_id)
        lots.append((code, lot_number, lot_id))

    reh = rehabilitate(api, args.rehabilitate)
    orders, order_skip = seed_orders(api, lots, args.orders)
    promos = seed_promotions(api)
    customers, customers_existing = seed_customers(api, args.customers)

    print()
    print("=== seed_demo summary ===")
    print(f"  products     created {p_new:>3}   (of {n_products} in the demo catalog)")
    print(f"  lots         created {lot_new:>3}")
    print(f"  units        created {u_new:>3}")
    print(f"  rehab units  listed  {reh:>3}")
    print(f"  orders       placed  {orders:>3}   (skipped {order_skip} already sold)")
    print(f"  promotions   created {promos:>3}")
    print(f"  customers    created {len(customers):>3}   (existing {customers_existing})")
    if customers:
        print()
        print("  customer credentials (shown once - store them now):")
        for email, pw in customers:
            print(f"    {email}  {pw}")
    print()
    print("  storefront: https://rfo.localhost   backoffice: https://admin.rfo.localhost")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as e:
        print(f"seed_demo failed: {e}", file=sys.stderr)
        sys.exit(1)
