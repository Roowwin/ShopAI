"""The two kill switches and the grant ledger's surface (ADR 0008 decisions 2, 3, 6 and 10;
Preconditions 4 and 6).

Three things are proven here, and they are the three that decide whether autonomy can run at all:

* **the env switch** (`AI_AUTONOMY`, decision 6's outer switch) gates the agent execute path and
  nothing else. Off - which is the shipped state, since the variable is absent - an execute turn
  comes back as a PROPOSAL for a human Confirm, and the SAME proposal still runs when the switch is
  turned on, because a paused turn is not a spent one. The staff human-Confirm path never reads it.
* **the grants surface** is admin-only, audited, and cannot be talked into anything: the action
  class is derived server-side (a body that names one is ignored - there is no field for it), the
  grantable set is the rail's own, and a grant arrives DISABLED so arming it is a second act.
* **the promotion guards** (Precondition 4) now sit in the body of the six CMS/product writes that
  had only a route `Depends`, so a plain-function dispatch cannot skip them - and because their
  action names are deliberately absent from `GUARDED_ACTIONS`, an agent identity is refused there
  by the grant branch before it can reach a grant row.

MEASUREMENT (Precondition 8 - the overview audit feed's `actor_type` filter). EXPLAIN (ANALYZE,
BUFFERS) of `staff_overview`'s feed query against the dev ledger, with agent rows present - inserted
inside a rolled-back transaction, so the append-only ledger is untouched: 15,904 rows / 28 agent ->
Index Scan on `audit_at_idx` + Filter, 0.026 ms, 3 buffers; +2,000 agent rows -> same plan, 0.036 ms,
4 buffers, and with a partial `(at DESC) WHERE actor_type IN ('staff','agent','system')` index
available the planner uses it for 0.034 ms - a buffer saving, not a time one; +60,000 customer rows
(22.7% of rows wanted) -> 0.048 ms / 42 buffers without that index vs 0.029 ms / 4 with it; +300,000
customer rows (5.9% wanted) -> 0.048 ms / 43 buffers vs 0.030 ms. The ADR's premise - that a
*selective* `actor_type` filter makes the planner abandon `audit_at_idx` for a seq scan plus sort -
did NOT reproduce at any tested selectivity: the feed is `ORDER BY at DESC LIMIT 20`, so the index
walks the newest entries and stops at twenty. DECISION: no index and no migration. The trigger to
revisit is a change of query SHAPE (a time window or an entity/action predicate - what the sibling
`team_activity` statement has, and why that one IS a seq scan), not growth. Recorded here because
`staff_overview.py`, the statement's own home, is outside this job's allowed surfaces.

The identities, staged stock, mock model and the `_CREATED` registry this file cleans up are
imported from tests/test_autonomy_execute.py - one teardown, so a grant created here through the API
is deleted by the id the API returned, and nothing is left enabled in the shared dev DB.
"""
import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import text

from app.api.v1 import staff_ai, staff_ops
from app.api.v1.staff_ops import ProductIn, ProductListingIn
from app.core.db import get_engine
from tests.test_agent_identity import _staff
from tests.test_autonomy_execute import (  # noqa: F401 - fake_model/_cloud_configured are FIXTURES
    _CREATED, _agent, _cleanup, _counts, _execute, _propose, _stage_units, _status, _cloud_configured,
    fake_model)

# ---------------------------------------------------------------- helpers


async def _grant_via_api(client, admin, agent_id: int, action: str, daily_cap: int,
                         enabled: bool = False) -> dict:
    """Create a grant through the SURFACE (not by SQL), optionally arming it.

    The id is registered in the imported cleanup's registry, so the row is deleted by the same
    teardown that deletes the identity - an enabled grant left behind in the shared dev DB is the
    one thing this job must not do.
    """
    r = await client.post("/staff/agents/" + str(agent_id) + "/grants", headers=admin,
                          json={"action": action, "daily_cap": daily_cap})
    assert r.status_code == 201, r.text
    g = r.json()
    _CREATED["grants"].append(g["id"])
    if enabled:
        r = await client.patch("/staff/agents/" + str(g["id"]), headers=admin, json={"enabled": True})
        assert r.status_code == 200, r.text
        g = r.json()
        assert g["enabled"] is True
    return g


async def _grants_panel(client, admin, agent_id: int) -> dict:
    r = await client.get("/staff/agents/" + str(agent_id) + "/grants", headers=admin)
    assert r.status_code == 200, r.text
    return r.json()


async def _agent_bearer(client, admin) -> dict:
    """A bearer for a freshly minted agent identity - to show the grants surface is not its door."""
    from tests.test_agent_identity import _mint
    aid, tok = await _mint(client, admin, "hermes-grant-probe")
    _CREATED["agents"].append(aid)
    return {"Authorization": "Bearer " + tok}


@pytest_asyncio.fixture(autouse=True)
async def _clean_grant_surface(_cloud_configured, client):
    """Same teardown, same registry as the execute file (see the module docstring)."""
    await _cleanup()
    yield
    await _cleanup()


# ---------------------------------------------------------------- the env switch (deliverable 1)

def test_the_switch_reads_only_an_explicit_truthy_spelling(monkeypatch):
    """Absent is off, and a value nobody meant is off too - the switch cannot be armed by a typo."""
    for value, expected in (("", False), ("false", False), ("0", False), ("no", False), ("off", False),
                            ("true", True), ("TRUE", True), ("1", True), ("yes", True), ("on", True)):
        monkeypatch.setenv("AI_AUTONOMY", value)
        assert staff_ai._autonomy_enabled() is expected, value
    monkeypatch.delenv("AI_AUTONOMY", raising=False)
    assert staff_ai._autonomy_enabled() is False, "the shipped state is an absent variable"


async def test_the_switch_off_degrades_every_execute_turn_to_a_proposal(client, fake_model, monkeypatch):
    """Off: propose, and the proposal is NOT spent - flipping the switch on runs the same turn.

    The grant is ENABLED throughout this test, so the only thing holding the execution back is the
    switch: with the grant's own flag on and the env switch off, decision 6's "both must be on" is
    what is being pinned. Nothing is written and the record is left unconsumed, which is why the
    second half can execute the very same proposal.
    """
    monkeypatch.delenv("AI_AUTONOMY", raising=False)
    admin = await _staff(client, "admin")
    agent_id, agent = await _agent(client, admin, "hermes-switch-off")
    await _grant_via_api(client, admin, agent_id, "list", daily_cap=5, enabled=True)
    _, ids, serials = await _stage_units(client, admin)

    fake_model("list", {"serial_number": serials[0]})
    prop = await _propose(client, agent)

    before = await _counts()
    r = await _execute(client, agent, prop["proposal_id"])
    assert r.status_code == 200, r.text
    assert r.json()["type"] == "proposed", r.json()
    assert r.json()["proposal_id"] == prop["proposal_id"], r.json()
    assert await _counts() == before, "a switch-off turn must write nothing"
    assert await _status(ids[0]) == "graded"

    monkeypatch.setenv("AI_AUTONOMY", "true")
    r = await _execute(client, agent, prop["proposal_id"])
    assert r.status_code == 200, r.text
    assert r.json()["type"] == "executed", r.json()
    assert await _status(ids[0]) == "listed"


async def test_the_switch_does_not_gate_the_staff_confirm_path(client, monkeypatch):
    """The switch is a switch on AUTONOMY, not on the rail: a human Confirm lands with it off."""
    monkeypatch.delenv("AI_AUTONOMY", raising=False)
    admin = await _staff(client, "admin")
    _, ids, serials = await _stage_units(client, admin)

    r = await client.post("/staff/ai/chat", headers=admin, json={
        "message": "list " + serials[0], "execute": True, "action": "list",
        "args": {"serial_number": serials[0]}})
    assert r.status_code == 200, r.text
    assert r.json()["type"] == "executed", r.json()
    assert await _status(ids[0]) == "listed"


# ---------------------------------------------------------------- the grants surface

async def test_the_grants_surface_is_admin_only_and_needs_a_credential(client):
    """401 without one, 403 for every other role, 200 for an admin - on all four verbs."""
    admin = await _staff(client, "admin")
    agent_id, _ = await _agent(client, admin, "hermes-grant-walls")
    gid = (await _grant_via_api(client, admin, agent_id, "list", daily_cap=2))["id"]
    probes = (("GET", "/staff/agents/" + str(agent_id) + "/grants", None),
              ("POST", "/staff/agents/" + str(agent_id) + "/grants", {"action": "grade", "daily_cap": 2}),
              ("PATCH", "/staff/agents/" + str(gid), {"enabled": True}),
              ("DELETE", "/staff/agents/" + str(gid), None))
    for method, path, payload in probes:
        assert (await client.request(method, path, json=payload)).status_code == 401, (method, path)
    for role in ("manager", "warehouse", "technician", "sales"):
        other = await _staff(client, role)
        for method, path, payload in probes:
            r = await client.request(method, path, json=payload, headers=other)
            assert r.status_code == 403, (role, method, path, r.status_code)
    # the wall is the role, not the route: an agent bearer is not a staff credential at all, and an
    # admin reads the panel
    assert (await client.get("/staff/agents/" + str(agent_id) + "/grants",
                             headers=await _agent_bearer(client, admin))).status_code == 401
    assert (await _grants_panel(client, admin, agent_id))["agent_id"] == agent_id


async def test_action_class_is_derived_server_side_and_a_body_cannot_name_one(client):
    """`list`/`price` are outward because they reach the storefront; everything else is inventory.

    A body that carries `action_class` is ignored rather than rejected: the field does not exist on
    the model, so there is nothing for a client to argue with - and the tests assert against the
    stored row as well as the response, because a class echoed back would still be wrong if the
    write had trusted the body.
    """
    admin = await _staff(client, "admin")
    agent_id, _ = await _agent(client, admin, "hermes-class")
    for action, claimed, expected in (("list", "inventory", "outward"),
                                      ("price", "inventory", "outward"),
                                      ("grade", "outward", "inventory")):
        r = await client.post("/staff/agents/" + str(agent_id) + "/grants", headers=admin,
                              json={"action": action, "daily_cap": 2, "action_class": claimed})
        assert r.status_code == 201, r.text
        _CREATED["grants"].append(r.json()["id"])
        assert r.json()["action_class"] == expected, (action, r.json())
    eng = get_engine()
    async with eng.connect() as c:
        stored = dict((await c.execute(text(
            "SELECT action, action_class FROM autonomy_grants WHERE identity_type = 'agent'"
            " AND identity_id = :i"), {"i": agent_id})).all())
    assert stored == {"list": "outward", "price": "outward", "grade": "inventory"}, stored


async def test_the_surface_refuses_what_it_cannot_grant(client):
    """422 for an action the rail cannot dispatch or a cap outside bounds; 404/409 for the rest."""
    admin = await _staff(client, "admin")
    agent_id, _ = await _agent(client, admin, "hermes-refusals")
    base = "/staff/agents/" + str(agent_id) + "/grants"
    # an action no door performs: the closure obligation, in the surface
    r = await client.post(base, headers=admin, json={"action": "cms_put_home", "daily_cap": 2})
    assert r.status_code == 422, r.text
    # caps are bounded on the schema, so an absurd cap never reaches the table
    for cap in (0, 101, -1):
        assert (await client.post(base, headers=admin,
                                  json={"action": "list", "daily_cap": cap})).status_code == 422, cap
    # a grant for an identity that does not exist
    r = await client.post("/staff/agents/999999999/grants", headers=admin,
                          json={"action": "list", "daily_cap": 2})
    assert r.status_code == 404, r.text
    # one grant per (identity, action) - the table's UNIQUE triple, surfaced as a 409 not a 500
    g = await _grant_via_api(client, admin, agent_id, "list", daily_cap=2)
    r = await client.post(base, headers=admin, json={"action": "list", "daily_cap": 3})
    assert r.status_code == 409, r.text
    # unknown grant ids, and a patch that changes nothing
    assert (await client.patch("/staff/agents/999999999", headers=admin,
                               json={"enabled": True})).status_code == 404
    assert (await client.delete("/staff/agents/999999999", headers=admin)).status_code == 404
    assert (await client.patch("/staff/agents/" + str(g["id"]), headers=admin,
                               json={})).status_code == 422


async def test_a_grant_arrives_disabled_and_arming_it_takes_a_second_act(client, fake_model, monkeypatch):
    """The whole chain, through the surface: create -> still proposes; enable -> executes.

    This is also the usage readback: after the execution `used_today` is the counter the gate
    reserved, read back through the panel, and the two numbers cannot disagree because they are the
    same Redis key.
    """
    monkeypatch.setenv("AI_AUTONOMY", "true")
    admin = await _staff(client, "admin")
    agent_id, agent = await _agent(client, admin, "hermes-two-acts")
    _, ids, serials = await _stage_units(client, admin, count=2)

    g = await _grant_via_api(client, admin, agent_id, "list", daily_cap=2)
    assert g["enabled"] is False, "creating a grant records an intention; arming it is separate"

    fake_model("list", {"serial_number": serials[0]})
    first = await _propose(client, agent)
    before = await _counts()
    r = await _execute(client, agent, first["proposal_id"])
    assert r.json()["type"] == "proposed", r.json()
    assert await _counts() == before
    assert (await _grants_panel(client, admin, agent_id))["grants"][0]["used_today"] == 0

    r = await client.patch("/staff/agents/" + str(g["id"]), headers=admin, json={"enabled": True})
    assert r.status_code == 200 and r.json()["enabled"] is True, r.text
    r = await _execute(client, agent, first["proposal_id"])
    assert r.status_code == 200 and r.json()["type"] == "executed", r.text
    assert await _status(ids[0]) == "listed"

    panel = (await _grants_panel(client, admin, agent_id))["grants"][0]
    assert panel["used_today"] == 1 and panel["remaining_today"] == 1, panel
    assert panel["daily_cap"] == 2 and panel["action_class"] == "outward", panel

    # a re-cap is a PATCH too, and it lands
    r = await client.patch("/staff/agents/" + str(g["id"]), headers=admin, json={"daily_cap": 7})
    assert r.status_code == 200 and r.json()["daily_cap"] == 7, r.text


async def test_a_grant_authorises_one_identity_and_revoking_it_stops_the_next_turn(client, fake_model, monkeypatch):
    """A grant is (identity, action): another agent's grant does not authorise this one - and
    revoking gates the FUTURE, which is what decision 10 tells operators to expect."""
    monkeypatch.setenv("AI_AUTONOMY", "true")
    admin = await _staff(client, "admin")
    owner_id, owner = await _agent(client, admin, "hermes-revocable")
    other_id, other = await _agent(client, admin, "hermes-unrelated")
    g = await _grant_via_api(client, admin, other_id, "list", daily_cap=5, enabled=True)
    _, ids, serials = await _stage_units(client, admin, count=2)

    fake_model("list", {"serial_number": serials[0]})
    prop = await _propose(client, owner)
    before = await _counts()
    r = await _execute(client, owner, prop["proposal_id"])
    assert r.json()["type"] == "proposed", r.json()
    assert await _counts() == before, "another identity's grant must not authorise this one"

    # give the OWNER the grant, execute, then revoke it and try again on a fresh unit
    own = await _grant_via_api(client, admin, owner_id, "list", daily_cap=5, enabled=True)
    fake_model("list", {"serial_number": serials[1]})
    second = await _propose(client, owner)
    r = await _execute(client, owner, second["proposal_id"])
    assert r.json()["type"] == "executed", r.json()
    assert await _status(ids[1]) == "listed"

    r = await client.delete("/staff/agents/" + str(own["id"]), headers=admin)
    assert r.status_code == 200 and r.json()["revoked"] is True, r.text
    assert "not undone" in r.json()["note"], r.json()
    assert await _status(ids[1]) == "listed", "revocation is not recall (decision 10)"

    third = await _propose(client, owner)
    before = await _counts()
    r = await _execute(client, owner, third["proposal_id"])
    assert r.json()["type"] == "proposed", r.json()
    assert await _counts() == before, "a revoked grant must stop the next execution"
    assert (await _grants_panel(client, admin, owner_id))["grants"] == []


async def test_the_grants_surface_is_audited(client):
    """Create, update and revoke each leave a staff audit row naming the grant - decisions 2 and 6
    make the ledger the authority, so who changed it is part of the record."""
    admin = await _staff(client, "admin")
    agent_id, _ = await _agent(client, admin, "hermes-audited")
    eng = get_engine()

    async def rows(gid: int) -> list[tuple]:
        async with eng.connect() as c:
            return (await c.execute(text(
                "SELECT action, actor_type FROM audit_log WHERE entity = 'agent' AND entity_id = :i"
                " ORDER BY id"), {"i": gid})).all()

    g = await _grant_via_api(client, admin, agent_id, "list", daily_cap=2)
    await client.patch("/staff/agents/" + str(g["id"]), headers=admin, json={"enabled": True})
    await client.delete("/staff/agents/" + str(g["id"]), headers=admin)
    got = await rows(g["id"])
    assert got == [("grant_create", "staff"), ("grant_updated", "staff"), ("grant_revoked", "staff")], got


# ---------------------------------------------------------------- the promotion guards (deliverable 3)

# (roles tuple, action name, a role the tuple admits, a role it does not)
PROMOTED = (
    (staff_ops.ROLES_CMS, staff_ops.ACTION_CMS_PUT_HOME, "manager", "warehouse"),
    (staff_ops.ROLES_CMS, staff_ops.ACTION_CMS_EDIT_PRODUCT, "manager", "sales"),
    (staff_ops.ROLES_CMS, staff_ops.ACTION_CMS_ADD_PROMOTION, "manager", "sales"),
    (staff_ops.ROLES_CMS, staff_ops.ACTION_CMS_EDIT_PROMOTION, "manager", "warehouse"),
    (staff_ops.ROLES_APPROVE_LISTING, staff_ops.ACTION_APPROVE_LISTING, "sales", "warehouse"),
    (staff_ops.ROLES_CREATE_PRODUCT, staff_ops.ACTION_CREATE_PRODUCT, "manager", "sales"),
)


def test_the_promotion_action_names_are_not_grantable():
    """Precondition 4's design, pinned: these paths are ROLE-ONLY.

    Each name is absent from `GUARDED_ACTIONS`, so `_require_role`'s grant branch refuses an agent
    identity before it reads anything - a grant can never authorise a path the rail cannot
    dispatch. If a later job promotes one of these into the rail, this test is the reminder that it
    needs a name in `GUARDED_ACTIONS` (and a `TOOL_ROLES` entry) at the same time.
    """
    for _roles, action, _ok, _bad in PROMOTED:
        assert action not in staff_ops.GUARDED_ACTIONS, action
        assert action not in staff_ai.TOOL_ROLES, action


async def test_the_promotion_guards_hold_however_the_handler_is_called():
    """Role-only, in the body: a permitted role passes, a wrong one is refused, and an AGENT is
    refused by the grant branch without a session (`None`), which is the whole of the design."""
    for roles, action, ok_role, bad_role in PROMOTED:
        assert await staff_ops._require_role({"id": 1, "role": ok_role}, roles, action, None) is None
        with pytest.raises(HTTPException) as ei:
            await staff_ops._require_role({"id": 1, "role": bad_role}, roles, action, None)
        assert ei.value.status_code == 403, (action, bad_role)
        with pytest.raises(HTTPException) as ei:
            await staff_ops._require_role({"id": 0, "role": "agent", "identity_type": "agent",
                                          "identity_id": 5}, roles, action, None)
        assert ei.value.status_code == 403, action


async def test_the_promoted_handlers_refuse_a_wrong_role_in_their_own_body():
    """Called the way a plain-function dispatch would call them - no FastAPI, no session - the six
    still refuse, which is the property `Depends` cannot provide on that path."""
    calls = (
        (staff_ops.cms_put_home, ({"hero_title": "pytest"},), {"id": 1, "role": "warehouse"}),
        (staff_ops.cms_add_promotion, ({"name": "pytest", "kind": "percent", "value": 5},), {"id": 1, "role": "sales"}),
        (staff_ops.cms_edit_promotion, (1, {"name": "pytest"},), {"id": 1, "role": "warehouse"}),
        (staff_ops.cms_edit_product, (1, {"title": "pytest"},), {"id": 1, "role": "sales"}),
        (staff_ops.approve_listing, (1, ProductListingIn(title="pytest", description="pytest")), {"id": 1, "role": "warehouse"}),
        (staff_ops.create_product, (ProductIn(brand_slug="b", category_slug="c", model="m", title="t"),), {"id": 1, "role": "sales"}),
    )
    for handler, args, staff in calls:
        with pytest.raises(HTTPException) as ei:
            await handler(*args, staff, None)
        assert ei.value.status_code == 403, handler.__name__


async def test_the_promoted_handlers_keep_their_http_walls(client):
    """And the doors themselves are unchanged: 401 without a credential, 403 for a wrong role.

    Deliberately asserted on the WALLS rather than on a successful write: proving the guard lets a
    permitted role through is `test_the_promotion_guards_hold_however_the_handler_is_called`'s first
    assertion, and a successful CMS write here would edit real site content for no extra evidence.
    """
    warehouse = await _staff(client, "warehouse")
    probes = (
        ("PUT", "/staff/cms/home", {"hero_title": "pytest"}),
        ("PATCH", "/staff/cms/products/1", {"title": "pytest"}),
        ("POST", "/staff/cms/promotions", {"name": "pytest", "kind": "percent", "value": 5}),
        ("PATCH", "/staff/cms/promotions/1", {"name": "pytest"}),
        ("POST", "/staff/products/1/listing", {"title": "pytest", "description": "pytest"}),
        ("POST", "/staff/products", {"brand_slug": "b", "category_slug": "c", "model": "m", "title": "t"}),
    )
    for method, path, payload in probes:
        assert (await client.request(method, path, json=payload)).status_code == 401, (method, path)
        r = await client.request(method, path, json=payload, headers=warehouse)
        assert r.status_code == 403, (method, path, r.status_code)
