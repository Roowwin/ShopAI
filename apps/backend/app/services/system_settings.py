"""The system settings store: what the Settings API writes, and what the checkout reads.

WHY THIS IS NOT A NEW TABLE. The three things the Settings API holds - tax rates, general system
config and third-party API keys - are all key/value documents, and this schema already has exactly
that table: ``site_settings(key TEXT PRIMARY KEY, value JSONB, updated_at)``, created by
0008_site_cms and already carrying the CMS home document. A second generic settings table would be
two stores for one job.

It also keeps this change SCHEMA-FREE, which is deliberate rather than lazy: a new migration would
claim an alembic revision alongside concurrent work on the same checkout and the same database, and
a branch/head collision there is a far worse failure than reusing a table that already exists. The
at-rest shape is therefore a small set of keys, not a set of columns:

    tax_rates      {"AU": {"jurisdiction": "AU_GST", "rate_bp": 1000}, "NZ": {...}}
    system_config  {<operator-chosen key>: <any JSON value>, ...}
    api_keys       [{id, provider, label, secret, masked, scopes, is_active, created_at}, ...]

THE TAX RATES ARE LIVE, NOT INFORMATIONAL. :func:`get_tax_rate` is what ``store_ops.checkout``
calls, so editing a rate here changes the GST on the next order - and the SAME number is written to
that order's tax line, which is what makes the order total and the setting one fact instead of two
that can drift apart.

THE FALLBACK IS THE POINT OF THE READ BEING TOTAL. A missing row, a malformed document or a database
error must not turn a checkout into a 500, so every read degrades to the shipped default (AU 10%,
NZ 15%) rather than raising. A settings read must never be the reason a sale fails.
"""

import json
import re
import uuid

from sqlalchemy import text

TAX_RATES_KEY = "tax_rates"
SYSTEM_CONFIG_KEY = "system_config"
API_KEYS_KEY = "api_keys"

# The countries this shop ships to (the checkout's own pattern), so a stored rate is validated
# against the same closed set the order accepts.
COUNTRIES = ("AU", "NZ")

# Basis points (1/100 of a percent). The shipped defaults are the rates the checkout hardcoded
# before this store existed, so a database with no `tax_rates` row prices orders exactly as it
# always did. `DEFAULT_RATE_BP` is the LAST resort, used only for a country the map does not name.
MAX_RATE_BP = 10_000
DEFAULT_RATE_BP = 1_000
DEFAULT_TAX_RATES: dict[str, dict] = {
    "AU": {"jurisdiction": "AU_GST", "rate_bp": 1_000},
    "NZ": {"jurisdiction": "NZ_GST", "rate_bp": 1_500},
}
# The jurisdiction label the tax line carries. Constrained to the shape the orders table's CHECK
# accepts (two letters, underscore, two-to-ten letters) so a stored value cannot make the order
# write fail at commit time.
_JURISDICTION = re.compile(r"^[A-Z]{2}_[A-Z]{2,10}\Z")
# How many keys a single provider may hold. A settings page that lets an operator pile up live keys
# for one integration is one where "which key is in use" has no answer.
MAX_KEYS_PER_PROVIDER = 5
PROVIDER = re.compile(r"^[a-z0-9][a-z0-9._-]{0,39}\Z")


class SettingsError(ValueError):
    """A settings payload the API refuses. The message is written for the operator, not the log."""


# ---------------------------------------------------------------------------
# Reading and writing the raw documents
# ---------------------------------------------------------------------------
async def read_setting(db, key: str):
    """The stored JSON value for `key`, or None. Raises only if the database itself does."""
    row = (await db.execute(text("SELECT value FROM site_settings WHERE key = :k"),
                            {"k": key})).first()
    return row[0] if row is not None else None


async def write_setting(db, key: str, value) -> None:
    """Upsert one document. No commit here - it joins the caller's transaction like every audit row."""
    await db.execute(text(
        "INSERT INTO site_settings (key, value) VALUES (:k, CAST(:v AS jsonb))"
        " ON CONFLICT (key) DO UPDATE SET value = CAST(:v AS jsonb), updated_at = now()"),
        {"k": key, "v": json.dumps(value)})


# ---------------------------------------------------------------------------
# Tax rates
# ---------------------------------------------------------------------------
def validate_tax_rates(raw) -> dict[str, dict]:
    """An operator's payload -> the stored shape, or :class:`SettingsError`.

    Strict on purpose: a rate is money. A country outside the shipped set, a rate that is not a
    whole number of basis points, or a rate outside 0..100% is refused with the reason, rather than
    coerced into something that would silently misprice an order later.
    """
    if not isinstance(raw, dict) or not raw:
        raise SettingsError("tax_rates must be an object keyed by country code")
    out: dict[str, dict] = {}
    for country, entry in raw.items():
        code = str(country).strip().upper()
        if code not in COUNTRIES:
            raise SettingsError(f"country {country!r} is not one of: " + ", ".join(COUNTRIES))
        if not isinstance(entry, dict):
            raise SettingsError(f"tax_rates[{code}] must be an object with rate_bp and jurisdiction")
        bp = entry.get("rate_bp")
        # bool is an int subclass in Python; a JSON `true` must not become a 1bp tax rate.
        if isinstance(bp, bool) or not isinstance(bp, int):
            raise SettingsError(f"tax_rates[{code}].rate_bp must be a whole number of basis points")
        if not 0 <= bp <= MAX_RATE_BP:
            raise SettingsError(f"tax_rates[{code}].rate_bp must be between 0 and {MAX_RATE_BP}")
        jurisdiction = str(entry.get("jurisdiction") or f"{code}_GST").strip().upper()
        if not _JURISDICTION.match(jurisdiction):
            raise SettingsError(f"tax_rates[{code}].jurisdiction must look like AU_GST")
        out[code] = {"jurisdiction": jurisdiction, "rate_bp": bp}
    return out


def _coerce_stored_tax_rates(raw) -> dict[str, dict]:
    """A stored document -> the usable subset, dropping anything malformed instead of raising.

    Read-side leniency is the mirror of write-side strictness: a document edited by hand should
    never take the shop down, so a bad entry is ignored and its country falls back to the default.
    """
    out: dict[str, dict] = {}
    if not isinstance(raw, dict):
        return out
    for country, entry in raw.items():
        code = str(country).strip().upper()
        if code not in COUNTRIES or not isinstance(entry, dict):
            continue
        bp = entry.get("rate_bp")
        if isinstance(bp, bool) or not isinstance(bp, int) or not 0 <= bp <= MAX_RATE_BP:
            continue
        jurisdiction = str(entry.get("jurisdiction") or f"{code}_GST").strip().upper()
        if not _JURISDICTION.match(jurisdiction):
            continue
        out[code] = {"jurisdiction": jurisdiction, "rate_bp": bp}
    return out


async def get_tax_rates(db) -> dict[str, dict]:
    """Every country's rate in force: the stored value, backfilled per country from the defaults.

    Total by construction - a database error, a missing row or a corrupt document all resolve to the
    shipped defaults, because this is on the checkout's path.
    """
    stored: dict[str, dict] = {}
    try:
        stored = _coerce_stored_tax_rates(await read_setting(db, TAX_RATES_KEY))
    except Exception:
        stored = {}
    return {c: stored.get(c) or dict(DEFAULT_TAX_RATES[c]) for c in COUNTRIES}


async def get_tax_rate(db, country: str) -> tuple[str, int]:
    """(jurisdiction, rate_bp) for one country, never raising.

    An unknown country yields a derived jurisdiction label and the last-resort rate; the checkout's
    own ``^(AU|NZ)$`` pattern has already refused anything else, so this is a belt for a caller that
    reaches the function directly.
    """
    code = (country or "").strip().upper()
    rates = await get_tax_rates(db)
    entry = rates.get(code)
    if entry is None:
        return f"{code}_GST", DEFAULT_RATE_BP
    return entry["jurisdiction"], entry["rate_bp"]


# ---------------------------------------------------------------------------
# General system config
# ---------------------------------------------------------------------------
async def get_system_config(db) -> dict:
    """The operator's free-form config document, or {} when unset/malformed."""
    try:
        raw = await read_setting(db, SYSTEM_CONFIG_KEY)
    except Exception:
        return {}
    return dict(raw) if isinstance(raw, dict) else {}


def validate_config_value(value):
    """A config value must be JSON the database can hold. Refuse a document that is not an object."""
    if not isinstance(value, dict):
        raise SettingsError("system_config must be an object of key/value pairs")
    return value


# ---------------------------------------------------------------------------
# Third-party API keys
# ---------------------------------------------------------------------------
def mask_secret(secret: str) -> str:
    """The only form of a secret ever returned over HTTP: a recognisable, useless preview."""
    s = secret or ""
    if len(s) <= 8:
        return "*" * len(s)
    return f"{s[:4]}…{s[-4:]}"


def _public_key(entry: dict) -> dict:
    """One stored key without its secret. The single place the secret is dropped."""
    return {"id": entry["id"], "provider": entry["provider"], "label": entry.get("label") or "",
            "masked": entry.get("masked") or mask_secret(entry.get("secret") or ""),
            "scopes": list(entry.get("scopes") or []), "is_active": bool(entry.get("is_active", True)),
            "created_at": entry.get("created_at")}


async def _read_keys(db) -> list[dict]:
    try:
        raw = await read_setting(db, API_KEYS_KEY)
    except Exception:
        return []
    if not isinstance(raw, list):
        return []
    return [e for e in raw if isinstance(e, dict) and e.get("id") and e.get("provider")]


async def list_api_keys(db) -> list[dict]:
    """Every stored key in its public shape. The secret never leaves this module."""
    return [_public_key(e) for e in await _read_keys(db)]


def validate_api_key(provider: str, secret: str) -> tuple[str, str]:
    p = str(provider or "").strip().lower()
    s = str(secret or "").strip()
    if not PROVIDER.match(p):
        raise SettingsError("provider must be a lowercase slug, e.g. 'stripe' or 'anthropic'")
    if len(s) < 8:
        raise SettingsError("secret must be at least 8 characters")
    if len(s) > 4096:
        raise SettingsError("secret is implausibly long")
    return p, s


async def create_api_key(db, *, provider: str, label: str, secret: str, scopes, staff_id: int,
                         now: str) -> dict:
    """Add a key and return its PUBLIC shape (never the secret). Raises SettingsError on a bad input."""
    p, s = validate_api_key(provider, secret)
    keys = await _read_keys(db)
    live = [k for k in keys if k.get("provider") == p and k.get("is_active", True)]
    if len(live) >= MAX_KEYS_PER_PROVIDER:
        raise SettingsError(f"{p} already has {MAX_KEYS_PER_PROVIDER} active keys - revoke one first")
    entry = {"id": uuid.uuid4().hex[:12], "provider": p, "label": str(label or "").strip()[:80],
             "secret": s, "masked": mask_secret(s),
             "scopes": [str(x) for x in (scopes or [])][:20], "is_active": True,
             "created_by": staff_id, "created_at": now}
    keys.append(entry)
    await write_setting(db, API_KEYS_KEY, keys)
    return _public_key(entry)


async def revoke_api_key(db, key_id: str) -> bool:
    """Deactivate one key. Returns False if no such key is live."""
    keys = await _read_keys(db)
    hit = False
    for entry in keys:
        if entry.get("id") == key_id and entry.get("is_active", True):
            entry["is_active"] = False
            hit = True
    if hit:
        await write_setting(db, API_KEYS_KEY, keys)
    return hit


async def get_api_key(db, provider: str) -> str | None:
    """The raw secret of the newest active key for `provider`, for an internal caller only.

    This is the function a future outbound integration uses; it is deliberately NOT reachable from
    any HTTP door - the API returns :func:`mask_secret` output and nothing else.
    """
    p = str(provider or "").strip().lower()
    keys = [k for k in await _read_keys(db) if k.get("provider") == p and k.get("is_active", True)]
    return keys[-1].get("secret") if keys else None
