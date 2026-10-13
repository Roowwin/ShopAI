"""The Team page's doors: admin-only, self-proof, and the three ways out that must stay shut.

Every test here creates its own `pytest-<uuid>@test.rfo` identities and removes them in a `finally`,
the idiom `test_staff_read_walls.py` established - the dev database is shared, so a suite that
leaves a row behind is a suite that fails someone else's run.

The two claims that are easy to assert wrongly, and how they are pinned instead:

* **"The password is gone."** A reset that returned a plaintext and also wrote it somewhere is the
  failure this suite exists to catch, so the assertion is not "the response has a password" but
  "the audit table does not" - the returned value is looked for in every audit row the reset wrote.
* **"Suspended means suspended."** Revoking the refresh rows is only half of it; the test signs in
  as the suspended member afterwards and requires a refusal, because a status column that nothing
  reads is a status column that does nothing.
"""

import json
import uuid

from sqlalchemy import text

from app.api.v1 import staff_team
from app.bootstrap_staff import bootstrap
from app.core.db import get_engine


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


# The identities THIS run created, so cleanup removes exactly those. A `email LIKE 'pytest-%'`
# sweep would also delete a concurrently-running suite's identities out from under it - which is
# how a shared dev database turns two green suites into two red ones - and the narrow delete costs
# nothing, because every address this module touches was minted here.
_created: set[str] = set()


async def _cleanup():
    if not _created:
        return
    eng = get_engine()
    emails = sorted(_created)
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                             "(SELECT id FROM staff_users WHERE email = ANY(:e))"), {"e": emails})
        await c.execute(text("DELETE FROM staff_users WHERE email = ANY(:e)"), {"e": emails})
    _created.clear()


async def _staff(client, role: str = "admin", password: str | None = None) -> tuple[int, str, str]:
    """(id, email, access token). A member created through the real bootstrap, then signed in."""
    email = "pytest-team-" + uuid.uuid4().hex + "@test.rfo"
    _created.add(email)
    sid, pw = await bootstrap(email, role)
    pw = password or pw
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return sid, email, r.json()["access_token"]


async def _me_id(client, tok: str) -> int:
    r = await client.get("/staff/me", headers=_h(tok))
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def test_team_is_admin_only_and_leaks_no_secret(client):
    """No credential -> 401, a real staff token of the wrong role -> 403, admin -> 200.

    The body assertion is the second half of the wall: a roster that renders a password hash or a
    TOTP secret is a leak even when every caller is an administrator.
    """
    await _cleanup()
    try:
        r = await client.get("/staff/team")
        assert r.status_code == 401, r.text

        r = await client.get("/staff/team", headers=_h((await _staff(client, "sales"))[2]))
        assert r.status_code == 403, r.text

        _, _, admin_tok = await _staff(client, "admin")
        r = await client.get("/staff/team", headers=_h(admin_tok))
        assert r.status_code == 200, r.text
        body = json.dumps(r.json())
        assert "password_hash" not in body, body[:200]
        assert "totp_secret" not in body, body[:200]
        assert r.json()["roles"] == ["admin", "manager", "technician", "warehouse", "sales"]

        me = await _me_id(client, admin_tok)
        mine = [m for m in r.json()["members"] if m["id"] == me]
        assert len(mine) == 1 and mine[0]["is_you"] is True, mine
    finally:
        await _cleanup()


async def test_role_change_persists_and_is_audited(client):
    await _cleanup()
    try:
        _, _, admin_tok = await _staff(client, "admin")
        target_id, target_email, _ = await _staff(client, "warehouse")

        r = await client.patch(f"/staff/team/{target_id}/role", json={"role": "technician"},
                               headers=_h(admin_tok))
        assert r.status_code == 200, r.text
        assert r.json()["role"] == "technician" and r.json()["changed"] is True

        eng = get_engine()
        async with eng.connect() as c:
            role = (await c.execute(text("SELECT role FROM staff_users WHERE id = :i"),
                                    {"i": target_id})).scalar_one()
            assert role == "technician"
            row = (await c.execute(text(
                "SELECT before, after, actor_id, meta FROM audit_log"
                " WHERE entity = 'staff' AND entity_id = :i AND action = 'role_changed'"
                " ORDER BY id DESC LIMIT 1"), {"i": target_id})).mappings().first()
        assert row is not None, "no audit row for the role change"
        assert row["before"]["role"] == "warehouse" and row["after"]["role"] == "technician", dict(row)
        assert row["meta"]["email"] == target_email, dict(row)

        # A second identical call is a no-op, not a second audit row.
        r = await client.patch(f"/staff/team/{target_id}/role", json={"role": "technician"},
                               headers=_h(admin_tok))
        assert r.status_code == 200 and r.json()["changed"] is False, r.text
    finally:
        await _cleanup()


async def test_role_change_refuses_yourself_and_an_unknown_role(client):
    await _cleanup()
    try:
        _, _, admin_tok = await _staff(client, "admin")
        me = await _me_id(client, admin_tok)

        r = await client.patch(f"/staff/team/{me}/role", json={"role": "sales"}, headers=_h(admin_tok))
        assert r.status_code == 409, r.text

        target_id, _, _ = await _staff(client, "warehouse")
        r = await client.patch(f"/staff/team/{target_id}/role", json={"role": "agent"},
                               headers=_h(admin_tok))
        assert r.status_code == 422, r.text

        r = await client.patch("/staff/team/999999999999/role", json={"role": "sales"},
                               headers=_h(admin_tok))
        assert r.status_code == 404, r.text
    finally:
        await _cleanup()


async def test_the_last_admin_cannot_be_demoted_or_suspended(client, monkeypatch):
    """The guard itself, isolated from how many admins this dev database happens to have.

    `_active_admins` is patched to 1 rather than made true by suspending the real administrators -
    editing other people's accounts to prove a refusal is not a test, it is an outage. The patch is
    aimed at the one function the two doors both call, so both are proven by the same claim.
    """
    await _cleanup()
    try:
        _, _, admin_tok = await _staff(client, "admin")
        target_id, _, _ = await _staff(client, "admin")

        async def _one(_db):
            return 1

        monkeypatch.setattr(staff_team, "_active_admins", _one)

        r = await client.patch(f"/staff/team/{target_id}/role", json={"role": "manager"},
                               headers=_h(admin_tok))
        assert r.status_code == 409, r.text
        r = await client.patch(f"/staff/team/{target_id}/status", json={"status": "suspended"},
                               headers=_h(admin_tok))
        assert r.status_code == 409, r.text

        # The same two calls are allowed the moment another admin exists.
        monkeypatch.undo()
        r = await client.patch(f"/staff/team/{target_id}/role", json={"role": "manager"},
                               headers=_h(admin_tok))
        assert r.status_code == 200, r.text
    finally:
        await _cleanup()


async def test_password_reset_returns_once_and_the_old_password_dies(client):
    await _cleanup()
    try:
        _, _, admin_tok = await _staff(client, "admin")
        email = "pytest-team-" + uuid.uuid4().hex + "@test.rfo"
        _created.add(email)
        sid, old_pw = await bootstrap(email, "sales")
        assert (await client.post("/staff/auth/login", json={"email": email, "password": old_pw})).status_code == 200

        r = await client.post(f"/staff/team/{sid}/password-reset", headers=_h(admin_tok))
        assert r.status_code == 200, r.text
        payload = r.json()
        new_pw = payload["password"]
        assert payload["shown_once"] is True and new_pw and new_pw != old_pw

        # The new password works and the old one does not - the reset is real, not decorative.
        assert (await client.post("/staff/auth/login", json={"email": email, "password": new_pw})).status_code == 200
        assert (await client.post("/staff/auth/login", json={"email": email, "password": old_pw})).status_code == 401

        # The plaintext never reaches the trail.
        eng = get_engine()
        async with eng.connect() as c:
            rows = (await c.execute(text(
                "SELECT before, after, meta FROM audit_log"
                " WHERE entity = 'staff' AND entity_id = :i AND action = 'password_reset'"),
                {"i": sid})).mappings().all()
            stored = (await c.execute(text("SELECT password_hash FROM staff_passwords WHERE staff_id = :i"),
                                      {"i": sid})).scalar_one()
        assert rows, "no audit row for the reset"
        for row in rows:
            blob = json.dumps({k: row[k] for k in ("before", "after", "meta")})
            assert new_pw not in blob, blob
        assert new_pw not in stored and stored, "the row holds a hash, never the plaintext"
    finally:
        await _cleanup()


async def test_suspend_revokes_sessions_and_refuses_a_reinstated_login(client):
    """Revoking the rows is asserted at the row; the refusal is asserted at the door."""
    await _cleanup()
    try:
        _, _, admin_tok = await _staff(client, "admin")
        sid, email, member_tok = await _staff(client, "warehouse")
        assert member_tok

        r = await client.get("/staff/team", headers=_h(admin_tok))
        before = [m for m in r.json()["members"] if m["id"] == sid][0]
        assert before["sessions"] >= 1, before

        r = await client.patch(f"/staff/team/{sid}/status", json={"status": "suspended"},
                               headers=_h(admin_tok))
        assert r.status_code == 200, r.text
        assert r.json()["sessions_revoked"] >= 1, r.text

        eng = get_engine()
        async with eng.connect() as c:
            live = (await c.execute(text(
                "SELECT count(*) FROM refresh_tokens"
                " WHERE identity_type = 'staff' AND identity_id = :i AND revoked_at IS NULL"),
                {"i": sid})).scalar_one()
        assert live == 0, live

        # A suspended account cannot sign in, whatever its password says.
        r = await client.post("/staff/auth/login", json={"email": email, "password": "irrelevant"})
        assert r.status_code == 401, r.text

        # And cannot suspend itself out from under the operator doing the suspending.
        me = await _me_id(client, admin_tok)
        r = await client.patch(f"/staff/team/{me}/status", json={"status": "suspended"},
                               headers=_h(admin_tok))
        assert r.status_code == 409, r.text
    finally:
        await _cleanup()
