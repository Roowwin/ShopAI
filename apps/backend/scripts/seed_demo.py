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

Run inside the stack (the whole demo catalog, ~2-3 units per product):
    docker compose run --rm api python scripts/seed_demo.py --orders 2
    docker compose run --rm api python scripts/seed_demo.py --products 3 --units-per 2 --orders 2

Idempotency: products are keyed by the ``seed-demo-*`` slug, lots by the ``SEED-DEMO-*`` lot
number and units by the ``RX-SEED-*`` serial, so a re-run creates nothing twice. Each product is
also pointed at its own device glyph (``/icons/<slug>.svg``) with the audited CMS PATCH, and that
is skipped when the product already carries that URL - so a second run of the whole catalog writes
nothing at all, not even an audit row. Orders are placed against a fixed set of seed units, so once
those units are sold a re-run places no further orders. Re-runs print the same summary with
everything counted as "existing". The glyph FILES are storefront assets
(``apps/storefront/public/icons/<slug>.svg``) and ship with the frontend; this script only points
the rows at them.
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
#
# The first PRE_V2 entries are the catalog as job 4 seeded it - kept first and verbatim, so a
# store that has been running since then re-runs this seeder and creates nothing. Everything after
# PRE_V2 is the catalog v2 spread (migration 0012 supplies its categories and brands, which is what
# makes the slugs below resolvable). Counts per the v2 spec: laptops 10, desktops 6, monitors 6,
# networking 6, accessories 10, parts 6, processors 6 - 47 new entries, with the three laptops job 4
# already seeded making the laptop row up to ten.
#
# `base_price_cents` is the GRADE A price of one unit; `unit_price` scales it per grade, so the
# figures below are the top of each kind's band (accessories 19-199, parts 29-399, monitors 99-599,
# CPUs 59-499, desktops 399-999, networking 49-1500, laptops 299-1299 AUD, per the same spec).
# `specs` stays in the house shape: short lowercase keys, values carrying their own unit.
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

    # ---- catalog v2 --------------------------------------------------------------------------
    # laptops (+7, to ten with job 4's three)
    ("tp-t14", "lenovo", "laptops", "ThinkPad T14 Gen 3", "Refurbished ThinkPad T14 Gen 3", 74900,
     {"storage": "512GB", "screen": "14.0in", "ram": "16GB"}),
    ("tp-x1c9", "lenovo", "laptops", "ThinkPad X1 Carbon (9th gen)",
     "Refurbished ThinkPad X1 Carbon 9th gen", 89900,
     {"storage": "512GB", "screen": "14.0in", "ram": "16GB"}),
    ("lat-5420", "dell", "laptops", "Latitude 5420", "Refurbished Dell Latitude 5420", 59900,
     {"storage": "256GB", "screen": "14.0in", "ram": "8GB"}),
    ("xps13", "dell", "laptops", "XPS 13 9310", "Refurbished Dell XPS 13 9310", 109900,
     {"storage": "512GB", "screen": "13.4in", "ram": "16GB"}),
    ("elite-840", "hp", "laptops", "EliteBook 840 G8", "Refurbished HP EliteBook 840 G8", 69900,
     {"storage": "256GB", "screen": "14.0in", "ram": "16GB"}),
    ("zen-14", "asus", "laptops", "ZenBook 14 UX425", "Refurbished ASUS ZenBook 14 UX425", 52900,
     {"storage": "512GB", "screen": "14.0in", "ram": "8GB"}),
    ("mba-m2", "apple", "laptops", "MacBook Air (M2)", "Refurbished MacBook Air M2", 129900,
     {"storage": "256GB", "screen": "13.6in", "ram": "8GB"}),

    # desktops
    ("opt-7080", "dell", "desktops", "OptiPlex 7080 SFF", "Refurbished Dell OptiPlex 7080 SFF", 59900,
     {"cpu": "Intel Core i5-10500", "ram": "16GB", "storage": "512GB SSD"}),
    ("opt-3070", "dell", "desktops", "OptiPlex 3070 Micro", "Refurbished Dell OptiPlex 3070 Micro", 44900,
     {"cpu": "Intel Core i5-9500T", "ram": "8GB", "storage": "256GB SSD"}),
    ("ed-800-g6", "hp", "desktops", "EliteDesk 800 G6", "Refurbished HP EliteDesk 800 G6", 74900,
     {"cpu": "Intel Core i7-10700", "ram": "16GB", "storage": "512GB SSD"}),
    ("mac-mini-m1", "apple", "desktops", "Mac mini (M1)", "Refurbished Mac mini M1", 89900,
     {"cpu": "Apple M1", "ram": "8GB", "storage": "256GB SSD"}),
    ("tc-m720q", "lenovo", "desktops", "ThinkCentre M720q Tiny", "Refurbished ThinkCentre M720q Tiny", 49900,
     {"cpu": "Intel Core i5-8500T", "ram": "8GB", "storage": "256GB SSD"}),
    ("pn50", "asus", "desktops", "Mini PC PN50", "Refurbished ASUS Mini PC PN50", 39900,
     {"cpu": "AMD Ryzen 5 4500U", "ram": "8GB", "storage": "256GB SSD"}),

    # monitors
    ("u2720q", "dell", "monitors", "UltraSharp U2720Q 27in", "Refurbished Dell UltraSharp U2720Q", 59900,
     {"size": "27in", "resolution": "3840x2160", "panel": "IPS"}),
    ("u2419h", "dell", "monitors", "UltraSharp U2419H 24in", "Refurbished Dell UltraSharp U2419H", 24900,
     {"size": "24in", "resolution": "1920x1080", "panel": "IPS"}),
    ("e24-g4", "hp", "monitors", "EliteDisplay E24 G4", "Refurbished HP EliteDisplay E24 G4", 18900,
     {"size": "23.8in", "resolution": "1920x1080", "panel": "IPS"}),
    ("27ul500", "lg", "monitors", "27UL500 27in 4K", "Refurbished LG 27UL500 4K", 32900,
     {"size": "27in", "resolution": "3840x2160", "panel": "IPS"}),
    ("pa248qv", "asus", "monitors", "ProArt PA248QV 24in", "Refurbished ASUS ProArt PA248QV", 29900,
     {"size": "24.1in", "resolution": "1920x1200", "panel": "IPS"}),
    ("p2219h", "dell", "monitors", "P2219H 22in", "Refurbished Dell P2219H", 9900,
     {"size": "21.5in", "resolution": "1920x1080", "panel": "IPS"}),

    # networking
    ("sg250-08", "cisco", "networking", "SG250-08 8-Port Gigabit Switch",
     "Refurbished Cisco SG250-08 Switch", 14900,
     {"ports": "8", "speed": "1Gbps", "managed": "yes"}),
    ("sg110-16", "cisco", "networking", "SG110-16 16-Port Switch", "Refurbished Cisco SG110-16 Switch", 19900,
     {"ports": "16", "speed": "1Gbps", "managed": "no"}),
    ("cbs350-24", "cisco", "networking", "CBS350-24T-4G 24-Port Switch",
     "Refurbished Cisco CBS350-24T-4G Switch", 74900,
     {"ports": "24", "speed": "1Gbps", "uplinks": "4x SFP"}),
    ("ax55", "tp-link", "networking", "Archer AX55 Wi-Fi 6 Router", "Refurbished TP-Link Archer AX55", 14900,
     {"standard": "Wi-Fi 6", "bands": "dual", "speed": "3000Mbps"}),
    ("tl-sg108", "tp-link", "networking", "TL-SG108 8-Port Switch",
     "Refurbished TP-Link TL-SG108 Switch", 4900,
     {"ports": "8", "speed": "1Gbps", "managed": "no"}),
    ("gs308", "netgear", "networking", "GS308 8-Port Gigabit Switch",
     "Refurbished Netgear GS308 Switch", 5900,
     {"ports": "8", "speed": "1Gbps", "managed": "no"}),

    # accessories
    ("mx-keys-mini", "logitech", "accessories", "MX Keys Mini", "Refurbished Logitech MX Keys Mini", 12900,
     {"connection": "Bluetooth", "layout": "ANSI", "backlight": "yes"}),
    ("k380", "logitech", "accessories", "K380 Multi-Device Keyboard",
     "Refurbished Logitech K380 Keyboard", 4900,
     {"connection": "Bluetooth", "layout": "ANSI", "backlight": "no"}),
    ("mx-master-3s", "logitech", "accessories", "MX Master 3S", "Refurbished Logitech MX Master 3S", 13900,
     {"connection": "Bluetooth", "buttons": "7", "dpi": "8000"}),
    ("m720", "logitech", "accessories", "M720 Triathlon Mouse", "Refurbished Logitech M720 Mouse", 4900,
     {"connection": "Bluetooth", "buttons": "8", "dpi": "1000"}),
    ("c920", "logitech", "accessories", "C920 HD Pro Webcam", "Refurbished Logitech C920 Webcam", 8900,
     {"resolution": "1080p", "connection": "USB-A", "mic": "stereo"}),
    ("zone-300", "logitech", "accessories", "Zone 300 Headset", "Refurbished Logitech Zone 300 Headset", 7900,
     {"connection": "Bluetooth", "mic": "noise-cancelling", "battery": "20h"}),
    ("wd19s", "dell", "accessories", "WD19S 180W Dock", "Refurbished Dell WD19S Dock", 19900,
     {"ports": "USB-C x3, HDMI, DP", "power": "180W", "network": "Gigabit"}),
    ("usbc-g5", "hp", "accessories", "USB-C G5 Dock", "Refurbished HP USB-C G5 Dock", 14900,
     {"ports": "USB-C x2, HDMI, DP", "power": "120W", "network": "Gigabit"}),
    ("tb4-dock", "lenovo", "accessories", "ThinkPad Thunderbolt 4 Dock",
     "Refurbished ThinkPad Thunderbolt 4 Dock", 18900,
     {"ports": "Thunderbolt 4, USB-A x4", "power": "135W", "network": "Gigabit"}),
    ("uh-323", "asus", "accessories", "USB-C 3-Port Hub", "Refurbished ASUS USB-C 3-Port Hub", 1900,
     {"ports": "USB-C x3", "connection": "USB-C", "power": "bus-powered"}),

    # parts
    ("kc3000-1tb", "kingston", "parts", "KC3000 1TB NVMe SSD", "Refurbished Kingston KC3000 1TB SSD", 14900,
     {"capacity": "1TB", "interface": "PCIe 4.0 NVMe", "form": "M.2 2280"}),
    ("a400-480", "kingston", "parts", "A400 480GB SATA SSD", "Refurbished Kingston A400 480GB SSD", 5900,
     {"capacity": "480GB", "interface": "SATA III", "form": "2.5in"}),
    ("barracuda-2tb", "seagate", "parts", "BarraCuda 2TB HDD", "Refurbished Seagate BarraCuda 2TB", 8900,
     {"capacity": "2TB", "interface": "SATA III", "form": "3.5in"}),
    ("kvr-16gb", "kingston", "parts", "16GB DDR4-2666 SODIMM", "Refurbished Kingston 16GB DDR4 SODIMM", 6900,
     {"capacity": "16GB", "interface": "DDR4-2666", "form": "SODIMM"}),
    ("kf-32gb", "kingston", "parts", "32GB DDR4-3200 Kit (2x16GB)",
     "Refurbished Kingston 32GB DDR4 Kit", 14900,
     {"capacity": "32GB", "interface": "DDR4-3200", "form": "DIMM (2x16GB)"}),
    ("tp-batt-52", "lenovo", "parts", "ThinkPad 52Wh Battery", "Refurbished ThinkPad 52Wh Battery", 9900,
     {"capacity": "52Wh", "interface": "internal", "form": "ThinkPad T/X series"}),

    # processors
    ("i3-10100", "intel", "processors", "Core i3-10100", "Refurbished Intel Core i3-10100", 8900,
     {"cores": "4", "socket": "LGA1200", "base_clock": "3.6GHz"}),
    ("i5-10400", "intel", "processors", "Core i5-10400", "Refurbished Intel Core i5-10400", 14900,
     {"cores": "6", "socket": "LGA1200", "base_clock": "2.9GHz"}),
    ("i7-10700", "intel", "processors", "Core i7-10700", "Refurbished Intel Core i7-10700", 24900,
     {"cores": "8", "socket": "LGA1200", "base_clock": "2.9GHz"}),
    ("r5-5600x", "amd", "processors", "Ryzen 5 5600X", "Refurbished AMD Ryzen 5 5600X", 19900,
     {"cores": "6", "socket": "AM4", "base_clock": "3.7GHz"}),
    ("r7-5800x", "amd", "processors", "Ryzen 7 5800X", "Refurbished AMD Ryzen 7 5800X", 29900,
     {"cores": "8", "socket": "AM4", "base_clock": "3.8GHz"}),
    ("r9-5900x", "amd", "processors", "Ryzen 9 5900X", "Refurbished AMD Ryzen 9 5900X", 44900,
     {"cores": "12", "socket": "AM4", "base_clock": "3.7GHz"}),
]

# Where the catalog v2 spread begins: the entries before it are job 4's, seeded long ago on any
# store that ran the old seeder, and this run must not recreate them (or re-price their units).
PRE_V2 = 9

GRADES = ("A", "B", "C", "D")
GRADE_FACTOR = {"A": 1.00, "B": 0.85, "C": 0.70, "D": 0.55}

# Units per product when --units-per is not given: accessories are the cheap, high-volume end of
# the catalog, so they carry one more unit than everything else.
UNITS_BY_CATEGORY = {"accessories": 3}
DEFAULT_UNITS = 2

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


def slug_for(code: str) -> str:
    """The product slug this seeder is idempotent on: `seed-demo-<code>`.

    One spelling of the rule, used by the create, the icon URL and the tests - the icon file in
    the storefront is named after the SLUG, so a second spelling here would point cards at files
    that do not exist.
    """
    return "seed-demo-" + code


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

    def patch(self, path: str, body=None, **kw) -> httpx.Response:
        return self.http.patch(path, headers=self._headers(path), json=body, **kw)

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


def existing_products(api: Api) -> dict[str, dict]:
    """Every product the CMS knows, by slug, with the one field the icon step reads back.

    The CMS list is the seeder's own view of the catalog (it is what an operator sees), and it
    carries `image_url` - so a re-run can tell "already pointed at its glyph" from "not yet" without
    a second request and without asking the storefront.
    """
    rows = api.need(api.get("/staff/cms/products"), 200).json()
    return {row["slug"]: {"id": row["id"], "image_url": row["image_url"]} for row in rows}


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


def ensure_product(api: Api, spec, known: dict[str, dict]) -> tuple[int, bool]:
    code, brand, category, model, title, base, specs = spec
    slug = slug_for(code)
    if slug in known:
        return known[slug]["id"], False
    r = api.post("/staff/products", {"brand_slug": brand, "category_slug": category, "model": model,
                                     "title": title, "slug": slug, "specs": specs,
                                     "description": f"Certified refurbished {model}. Graded and serialised."})
    api.need(r, 201)
    row = r.json()
    known[slug] = {"id": row["id"], "image_url": None}
    return row["id"], True


def ensure_icon(api: Api, product_id: int, slug: str, known: dict[str, dict]) -> bool:
    """Point one product at its own glyph - /icons/<slug>.svg - through the audited CMS PATCH.

    The glyph files are static storefront assets (apps/storefront/public/icons/<slug>.svg), written
    beside the ones job 11 shipped and built with the frontend; this container cannot see them, so
    the seeder owns the last half of the contract: the URL, named after the product slug so the file
    and the row can never disagree. Skipped when the product already carries exactly that URL, which
    is what keeps a re-run from writing anything at all - not even an audit row. Run for every entry,
    not only the ones this run created: the products seeded before catalog v2 have no image_url yet
    and would otherwise keep showing the initials tile.
    """
    url = "/icons/" + slug + ".svg"
    if (known.get(slug) or {}).get("image_url") == url:
        return False
    api.need(api.patch(f"/staff/cms/products/{product_id}", {"image_url": url}), 200)
    known.setdefault(slug, {})["image_url"] = url
    return True


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
    ap.add_argument("--products", type=int, default=None,
                    help="catalog products to create (default: the whole demo catalog)")
    ap.add_argument("--units-per", type=int, default=None,
                    help="units per product lot, every category "
                         "(default: per category - accessories 3, everything else 2)")
    ap.add_argument("--orders", type=int, default=6, help="paid guest orders to place")
    ap.add_argument("--customers", type=int, default=3, help="customer accounts to register")
    ap.add_argument("--rehabilitate", type=int, default=0, help="existing RX-BULK units to list")
    ap.add_argument("--admin-email", default="seed-demo-admin@rfo.local", help="seed staff admin")
    ap.add_argument("--admin-password", default=None,
                    help="password to set for an existing seed admin (default: generate one, printed once)")
    args = ap.parse_args()

    n_products = len(CATALOG) if args.products is None else max(0, min(args.products, len(CATALOG)))
    if args.products is not None and args.products > len(CATALOG):
        print(f"note: --products capped at {len(CATALOG)} (demo catalog size)")

    api = Api(args.base_url)
    ensure_admin(api, args.admin_email, args.admin_password)

    known = existing_products(api)
    p_new = u_new = lot_new = icon_new = 0
    lots: list[tuple[str, str, int]] = []
    for i, spec in enumerate(CATALOG[:n_products]):
        code, category = spec[0], spec[2]
        product_id, created = ensure_product(api, spec, known)
        p_new += int(created)
        # The glyph is set for every entry, created by this run or not: the catalog v2 products are
        # new, but the ones job 4 seeded carry no image_url either, and both should show device art
        # rather than the initials tile. Idempotent by comparison, so a re-run PATCHes nothing.
        icon_new += int(ensure_icon(api, product_id, slug_for(code), known))
        lot_id, lot_number, lot_created = ensure_lot(api, code)
        lot_new += int(lot_created)
        units = args.units_per if args.units_per is not None \
            else UNITS_BY_CATEGORY.get(category, DEFAULT_UNITS)
        for u in range(1, units + 1):
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
    print(f"  icons        patched {icon_new:>3}   (products pointed at /icons/<slug>.svg)")
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
