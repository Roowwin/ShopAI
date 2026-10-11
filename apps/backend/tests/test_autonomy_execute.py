"""Persisted proposals and the grant-gated agent execute path - ADR 0008 preconditions 1+2,
decisions 4, 7, 8 and 9.

Every test here builds its own fixture grant by SQL, because no production path can: the grants
surface is a later job and `enabled` defaults false, so an agent is propose-only in every deployed
environment and this file is the only place the machinery runs at all. The identity is a real agent
token minted through the admin door, the stock is real stock staged through the staff doors, and
the model is FAKED (`fake_model`) - a proposal is a decision, and a test that needs a specific action
must not depend on which way a live model answers.

What each test is really pinning:

* the execute turn carries a `proposal_id` and no action/args - a substitution is a 422, because the
  record is the only thing that may decide what runs (decision 8);
* a proposal is identity-scoped and single-use - another agent's id is refused, and a consumed one
  cannot be replayed;
* absent a grant and over a cap the turn comes back as a PROPOSAL, never a refusal and never a
  silent drop, and writes nothing (decisions 1 and 4);
* the deciding model rides with the record, so the fallback guard holds across a worker change,
  where the old process-local dict silently passed (decision 7) - the test deletes that dict to
  simulate the change and proves the refusal survives it;
* a granted execution writes exactly one asset change and exactly one audit row, marked
  actor_type='agent' with meta.autonomy (decision 5);
* a failure that provably wrote nothing refunds the cap unit, so a transient error cannot spend a
  day's budget (decision 4, and the rehearsal's "a failed first attempt is refunded").
"""
import uuid

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import text

from app.api.v1 import staff_ai, staff_ops
from app.api.v1.staff_ops import StatusIn
from app.core.db import get_engine
from app.core.redis import get_redis
from tests.test_agent_identity import _mint, _staff


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


# ---------------------------------------------------------------- fixtures

# What this module created and must therefore remove. Redis keys are deleted by exact name (never
# by deleting another run's keys), rows by id - a grant has no foreign key to its identity, so a
# sibling file's `DELETE FROM staff_users` cannot sweep one away and leaving it behind would leave
# an ENABLED row in the shared dev DB, which is the one thing this job must not do.
_CREATED: dict[str, list] = {"agents": [], "proposals": [], "grants": []}


async def _cleanup():
    eng = get_engine()
    async with eng.begin() as c:
        for gid in _CREATED["grants"]:
            await c.execute(text("DELETE FROM autonomy_grants WHERE id = :i"), {"i": gid})
        await c.execute(text("DELETE FROM agent_tokens WHERE staff_id IN "
                             "(SELECT id FROM staff_users WHERE email LIKE 'pytest-%')"))
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                             "(SELECT id FROM staff_users WHERE email LIKE 'pytest-%')"))
        await c.execute(text("DELETE FROM staff_users WHERE email LIKE 'pytest-%'"))
        await c.execute(text("DELETE FROM users WHERE email LIKE 'pytest-%'"))
    r = get_redis()
    for pid in _CREATED["proposals"]:
        await r.delete(staff_ai._PROPOSAL + pid)
    for aid in _CREATED["agents"]:
        keys = [k async for k in r.scan_iter(match="autonomy:agent:" + str(aid) + ":*")]
        if keys:
            await r.delete(*keys)
    _CREATED["agents"].clear()
    _CREATED["proposals"].clear()
    _CREATED["grants"].clear()


@pytest_asyncio.fixture(autouse=True)
async def _clean_autonomy(client):
    """Depends on `client` so teardown runs while the loop and the engine are still alive."""
    await _cleanup()
    yield
    await _cleanup()


@pytest.fixture(autouse=True)
def _cloud_configured(monkeypatch):
    """A cloud text model IS configured for every test in this file.

    Two reasons, and both matter: `decided_by` is only distinguishable from the fallback model when
    the cloud model is configured at all, and the tests must not change meaning depending on what
    the developer's .env happens to hold. No call is ever placed - the model is faked - so pointing
    the endpoint at an unroutable host is safe.
    """
    monkeypatch.setenv("AI_CLOUD_ENDPOINT", "https://pytest.invalid")
    monkeypatch.setenv("AI_CLOUD_API_KEY", "pytest-key")
    monkeypatch.setenv("AI_CLOUD_TEXT_MODEL", "pytest-cloud-text")


@pytest.fixture
def fake_model(monkeypatch):
    """Install a model that always decides `action` with `args`, recording where it "ran".

    `via` is what `_deciding_model` reads immediately after the call: "cloud" for an ordinary
    decision on the primary model, "local" for the fallback - the two cases decision 7 separates.
    """
    def _install(action: str, args: dict, via: str = "cloud"):
        async def _fake(*_a, **_k):
            staff_ai.ai_svc.LAST_VIA["via"] = via
            return {"action": action, "args": args}
        monkeypatch.setattr(staff_ai, "ai_json", _fake)
    return _install


async def _agent(client, admin, name: str) -> tuple[int, dict]:
    aid, tok = await _mint(client, admin, name)
    _CREATED["agents"].append(aid)
    return aid, _h(tok)


async def _grant(agent_id: int, action: str, daily_cap: int, action_class: str = "outward") -> int:
    """The fixture grant. Written straight to the table: no endpoint can create one (that is a
    later job), which is exactly why this file has to."""
    eng = get_engine()
    async with eng.begin() as c:
        gid = (await c.execute(text(
            "INSERT INTO autonomy_grants (identity_type, identity_id, action, action_class, daily_cap, enabled)"
            " VALUES ('agent', :i, :a, :c, :cap, true) RETURNING id"),
            {"i": agent_id, "a": action, "c": action_class, "cap": daily_cap})).scalar_one()
    _CREATED["grants"].append(gid)
    return gid


async def _received_units(client, admin, count: int) -> tuple[int, list[tuple[int, str]]]:
    """A fresh lot with `count` received units in it, built through the staff doors.

    Units are returned as (asset_id, serial). Nothing here is hand-seeded: every row is created by
    the same endpoints a warehouse user clicks, so a `list` proposal against one of them is a write
    that would really land.
    """
    r = await client.post("/staff/lots", json={"warehouse": "WH-A", "notes": "pytest autonomy"},
                          headers=admin)
    assert r.status_code == 201, r.text
    lot = r.json()
    units: list[tuple[int, str]] = []
    for _ in range(count):
        sn = "pytest-auto-" + uuid.uuid4().hex[:12]
        r = await client.post("/staff/assets/scan-in",
                              json={"lot_number": lot["lot_number"], "serial_number": sn},
                              headers=admin)
        assert r.status_code == 201, r.text
        units.append((r.json()["id"], sn))
    return lot["id"], units


async def _advance_to_graded_and_priced(client, admin, asset_id: int) -> None:
    """received -> tested -> graded, and priced: `chk_listed_has_price` means an unpriced unit
    cannot be listed at all, so without this a `list` would be refused by the schema rather than
    performed."""
    for path, body in ((f"/staff/assets/{asset_id}/status", {"status": "tested"}),
                       (f"/staff/assets/{asset_id}/grade", {"grade": "A"}),
                       (f"/staff/assets/{asset_id}/price", {"sale_price_cents": 21900})):
        assert (await client.post(path, json=body, headers=admin)).status_code == 200


async def _stage_units(client, admin, count: int = 1) -> tuple[int, list[int], list[str]]:
    """A fresh lot holding `count` graded, graded-priced, ACTIVE units.

    The activation is last on purpose: the lot trigger completes a lot with no listed units, so
    `create -> scan_in` leaves it completed and only `activate` puts it back. Returns
    (lot_id, asset_ids, serials).
    """
    lot_id, units = await _received_units(client, admin, count)
    for aid, _sn in units:
        await _advance_to_graded_and_priced(client, admin, aid)
    assert (await client.post(f"/staff/lots/{lot_id}/activate", headers=admin)).status_code == 200
    return lot_id, [a for a, _s in units], [s for _a, s in units]


async def _propose(client, headers) -> dict:
    """One propose turn on the agent door, returning the payload it answered with - which now
    carries the `proposal_id` of the record the server just persisted."""
    r = await client.post("/staff/agents/chat", json={"message": "pytest autonomy propose"}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json().get("type") == "proposed", r.json()
    pid = r.json().get("proposal_id")
    assert pid, r.json()
    _CREATED["proposals"].append(pid)
    return r.json()


async def _execute(client, headers, pid: str):
    return await client.post("/staff/agents/chat",
                             json={"message": "run it", "execute": True, "proposal_id": pid},
                             headers=headers)


async def _counts() -> tuple[int, int, int]:
    """(assets, audit_log, stock_movements) - the row counts a stray write would move."""
    eng = get_engine()
    async with eng.connect() as c:
        return ((await c.execute(text("SELECT count(*) FROM assets"))).scalar_one(),
                (await c.execute(text("SELECT count(*) FROM audit_log"))).scalar_one(),
                (await c.execute(text("SELECT count(*) FROM stock_movements"))).scalar_one())


async def _status(asset_id: int) -> str:
    eng = get_engine()
    async with eng.connect() as c:
        return (await c.execute(text("SELECT status FROM assets WHERE id = :i"),
                                {"i": asset_id})).scalar_one()


async def _record(pid: str) -> dict:
    return await staff_ai._proposal_load(get_redis(), pid)


# ---------------------------------------------------------------- the staff rail is untouched

async def test_the_staff_confirm_path_still_executes_the_action_it_names(client):
    """The human Confirm is UNCHANGED, and this is the test that says so out loud.

    New machinery sits behind the same dispatch, so the risk this job carries into production is not
    that an agent writes too much - it is that a human writes nothing. The staff door executes the
    action and args the client confirms, exactly as before, and its audit row is the ordinary staff
    row: `actor_type='staff'`, `actor_id` a staff id and no `meta.autonomy` anywhere near it.
    (Nothing in the staff path reads a proposal, and the staff branch never consults a grant - a
    staff grant is not creatable by this job.)
    """
    admin = await _staff(client, "admin")
    _, ids, serials = await _stage_units(client, admin, count=2)

    r = await client.post("/staff/ai/chat", headers=admin, json={
        "message": "list " + serials[0], "execute": True, "action": "list",
        "args": {"serial_number": serials[0]}})
    assert r.status_code == 200, r.text
    assert r.json() == {"type": "executed", "action": "list", "results": [{"action": "list", "asset_id": ids[0]}]}, r.json()
    assert await _status(ids[0]) == "listed"
    assert await _status(ids[1]) == "graded"

    eng = get_engine()
    async with eng.connect() as c:
        row = (await c.execute(text(
            "SELECT actor_type, actor_id, meta, before, after FROM audit_log"
            " WHERE entity = 'asset' AND entity_id = :i ORDER BY id DESC LIMIT 1"), {"i": ids[0]})).mappings().one()
    assert row["actor_type"] == "staff" and row["actor_id"] is not None, dict(row)
    assert row["meta"] is None, "a human execution carries no autonomy marker"
    assert row["before"] == {"status": "graded"} and row["after"]["status"] == "listed", dict(row)


async def test_a_proposal_whose_args_cannot_be_validated_is_an_answer_not_a_dead_proposal(client, fake_model):
    """The record holds args the execute path can run, or there is no record (Precondition 2).

    A proposal that could only ever 422 at execution would be worse than no proposal: it is an
    invitation to a Confirm that cannot land. So the model's args go through the handlers' own input
    models before anything is persisted, and a failure comes back as an answer to the human.
    """
    admin = await _staff(client, "admin")
    _, ids, serials = await _stage_units(client, admin)

    fake_model("price", {"serial_number": serials[0], "sale_price_cents": "not-a-number"})
    r = await client.post("/staff/ai/chat", json={"message": "price it at whatever"}, headers=admin)
    assert r.status_code == 200, r.text
    assert r.json().get("type") == "answer", r.json()
    assert "proposal_id" not in r.json(), r.json()
    assert await _status(ids[0]) == "graded"


# ---------------------------------------------------------------- the in-body guard itself

async def test_the_in_body_guard_admits_an_agent_only_with_an_enabled_grant_for_that_action():
    """Decision 9's guard, probed directly - no request, no role, a real session.

    The chat door calls these handlers as PLAIN FUNCTIONS, so this in-body check is the one that
    actually runs on that path: whatever the gate above decided, a dispatch into `staff_ops` is
    refused here unless the grant row says otherwise. Two legs, both refused, in one rolled-back
    transaction: an action with no grant at all (`test`), and an action whose grant exists but is
    DISABLED (`list`) - which is why `enabled` is in the WHERE clause and not in Python. A grant for
    a third action exists throughout, so neither refusal is just "there are no grants".

    The positive leg is not probed here (it needs a real ORM session, and this file's point is the
    refusal): it is proven end to end by the granted execution above, where an identity whose role
    admits NOTHING gets past this guard and writes.
    """
    eng = get_engine()
    identity = 987654321          # no such agent row - the guard only needs the id it is given
    agent = {"id": 0, "email": "pytest-agent@test.rfo", "role": "agent",
             "identity_type": "agent", "identity_id": identity}
    async with eng.connect() as c:
        for action, action_class, enabled in (("grade", "inventory", True), ("list", "outward", False)):
            await c.execute(text(
                "INSERT INTO autonomy_grants (identity_type, identity_id, action, action_class, daily_cap, enabled)"
                " VALUES ('agent', :i, :a, :c, 1, :e)"),
                {"i": identity, "a": action, "c": action_class, "e": enabled})
        for status in ("tested", "listed"):
            with pytest.raises(HTTPException) as ei:
                await staff_ops.set_status(1, StatusIn(status=status), agent, c)
            assert ei.value.status_code == 403, (status, ei.value.detail)
        await c.rollback()


# ---------------------------------------------------------------- the turn's shape

async def test_an_agent_execute_turn_must_name_a_proposal(client):
    """No proposal id: 422. An action/args echo instead of one: 422. And either way, no write.

    This is the substitution door being closed (decision 8). Before this job the agent door
    answered every execute turn with a 403 "propose-only"; now the door is open to an execution that
    a grant authorises, so the turn's SHAPE carries the security: the client cannot name an action,
    because the action comes from the record.
    """
    admin = await _staff(client, "admin")
    _, agent = await _agent(client, admin, "hermes-shape")
    _, ids, serials = await _stage_units(client, admin)

    before = await _counts()
    r = await client.post("/staff/agents/chat", json={"message": "list " + serials[0], "execute": True},
                          headers=agent)
    assert r.status_code == 422, r.text
    r = await client.post("/staff/agents/chat", headers=agent, json={
        "message": "list " + serials[0], "execute": True, "action": "list",
        "args": {"serial_number": serials[0]}})
    assert r.status_code == 422, r.text
    assert "proposal" in r.json()["detail"], r.text
    assert await _counts() == before, "a refused execute turn must write nothing"
    assert await _status(ids[0]) == "graded"


async def test_a_granted_execution_writes_exactly_one_asset_and_one_agent_audit_row(client, fake_model):
    """The rehearsal's core assertion, on the agent door: one asset, one audit row, right actor.

    The audit row is the mutation row a human Confirm writes, with `actor_type='agent'` and
    `meta.autonomy = {grant_id, identity}` (decision 5) - and `actor_id` is the AGENT's id, not the
    sponsoring admin's: `staff_overview` reads `actor_type='staff'` precisely because actor_id is a
    staff_users id only for staff rows, and filing an autonomous publish under the sponsor is the
    misattribution ADR 0008 exists to make visible. The second unit in the lot is staged so that
    "exactly one" is a real count and not a lone witness.
    """
    admin = await _staff(client, "admin")
    agent_id, agent = await _agent(client, admin, "hermes-granted")
    gid = await _grant(agent_id, "list", daily_cap=5)
    _, ids, serials = await _stage_units(client, admin, count=2)

    fake_model("list", {"serial_number": serials[0]})
    prop = await _propose(client, agent)

    before = await _counts()
    r = await _execute(client, agent, prop["proposal_id"])
    assert r.status_code == 200, r.text
    assert r.json() == {"type": "executed", "action": "list", "results": [{"action": "list", "asset_id": ids[0]}]}, r.json()

    # exactly one asset changed, and nothing was added anywhere
    assert await _status(ids[0]) == "listed"
    assert await _status(ids[1]) == "graded", "the sibling unit must be untouched"
    after = await _counts()
    assert after[0] == before[0], "a status transition adds no asset row"
    assert after[2] == before[2], "a status transition writes no stock movement"
    assert after[1] == before[1] + 1, "exactly one audit row"

    eng = get_engine()
    async with eng.connect() as c:
        row = (await c.execute(text(
            "SELECT actor_type, actor_id, entity, entity_id, action, before, after, meta FROM audit_log"
            " WHERE entity = 'asset' AND entity_id = :i ORDER BY id DESC LIMIT 1"), {"i": ids[0]})).mappings().one()
    assert row["actor_type"] == "agent" and row["actor_id"] == agent_id, dict(row)
    assert row["entity"] == "asset" and row["action"] == "status", dict(row)
    assert row["before"] == {"status": "graded"} and row["after"]["status"] == "listed", dict(row)
    assert row["meta"] == {"autonomy": {"grant_id": gid, "identity": "hermes-granted"}}, dict(row)
    # the storefront really moved: the unit is buyable, which is the blast radius the ADR states
    async with eng.connect() as c:
        shown = (await c.execute(text("SELECT count(*) FROM v_storefront_assets WHERE id = :i"),
                                 {"i": ids[0]})).scalar_one()
    assert shown == 1


async def test_a_granted_execution_is_single_use_and_cannot_be_replayed(client, fake_model):
    """Same proposal twice: the second turn is refused, and the first one's write stands alone."""
    admin = await _staff(client, "admin")
    agent_id, agent = await _agent(client, admin, "hermes-replay")
    await _grant(agent_id, "list", daily_cap=5)
    _, ids, serials = await _stage_units(client, admin)

    fake_model("list", {"serial_number": serials[0]})
    prop = await _propose(client, agent)
    first = await _execute(client, agent, prop["proposal_id"])
    assert first.status_code == 200, first.text

    before = await _counts()
    second = await _execute(client, agent, prop["proposal_id"])
    assert second.status_code == 403, second.text
    assert "consumed" in second.json()["detail"], second.text
    assert await _counts() == before, "a replayed proposal must write nothing"
    assert await _status(ids[0]) == "listed"
    assert (await _record(prop["proposal_id"]))["consumed"] is True


async def test_another_agents_proposal_is_refused(client, fake_model):
    """A proposal belongs to the identity that made it - the id is not a capability.

    Two identities of the same sponsor, one proposal: the second agent's turn is refused and writes
    nothing (decision 2). Nothing is consumed either, so the owner can still spend it.
    """
    admin = await _staff(client, "admin")
    _, owner = await _agent(client, admin, "hermes-owner")
    other_id, other = await _agent(client, admin, "hermes-other")
    await _grant(other_id, "list", daily_cap=5)          # the OTHER identity is granted; still refused
    _, ids, serials = await _stage_units(client, admin)

    fake_model("list", {"serial_number": serials[0]})
    prop = await _propose(client, owner)
    before = await _counts()
    r = await _execute(client, other, prop["proposal_id"])
    assert r.status_code == 403, r.text
    assert "another identity" in r.json()["detail"], r.text
    assert await _counts() == before
    assert await _status(ids[0]) == "graded"
    assert (await _record(prop["proposal_id"]))["consumed"] is False


async def test_an_unknown_or_foreign_shape_proposal_id_is_refused(client):
    """An id the server never minted (or one that expired) is a refusal, not a Redis probe."""
    admin = await _staff(client, "admin")
    agent_id, agent = await _agent(client, admin, "hermes-unknown")
    await _grant(agent_id, "list", daily_cap=5)   # granted, so the id is the only thing missing

    before = await _counts()
    for pid in ("0" * 32, uuid.uuid4().hex, "not-a-proposal-id"):
        r = await _execute(client, agent, pid)
        assert r.status_code == 403, (pid, r.status_code, r.text)
    assert await _counts() == before


# ---------------------------------------------------------------- degrade to propose

async def test_without_a_grant_the_turn_comes_back_as_a_proposal_and_writes_nothing(client, fake_model):
    """No grant: propose, never a silent drop and never a refusal (decisions 1 and 4).

    Absent a grant the Confirm line is exactly what it was, so the agent's turn hands the proposal
    back for a human instead of erroring - and the record is NOT consumed, because nothing was
    executed and the proposer may still find someone who can act on it.
    """
    admin = await _staff(client, "admin")
    agent_id, agent = await _agent(client, admin, "hermes-ungranted")
    _, ids, serials = await _stage_units(client, admin)

    fake_model("list", {"serial_number": serials[0]})
    prop = await _propose(client, agent)

    before = await _counts()
    r = await _execute(client, agent, prop["proposal_id"])
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["type"] == "proposed" and j["proposal_id"] == prop["proposal_id"], j
    assert j["action"] == "list" and j["args"] == {"serial_number": serials[0]}, j
    assert await _counts() == before, "an ungranted execute must write nothing"
    assert await _status(ids[0]) == "graded"
    assert (await _record(prop["proposal_id"]))["consumed"] is False


async def test_over_cap_the_turn_comes_back_as_a_proposal_and_writes_nothing(client, fake_model):
    """cap = 1: the first execution lands, the second proposes and moves nothing (decision 4).

    The cap key is per (identity, action, day) in the same store as the chat quota, and the second
    turn is not a 429 - the ADR deliberately does not copy `CHAT_DAILY_CAP`'s behaviour of refusing.
    """
    admin = await _staff(client, "admin")
    agent_id, agent = await _agent(client, admin, "hermes-capped")
    await _grant(agent_id, "list", daily_cap=1)
    _, ids, serials = await _stage_units(client, admin, count=2)

    fake_model("list", {"serial_number": serials[0]})
    first = await _propose(client, agent)
    assert (await _execute(client, agent, first["proposal_id"])).status_code == 200
    assert await _status(ids[0]) == "listed"

    fake_model("list", {"serial_number": serials[1]})
    second = await _propose(client, agent)
    before = await _counts()
    r = await _execute(client, agent, second["proposal_id"])
    assert r.status_code == 200, r.text
    assert r.json()["type"] == "proposed", r.json()
    assert r.json()["proposal_id"] == second["proposal_id"], r.json()
    assert await _counts() == before, "an over-cap turn must write nothing"
    assert await _status(ids[1]) == "graded", "the second unit must not have been listed"
    assert (await _record(second["proposal_id"]))["consumed"] is False


async def test_a_failed_execution_refunds_the_cap_unit(client, fake_model):
    """The refund boundary, pinned: a failure that provably wrote nothing gives the unit back.

    The failure used here is the hardest of the four that qualify - `set_status` on a unit whose
    status transition the DB trigger refuses (received -> listed): the write is attempted, the
    commit is refused by the trigger, the handler rolls back, and only THEN does it raise its 409.
    So this is a failure raised after a mutation was attempted and after the rollback that undid it,
    which is exactly the case decision 4 warns about ("refund only when the execution provably wrote
    nothing, not merely on a non-2xx") - and it still provably wrote nothing.

    With cap = 1 the refund is observable: after the failed attempt a VALID execution still lands,
    which it could not if the failed one had spent the day's single unit.
    """
    admin = await _staff(client, "admin")
    agent_id, agent = await _agent(client, admin, "hermes-refund")
    await _grant(agent_id, "list", daily_cap=1)

    # one unit the trigger will refuse to list, one legal unit to spend the refund on
    lot_id, units = await _received_units(client, admin, 2)
    (doomed_id, doomed_sn), (aid_ok, sn_ok) = units
    await _advance_to_graded_and_priced(client, admin, aid_ok)
    assert (await client.post(f"/staff/lots/{lot_id}/activate", headers=admin)).status_code == 200

    fake_model("list", {"serial_number": doomed_sn})
    doomed = await _propose(client, agent)
    before = await _counts()
    r = await _execute(client, agent, doomed["proposal_id"])
    # 409 is `staff_ops._409`: the commit was refused and the handler rolled back before raising,
    # which is what makes this failure one that provably wrote nothing.
    assert r.status_code == 409, r.text
    assert await _counts() == before, "a rolled-back execution writes nothing"
    assert await _status(doomed_id) == "received"
    # the proposal itself IS spent - the attempt was made; only the cap unit is refunded
    assert (await _record(doomed["proposal_id"]))["consumed"] is True

    fake_model("list", {"serial_number": sn_ok})
    ok = await _propose(client, agent)
    r = await _execute(client, agent, ok["proposal_id"])
    assert r.status_code == 200, (r.status_code, r.text)
    assert r.json()["type"] == "executed", r.json()
    assert await _status(aid_ok) == "listed"


# ---------------------------------------------------------------- decision 7

async def test_a_fallback_model_proposal_is_refused_across_a_worker_change(client, fake_model, monkeypatch):
    """Decision 7's precondition: the deciding model rides with the RECORD, not with the process.

    The proposal is made while the local (fallback) model answers, so `decided_by` is the fallback
    model. The old guard was a module-level dict of sponsor ids plus a process-global LAST_VIA, so a
    different uvicorn worker - or a restart - would find neither and let the execution through. This
    test reproduces exactly that: it arms the in-process flag (asserted, so the simulation is not
    vacuous), then replaces it with a fresh empty dict - the state a new process starts in - and
    leaves LAST_VIA claiming the cloud model answered. The refusal must come from the persisted
    record, which no worker change touches.
    """
    admin = await _staff(client, "admin")
    agent_id, agent = await _agent(client, admin, "hermes-fallback")
    await _grant(agent_id, "list", daily_cap=5)
    _, ids, serials = await _stage_units(client, admin)

    fake_model("list", {"serial_number": serials[0]}, via="local")
    prop = await _propose(client, agent)
    rec = await _record(prop["proposal_id"])
    assert rec["decided_by"] == staff_ai._fallback_model(), rec
    assert staff_ai._is_fallback(rec["decided_by"]) is True

    eng = get_engine()
    async with eng.connect() as c:
        sponsor_id = (await c.execute(text("SELECT staff_id FROM agent_tokens WHERE id = :i"),
                                      {"i": agent_id})).scalar_one()
    assert staff_ai._FALLBACK_PROPOSAL.get(str(sponsor_id)) is True, "the in-process guard was armed"

    # the worker change: a fresh process has none of that, and the record does not care
    monkeypatch.setattr(staff_ai, "_FALLBACK_PROPOSAL", {})
    monkeypatch.setitem(staff_ai.ai_svc.LAST_VIA, "via", "cloud")

    before = await _counts()
    r = await _execute(client, agent, prop["proposal_id"])
    assert r.status_code == 403, r.text
    assert "fallback model" in r.json()["detail"], r.text
    assert await _counts() == before, "a fallback-decided proposal must not execute"
    assert await _status(ids[0]) == "graded"
    # refused before it was spent or charged: re-proposing on the primary model is the way forward
    assert (await _record(prop["proposal_id"]))["consumed"] is False
    cap_key = staff_ai._cap_key("agent", agent_id, "list")
    assert await get_redis().get(cap_key) is None, "a refusal before the reserve spends nothing"
