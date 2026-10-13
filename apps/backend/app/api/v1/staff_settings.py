"""The Settings API: tax rates, general system config, and third-party API keys.

WHY THIS FILE EXISTS. Every knob the platform grew was hardcoded or lived in an environment file:
the GST rates were a literal in `store_ops` (``TAX = {"AU": ..., "NZ": ...}``) and a third-party
credential had nowhere to live at all. That is fine until an operator wants to change a rate or add
an integration without a deploy - which is the whole point of a Settings page. This is the storage
door behind one.

WHAT IT OWNS. Three documents in `site_settings`, described in full in
``app/services/system_settings.py`` (the module that also holds the validation and the masking, so
this file is HTTP shape only):

    tax_rates      read by the checkout, so an edit here changes real order totals
    system_config  free-form operator config
    api_keys       third-party credentials, stored whole and returned MASKED
    business_identity  the seller block a tax invoice prints (legal name, ABN, address, email)

THE SECRET NEVER LEAVES MASKED. ``create`` returns ``mask_secret`` output and every read is filtered
through ``_public_key``; there is deliberately no endpoint that returns a stored secret. An internal
caller that genuinely needs the raw value uses ``system_settings.get_api_key`` directly.

AUTHORIZATION. Reads take admin or manager; every write takes admin alone - a tax rate is money and
an API key is a credential, so neither is a manager's to change. The role tuples are constants used
by both the decorator and the in-body guard, and the action names are NOT in
``staff_ops.GUARDED_ACTIONS``: the chat rail does not dispatch here, so an agent identity is refused
by the shared guard rather than admitted through a grant for an action the rail cannot run.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError

from app.api.v1.deps import require_roles
from app.api.v1.staff_ops import _409, _require_role
from app.core.db import get_db
from app.services.audit import audit
from app.services import system_settings as ss

router = APIRouter(prefix="/staff/settings", tags=["staff-settings"])

ROLES_SETTINGS_READ = ("admin", "manager")
ROLES_SETTINGS_WRITE = ("admin",)
# Names for the audit rows and the in-body guard. None of these is in GUARDED_ACTIONS, which is what
# keeps the grant branch in `_require_role` unreachable: db=None is passed below.
ACTION_READ_SETTINGS = "read_settings"
ACTION_WRITE_TAX_RATES = "write_tax_rates"
ACTION_WRITE_CONFIG = "write_system_config"
ACTION_WRITE_IDENTITY = "write_business_identity"
ACTION_CREATE_API_KEY = "create_api_key"
ACTION_REVOKE_API_KEY = "revoke_api_key"


class TaxRatesIn(BaseModel):
    """The whole tax-rate document, keyed by country. Validated by the service, not here."""
    rates: dict


class ConfigIn(BaseModel):
    """A partial config patch: keys to set, and keys given as null to remove."""
    values: dict


class IdentityIn(BaseModel):
    """The seller block a tax invoice carries. Validated by the service, not here."""
    legal_name: str = Field(default="", max_length=400)
    tax_id: str = Field(default="", max_length=400)
    address: str = Field(default="", max_length=400)
    email: str = Field(default="", max_length=400)


class ApiKeyIn(BaseModel):
    provider: str = Field(max_length=40)
    label: str = Field(default="", max_length=80)
    secret: str = Field(min_length=8, max_length=4096)
    scopes: list[str] = Field(default_factory=list, max_length=20)


def _refuse(e: ss.SettingsError) -> None:
    raise HTTPException(status_code=422, detail=str(e))


@router.get("")
async def get_settings_root(staff: dict = Depends(require_roles(*ROLES_SETTINGS_READ)), db=Depends(get_db)):
    """Everything a Settings page shows at a glance: the live tax rates, the config document, and the
    business's own legal identity (what an invoice names as its seller)."""
    await _require_role(staff, ROLES_SETTINGS_READ, ACTION_READ_SETTINGS, None)
    return {"tax_rates": await ss.get_tax_rates(db), "config": await ss.get_system_config(db),
            "identity": await ss.get_business_identity(db)}


@router.get("/tax-rates")
async def get_tax_rates(staff: dict = Depends(require_roles(*ROLES_SETTINGS_READ)), db=Depends(get_db)):
    """The rates in force - the same call the checkout makes, so the page cannot show a stale one."""
    await _require_role(staff, ROLES_SETTINGS_READ, ACTION_READ_SETTINGS, None)
    return {"tax_rates": await ss.get_tax_rates(db)}


@router.put("/tax-rates")
async def put_tax_rates(body: TaxRatesIn, staff: dict = Depends(require_roles(*ROLES_SETTINGS_WRITE)),
                        db=Depends(get_db)):
    """Replace the tax-rate document. The next checkout prices from exactly this."""
    await _require_role(staff, ROLES_SETTINGS_WRITE, ACTION_WRITE_TAX_RATES, None)
    try:
        rates = ss.validate_tax_rates(body.rates)
    except ss.SettingsError as e:
        _refuse(e)
    before = await ss.get_tax_rates(db)
    await ss.write_setting(db, ss.TAX_RATES_KEY, rates)
    await audit(db, "staff", entity="settings", action="tax_rates_updated",
                actor_id=staff["id"], before=before, after=rates)
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"tax_rates": rates}


@router.get("/config")
async def get_config(staff: dict = Depends(require_roles(*ROLES_SETTINGS_READ)), db=Depends(get_db)):
    await _require_role(staff, ROLES_SETTINGS_READ, ACTION_READ_SETTINGS, None)
    return {"config": await ss.get_system_config(db)}


@router.put("/config")
async def put_config(body: ConfigIn, staff: dict = Depends(require_roles(*ROLES_SETTINGS_WRITE)),
                     db=Depends(get_db)):
    """Merge a config patch. A key set to null is REMOVED rather than stored as a null value.

    Merging (not replacing) is the right shape for a settings form that edits one field at a time:
    a full replace would delete every other key an operator set from another screen.
    """
    await _require_role(staff, ROLES_SETTINGS_WRITE, ACTION_WRITE_CONFIG, None)
    try:
        ss.validate_config_value(body.values)
    except ss.SettingsError as e:
        _refuse(e)
    before = await ss.get_system_config(db)
    merged = dict(before)
    for k, v in body.values.items():
        if v is None:
            merged.pop(k, None)
        else:
            merged[k] = v
    await ss.write_setting(db, ss.SYSTEM_CONFIG_KEY, merged)
    await audit(db, "staff", entity="settings", action="system_config_updated",
                actor_id=staff["id"], before=before, after=merged)
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"config": merged}


@router.get("/identity")
async def get_identity(staff: dict = Depends(require_roles(*ROLES_SETTINGS_READ)), db=Depends(get_db)):
    """The seller block an invoice prints: legal name, ABN/Tax ID, registered address, contact email."""
    await _require_role(staff, ROLES_SETTINGS_READ, ACTION_READ_SETTINGS, None)
    return {"identity": await ss.get_business_identity(db)}


@router.put("/identity")
async def put_identity(body: IdentityIn, staff: dict = Depends(require_roles(*ROLES_SETTINGS_WRITE)),
                       db=Depends(get_db)):
    """Replace the business's legal identity - what every invoice then names as its seller.

    A replace rather than a merge, unlike `system_config`: this is ONE document with a fixed set of
    four fields, and a form that submits all four cannot mean "leave the others as they were" - a
    merge would make a field impossible to CLEAR, which is exactly what an operator does after
    mistyping an ABN.
    """
    await _require_role(staff, ROLES_SETTINGS_WRITE, ACTION_WRITE_IDENTITY, None)
    try:
        identity = ss.validate_business_identity(body.model_dump())
    except ss.SettingsError as e:
        _refuse(e)
    before = await ss.get_business_identity(db)
    await ss.write_setting(db, ss.BUSINESS_IDENTITY_KEY, identity)
    await audit(db, "staff", entity="settings", action="business_identity_updated",
                actor_id=staff["id"], before=before, after=identity)
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"identity": identity}


@router.get("/api-keys")
async def list_api_keys(staff: dict = Depends(require_roles(*ROLES_SETTINGS_WRITE)), db=Depends(get_db)):
    """Active and revoked keys, each in its masked shape. Admin only - these guard integrations."""
    await _require_role(staff, ROLES_SETTINGS_WRITE, ACTION_READ_SETTINGS, None)
    return {"api_keys": await ss.list_api_keys(db)}


@router.post("/api-keys", status_code=201)
async def create_api_key(body: ApiKeyIn, staff: dict = Depends(require_roles(*ROLES_SETTINGS_WRITE)),
                         db=Depends(get_db)):
    """Store a key. The response is the masked shape; the secret is never echoed back."""
    await _require_role(staff, ROLES_SETTINGS_WRITE, ACTION_CREATE_API_KEY, None)
    try:
        created = await ss.create_api_key(db, provider=body.provider, label=body.label,
                                          secret=body.secret, scopes=body.scopes,
                                          staff_id=staff["id"],
                                          now=datetime.now(timezone.utc).isoformat())
    except ss.SettingsError as e:
        _refuse(e)
    await audit(db, "staff", entity="settings", action="api_key_created", actor_id=staff["id"],
                after={"provider": created["provider"], "masked": created["masked"]})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return created


@router.delete("/api-keys/{key_id}")
async def revoke_api_key(key_id: str, staff: dict = Depends(require_roles(*ROLES_SETTINGS_WRITE)),
                         db=Depends(get_db)):
    """Revoke one key. Idempotent: revoking an unknown or already-revoked id is a 404."""
    await _require_role(staff, ROLES_SETTINGS_WRITE, ACTION_REVOKE_API_KEY, None)
    if not await ss.revoke_api_key(db, key_id):
        raise HTTPException(status_code=404, detail="no active key with that id")
    await audit(db, "staff", entity="settings", action="api_key_revoked", actor_id=staff["id"],
                after={"key_id": key_id})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"id": key_id, "is_active": False}
