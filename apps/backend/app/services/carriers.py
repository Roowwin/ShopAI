"""Carrier integration: turning an order into a real shipping label.

WHAT THIS IS. A real Australia Post client - the documented Shipping API request, the documented
auth header, the account number in the `from` block, the article id read back from the response, and
the label document fetched for the shipment that was just created. It is one carrier behind an
interface, so a second carrier is a new entry in `CARRIERS` and one function, not a rewrite of the
call site.

WHAT IT IS NOT. It cannot work yet, and it says so rather than pretending. There is no Australia
Post account in this deployment, no API key in the environment, and no warehouse return address
configured - so `available()` reports the carrier as unconfigured and `book_label` refuses with the
list of exactly what is missing. **Nothing here ever fabricates a label, a tracking number or a
rate.** A made-up tracking reference is worse than no label at all: it is a number an operator would
paste into a customer email and a carrier's website would not recognise. The refusal is the feature.

WHY THE CREDENTIAL COMES FROM TWO PLACES. The platform's settings store (`site_settings` under
`api_keys`, read-only through `services/system_settings`) holds provider secrets in plaintext, masked
only on the way out to a browser - so a key an administrator saved there is a real key this client
can use, and it wins over the environment. The environment remains the fallback because that is where
this repo's other provider secret lives (`AI_CLOUD_API_KEY`, read per request in `services/ai.py`),
and a deployment that configures a carrier the old way should not have to learn a new one. The
ACCOUNT NUMBER and the WAREHOUSE RETURN ADDRESS have no home in the settings store - the store's
shape is a provider slug and one secret - so they are environment-only, and `available()` names them
so the gap is visible instead of mysterious.

THE HTTP IS ONE SEAM, ON PURPOSE. `book_label` takes the `httpx.AsyncClient` it should use. In
production that is a module-level client; in `tests/test_fulfillment.py` it is a client built on a
transport that records the request and replays a canned response. That is what lets the request
SHAPING - host, path, auth header, the JSON body's account and recipient blocks - be asserted
without an account and without a network call, which is the only honest way to test an integration
whose credentials do not exist. The test says so in its own docstring.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

import httpx

from app.services import system_settings

# The documented production host, used when nothing overrides it. A test environment is a base-URL
# change, not a code change, which is the whole reason this is configuration and not a literal in the
# request function.
AUSPOST_DEFAULT_BASE = "https://digitalapi.auspost.com.au"

# Australia Post's own default when a caller does not name a service. Named here so the value the
# request carries is visible in one place rather than buried in the body builder.
AUSPOST_DEFAULT_SERVICE = "PARCEL_POST"


def api_base() -> str:
    """The host to call, read PER REQUEST rather than frozen at import.

    A module-level `os.getenv` would look like configuration and behave like a constant: changing the
    environment - a staging host, a test double, a per-deployment override - would silently do
    nothing until the process restarted, and a test that set it would keep issuing real requests to
    production. Reading it here is the same contract `services/ai.py` keeps with its own provider
    variables, and it is why the base URL can be pointed at a recorder in a test at all.
    """
    return (os.getenv("AUSPOST_API_BASE", "") or "").strip() or AUSPOST_DEFAULT_BASE

TIMEOUT_SECONDS = 30.0


class CarrierError(Exception):
    """Any refusal or failure this module makes. Written for the operator, not for a log."""


@dataclass(frozen=True)
class Carrier:
    """One carrier, and what it takes to use it.

    `needs` is prose for the screen, not for the code: an operator who presses a button that cannot
    work should be told what to go and configure, in a sentence they can act on. `missing()` builds
    the specific list; this is the general one.
    """

    key: str
    label: str
    provider: str
    env_key: str
    env_account: str
    needs: str


CARRIERS: tuple[Carrier, ...] = (
    Carrier(
        key="auspost",
        label="Australia Post",
        provider="auspost",
        env_key="AUSPOST_API_KEY",
        env_account="AUSPOST_ACCOUNT",
        needs="an Australia Post API key, the account number it bills, and a warehouse return address",
    ),
)

CARRIER_BY_KEY = {c.key: c for c in CARRIERS}


@dataclass(frozen=True)
class Label:
    """A label that a carrier actually issued.

    `label_bytes` may be EMPTY when the shipment was created but its document could not be fetched -
    `note` says so and `tracking_ref` is still real, because the booking really happened. An empty
    document with a warning is the honest outcome; a fabricated PDF would not be.
    """

    carrier: str
    service: str
    tracking_ref: str
    label_bytes: bytes
    label_format: str
    cost_cents: int | None = None
    note: str | None = None
    raw: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def warehouse() -> dict:
    """The return address a carrier label must carry. Environment-only (see the module docstring)."""
    return {
        "name": (os.getenv("WAREHOUSE_NAME", "") or "").strip(),
        "line1": (os.getenv("WAREHOUSE_LINE1", "") or "").strip(),
        "line2": (os.getenv("WAREHOUSE_LINE2", "") or "").strip(),
        "city": (os.getenv("WAREHOUSE_CITY", "") or "").strip(),
        "state": (os.getenv("WAREHOUSE_STATE", "") or "").strip(),
        "postcode": (os.getenv("WAREHOUSE_POSTCODE", "") or "").strip(),
        "country": (os.getenv("WAREHOUSE_COUNTRY", "") or "").strip() or "AU",
    }


async def _stored_secret(db, provider: str) -> str:
    """The newest ACTIVE secret saved for `provider` in the settings store, or "".

    Read-only: this module never writes the settings document, and the value never leaves this
    module except into an outgoing carrier request's auth header. A store that cannot be read is
    treated as empty rather than fatal - the environment fallback is the next step, and a carrier
    integration should not be able to take the checkout down.
    """
    try:
        raw = await system_settings.read_setting(db, system_settings.API_KEYS_KEY)
    except Exception:
        return ""
    if not isinstance(raw, list):
        return ""
    for entry in reversed(raw):  # newest first - the store appends
        if not isinstance(entry, dict) or entry.get("provider") != provider:
            continue
        if not entry.get("is_active", True):
            continue
        secret = entry.get("secret")
        if isinstance(secret, str) and secret.strip():
            return secret.strip()
    return ""


async def credentials(db, carrier: Carrier) -> dict:
    """What this carrier needs to make a call. Missing pieces are simply absent from the dict."""
    out: dict[str, str] = {}
    api_key = await _stored_secret(db, carrier.provider)
    if not api_key:
        api_key = (os.getenv(carrier.env_key, "") or "").strip()
    if api_key:
        out["api_key"] = api_key
    account = (os.getenv(carrier.env_account, "") or "").strip()
    if account:
        out["account"] = account
    wh = warehouse()
    if wh["name"] and wh["line1"] and wh["city"] and wh["state"] and wh["postcode"]:
        out["warehouse_ready"] = "1"
    return out


def missing(creds: dict, carrier: Carrier) -> list[str]:
    """The specific things an operator has to configure, in the order they would go and do them."""
    out = []
    if not creds.get("api_key"):
        out.append(
            f"a {carrier.label} API key - save one for provider '{carrier.provider}' on the Settings "
            f"page, or set {carrier.env_key}"
        )
    if not creds.get("account"):
        out.append(f"the {carrier.label} account number the labels are billed to - set {carrier.env_account}")
    if not creds.get("warehouse_ready"):
        out.append(
            "a warehouse return address - set WAREHOUSE_NAME, WAREHOUSE_LINE1, WAREHOUSE_CITY, "
            "WAREHOUSE_STATE and WAREHOUSE_POSTCODE"
        )
    return out


async def available(db) -> list[dict]:
    """Every carrier and whether it can be used, which is what the screen prints instead of a button
    that fails on press."""
    out = []
    for carrier in CARRIERS:
        creds = await credentials(db, carrier)
        gaps = missing(creds, carrier)
        out.append({
            "key": carrier.key,
            "label": carrier.label,
            "configured": not gaps,
            "needs": carrier.needs,
            "missing": gaps,
        })
    return out


# ---------------------------------------------------------------------------
# Booking a label
# ---------------------------------------------------------------------------

def _auspost_shipment_body(*, order: dict, recipient: dict, wh: dict, account: str,
                           parcel: dict, reference: str) -> dict:
    """The documented shipment document, built from the order.

    Items come from the ORDER LINES, one line per unit, because that is what an operator counts when
    the parcel is packed and what a carrier's manifest has to agree with. `shipment_reference` is the
    order's own public id, so a label found on a bench can be traced back to the order without a
    lookup - carriers echo it on the manifest for exactly this reason.
    """
    items = [{
        "item_reference": str(line.get("asset_id") or idx + 1),
        "description": str(line.get("sku_title") or "Unit")[:80],
        "quantity": 1,
        "length": parcel.get("length_cm", 0),
        "width": parcel.get("width_cm", 0),
        "height": parcel.get("height_cm", 0),
        "weight": max(int(parcel.get("weight_grams") or 0), 1),
        "item_value": round(int(line.get("line_total_cents") or 0) / 100, 2),
    } for idx, line in enumerate(order.get("lines") or [])]
    if not items:
        # A shipment with no items is refused by the carrier anyway; failing here gives a sentence
        # instead of a 400 paraphrased out of their error body.
        raise CarrierError("this order has no lines to put on a label")
    return {
        "shipments": [{
            "shipment_reference": reference,
            "from": {
                "name": wh["name"], "lines": [wh["line1"], wh["line2"], wh["city"], wh["state"]],
                "postcode": wh["postcode"], "country": wh["country"], "account_number": account,
            },
            "to": {
                "name": recipient.get("name") or "Recipient",
                "lines": [recipient.get("line1") or "", recipient.get("line2") or "",
                          recipient.get("city") or "", recipient.get("state") or ""],
                "postcode": recipient.get("postcode") or "", "country": recipient.get("country") or "AU",
            },
            "items": items,
            "label": {"type": "PDF"},
            "service": parcel.get("service") or AUSPOST_DEFAULT_SERVICE,
        }]
    }


async def _post_json(client: httpx.AsyncClient, url: str, payload: dict, headers: dict) -> dict:
    """One JSON call. The single place a POST's shape is decided."""
    r = await client.post(url, json=payload, headers=headers, timeout=TIMEOUT_SECONDS)
    if r.status_code not in (200, 201):
        raise CarrierError("the carrier refused the shipment (HTTP "
                           + str(r.status_code) + "): " + r.text[:200])
    try:
        return r.json()
    except Exception:
        raise CarrierError("the carrier answered with something that is not JSON")


# What a label document can be. The carriers call these PDF or ZPL; the wire calls them media types,
# and the UI needs the former - "application/pdf" is a header, not something a download button can
# put a file extension on. An unrecognised type is passed through rather than mapped to a default, so
# a carrier that starts returning something new shows up in the UI instead of being mislabelled.
_FORMAT_BY_TYPE = {"application/pdf": "pdf", "image/png": "png", "text/plain": "zpl",
                   "application/zpl": "zpl"}


def _format_of(content_type: str) -> str:
    ct = (content_type or "").split(";")[0].strip().lower()
    return _FORMAT_BY_TYPE.get(ct, ct or "unknown")


async def _get_bytes(client: httpx.AsyncClient, url: str, headers: dict) -> tuple[bytes, str]:
    r = await client.get(url, headers=headers, timeout=TIMEOUT_SECONDS)
    if r.status_code != 200:
        raise CarrierError("the label document could not be fetched (HTTP " + str(r.status_code) + ")")
    return r.content, _format_of(r.headers.get("content-type") or "")


async def _auspost_book(db, creds: dict, *, order: dict, recipient: dict, parcel: dict,
                        client: httpx.AsyncClient) -> Label:
    wh = warehouse()
    base = api_base().rstrip("/")
    headers = {"AUTH-KEY": creds["api_key"], "Accept": "application/json",
               "Content-Type": "application/json"}
    reference = str(order.get("public_id") or order.get("id") or "")
    body = _auspost_shipment_body(order=order, recipient=recipient, wh=wh, account=creds["account"],
                                  parcel=parcel, reference=reference)

    created = await _post_json(client, base + "/shipping/v1/shipments", body, headers)
    shipments = created.get("shipments") or []
    if not shipments:
        raise CarrierError("the carrier accepted the request but returned no shipment")
    first = shipments[0]
    shipment_id = first.get("shipment_id")
    tracking = ((first.get("tracking_details") or {}).get("article_id")
                or first.get("tracking_ref") or "")
    if not shipment_id or not tracking:
        # A booking we cannot name is a booking the operator cannot use, and silently returning an
        # empty tracking ref would put a blank field on a label the customer then cannot track.
        raise CarrierError("the carrier returned a shipment without a tracking reference")

    note = None
    label_bytes, fmt = b"", "pdf"
    try:
        label_bytes, fmt = await _get_bytes(
            client, base + f"/shipping/v1/shipments/{shipment_id}/label",
            {**headers, "Accept": "application/pdf"})
    except CarrierError as e:
        # The shipment EXISTS at this point, so this is not a failed booking - it is a booking whose
        # document has to be re-fetched. Saying so, with a real tracking ref, beats discarding it.
        note = str(e) + " - the shipment was created, so re-fetch its label before printing."

    service = ((first.get("shipment_summary") or {}).get("service")
               or parcel.get("service") or AUSPOST_DEFAULT_SERVICE)
    return Label(carrier="auspost", service=str(service), tracking_ref=str(tracking),
                 label_bytes=label_bytes, label_format=fmt, note=note,
                 raw={"shipment_id": shipment_id, "reference": reference})


async def book_label(db, carrier_key: str, *, order: dict, recipient: dict,
                     parcel: dict | None = None, client: httpx.AsyncClient | None = None) -> Label:
    """Book one label for one order. Refuses - never fabricates - when the carrier is unusable.

    `client` is the seam: production passes the module client, a test passes one built on a
    recording transport. See the module docstring.
    """
    carrier = CARRIER_BY_KEY.get(carrier_key)
    if carrier is None:
        raise CarrierError("unknown carrier: " + str(carrier_key))
    creds = await credentials(db, carrier)
    gaps = missing(creds, carrier)
    if gaps:
        raise CarrierError("this carrier is not configured yet - it needs " + "; ".join(gaps))
    if not str(recipient.get("postcode") or "").strip():
        raise CarrierError("this order has no delivery postcode, so a label cannot be rated or issued")

    parcel = dict(parcel or {})
    own_client = client is None
    if own_client:
        client = httpx.AsyncClient()
    try:
        return await _auspost_book(db, creds, order=order, recipient=recipient, parcel=parcel,
                                   client=client)
    except httpx.HTTPError as e:
        # A network failure is not the carrier refusing; say which it was.
        raise CarrierError("the carrier could not be reached: " + str(e)[:160])
    finally:
        if own_client:
            await client.aclose()
