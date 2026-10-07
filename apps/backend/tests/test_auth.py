import uuid

import httpx
import pyotp
from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine
from app.main import app

async def _cleanup():
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN (SELECT id FROM staff_users WHERE email LIKE 'pytest-%') OR identity_id IN (SELECT id FROM users WHERE email LIKE 'pytest-%')"))
        await c.execute(text("DELETE FROM staff_users WHERE email LIKE 'pytest-%'"))
        await c.execute(text("DELETE FROM users WHERE email LIKE 'pytest-%'"))

async def test_health(client):
    r = await client.get("/healthz")
    assert r.status_code == 200 and r.json()["status"] == "ok"
    r = await client.get("/readyz")
    assert r.status_code == 200 and r.json()["db"] is True

async def test_store_register_login_me(client):
    await _cleanup()
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    r = await client.post("/store/auth/register", json={"email": email, "password": "Str0ngPass!23", "display_name": "T"})
    assert r.status_code == 200, r.text
    access = r.json()["access_token"]
    r2 = await client.post("/store/auth/login", json={"email": email, "password": "Str0ngPass!23"})
    assert r2.status_code == 200
    r3 = await client.get("/store/me", headers={"Authorization": "Bearer " + access})
    assert r3.status_code == 200 and r3.json()["email"] == email

async def test_refresh_rotation_theft(client):
    await _cleanup()
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    r = await client.post("/store/auth/register", json={"email": email, "password": "Str0ngPass!23"})
    assert r.status_code == 200
    old = client.cookies.get("rfo_rt_store")
    assert old
    r2 = await client.post("/store/auth/refresh")
    assert r2.status_code == 200
    # replay the STOLEN token in an isolated client - the main jar keeps ONE clean entry
    t = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://t")
    t.cookies.set("rfo_rt_store", old, domain="t", path="/store/auth")
    r3 = await t.post("/store/auth/refresh")
    assert r3.status_code == 401
    r4 = await t.post("/store/auth/refresh")
    assert r4.status_code == 401
    await t.aclose()
    r5 = await client.post("/store/auth/login", json={"email": email, "password": "Str0ngPass!23"})
    assert r5.status_code == 200
    r6 = await client.post("/store/auth/refresh")
    assert r6.status_code == 200

async def test_staff_mfa_flow(client):
    await _cleanup()
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    sid, pw = await bootstrap(email, "admin")
    assert pw
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200
    h = {"Authorization": "Bearer " + r.json()["access_token"]}
    r = await client.post("/staff/auth/mfa/setup", headers=h)
    assert r.status_code == 200, r.text
    secret = r.json()["secret"]
    r = await client.post("/staff/auth/mfa/enable", json={"code": pyotp.TOTP(secret).now()}, headers=h)
    assert r.status_code == 200 and r.json()["enabled"] is True
    r2 = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    assert r2.status_code == 200 and r2.json().get("requires_mfa") is True
    r3 = await client.post("/staff/auth/mfa/verify", json={"code": pyotp.TOTP(secret).now()}, headers={"Authorization": "Bearer " + r2.json()["challenge"]})
    assert r3.status_code == 200, r3.text
    r4 = await client.get("/staff/me", headers={"Authorization": "Bearer " + r3.json()["access_token"]})
    assert r4.status_code == 200 and r4.json()["role"] == "admin"

async def test_rbac_403(client):
    await _cleanup()
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    sid, pw = await bootstrap(email, "technician")
    assert pw
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    h = {"Authorization": "Bearer " + r.json()["access_token"]}
    r = await client.get("/staff/admin/ping", headers=h)
    assert r.status_code == 403
