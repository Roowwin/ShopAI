"""The Lot Process workbench: one lot's grading queue, and the ladder a quick-grade walks.

The interesting thing in this file is the LADDER. `rfo_assets_check_status` admits `tested -> graded`
and refuses `received -> graded`, so a unit fresh off the intake dock cannot be graded in one
update. The workbench's `test_first` flag walks that rung, and these tests pin both that it works
and - just as important - that it did not quietly change what the plain `grade` call does.

As in the importer's suite, the rows these tests create cannot be deleted: `rfo_app` holds only
SELECT+INSERT on `stock_movements`, and the ledger's FK pins each unit it names. So every lot and
serial carries a unique pytest tag and stays in dev, harmless and prefixed.
"""

import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def _staff(client, role: str) -> str:
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    sid, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    return r.json()["access_token"]


def _tag() -> str:
    return "pytest-lp-" + uuid.uuid4().hex[:10]


async def _lot_with_units(client, tok, tag: str, count: int) -> tuple[int, str, list[int]]:
    """A fresh lot holding `count` scanned-in units (status received, no grade)."""
    r = await client.post("/staff/lots", json={"lot_number": tag + "-LOT", "warehouse": "WH-T"},
                          headers=_h(tok))
    assert r.status_code == 201, r.text
    lot = r.json()
    ids = []
    for i in range(count):
        s = await client.post("/staff/assets/scan-in",
                              json={"lot_number": lot["lot_number"], "serial_number": f"{tag}-S{i}"},
                              headers=_h(tok))
        assert s.status_code == 201, s.text
        ids.append(s.json()["id"])
    return lot["id"], lot["lot_number"], ids


async def _one(sql: str, **params):
    eng = get_engine()
    async with eng.begin() as c:
        return (await c.execute(text(sql), params)).scalar_one()


async def _audit_actions(asset_id: int) -> list[str]:
    eng = get_engine()
    async with eng.begin() as c:
        rows = (await c.execute(text(
            "SELECT action FROM audit_log WHERE entity = 'asset' AND entity_id = :i ORDER BY id"),
            {"i": asset_id})).scalars().all()
    return list(rows)


async def test_worklist_reports_progress_and_the_awaiting_queue(client):
    """Progress counts the WHOLE lot; the queue carries only the units still without a grade."""
    tag = _tag()
    tok = await _staff(client, "admin")
    lot_id, lot_number, ids = await _lot_with_units(client, tok, tag, 3)

    r = await client.get(f"/staff/lots/worklist?lot_number={lot_number}", headers=_h(tok))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["lot"]["lot_number"] == lot_number
    assert body["progress"] == {"total_units": 3, "graded_units": 0, "awaiting_grade_units": 3}
    assert [a["id"] for a in body["assets"]] == ids
    assert all(a["grade"] is None for a in body["assets"])
    assert body["truncated"] is False

    # Grade one through the normal door and the counts move on both sides of the line.
    g = await client.post(f"/staff/assets/{ids[0]}/grade",
                          json={"grade": "B", "test_first": True}, headers=_h(tok))
    assert g.status_code == 200, g.text
    after = (await client.get(f"/staff/lots/worklist?lot_id={lot_id}", headers=_h(tok))).json()
    assert after["progress"] == {"total_units": 3, "graded_units": 1, "awaiting_grade_units": 2}
    assert ids[0] not in [a["id"] for a in after["assets"]]


async def test_worklist_needs_exactly_one_of_id_or_number(client):
    tag = _tag()
    tok = await _staff(client, "admin")
    _, lot_number, _ = await _lot_with_units(client, tok, tag, 1)
    lot_id = await _one("SELECT id FROM lots WHERE lot_number = :n", n=lot_number)

    both = await client.get(f"/staff/lots/worklist?lot_id={lot_id}&lot_number={lot_number}",
                            headers=_h(tok))
    assert both.status_code == 422, both.text
    neither = await client.get("/staff/lots/worklist", headers=_h(tok))
    assert neither.status_code == 422, neither.text
    missing = await client.get("/staff/lots/worklist?lot_number=pytest-no-such-lot", headers=_h(tok))
    assert missing.status_code == 404, missing.text
    by_id = await client.get(f"/staff/lots/worklist?lot_id={lot_id}", headers=_h(tok))
    assert by_id.status_code == 200, by_id.text


async def test_quick_grade_walks_the_ladder_and_records_both_steps(client):
    """A unit straight off intake is graded in one press - and the trail shows both rungs."""
    tag = _tag()
    tok = await _staff(client, "admin")
    _, _, ids = await _lot_with_units(client, tok, tag, 1)
    asset_id = ids[0]

    assert await _one("SELECT status FROM assets WHERE id = :i", i=asset_id) == "received"

    r = await client.post(f"/staff/assets/{asset_id}/grade",
                          json={"grade": "A", "test_first": True}, headers=_h(tok))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "graded"
    assert r.json()["grade"] == "A"
    assert r.json()["stepped_through_tested"] is True

    assert await _one("SELECT status FROM assets WHERE id = :i", i=asset_id) == "graded"
    assert await _one("SELECT grade FROM assets WHERE id = :i", i=asset_id) == "A"
    # Both rungs, in order: the unit's history shows the path it took, not a jump it never made.
    assert await _audit_actions(asset_id) == ["scan_in", "test", "grade"]


async def test_quick_grade_on_an_already_tested_unit_does_not_add_the_step(client):
    """No redundant rung: a tested unit is graded directly, with one audit row."""
    tag = _tag()
    tok = await _staff(client, "admin")
    _, _, ids = await _lot_with_units(client, tok, tag, 1)
    asset_id = ids[0]
    t = await client.post(f"/staff/assets/{asset_id}/status", json={"status": "tested"}, headers=_h(tok))
    assert t.status_code == 200, t.text

    r = await client.post(f"/staff/assets/{asset_id}/grade",
                          json={"grade": "C", "test_first": True}, headers=_h(tok))
    assert r.status_code == 200, r.text
    assert r.json()["stepped_through_tested"] is False
    assert await _audit_actions(asset_id) == ["scan_in", "status", "grade"]


async def test_plain_grade_still_refuses_an_untested_unit(client):
    """The guard on the other side: without the opt-in flag, nothing about the old behaviour moved.

    This is the DB trigger doing its job, surfaced as a 409 through the existing translator - the
    quick-grade flag is an explicit opt-in, not a change to what `grade` means.
    """
    tag = _tag()
    tok = await _staff(client, "admin")
    _, _, ids = await _lot_with_units(client, tok, tag, 1)
    asset_id = ids[0]

    r = await client.post(f"/staff/assets/{asset_id}/grade", json={"grade": "A"}, headers=_h(tok))
    assert r.status_code == 409, r.text
    assert "illegal asset transition" in r.text
    assert await _one("SELECT status FROM assets WHERE id = :i", i=asset_id) == "received"
    assert await _audit_actions(asset_id) == ["scan_in"], "a refused write leaves no audit row"


async def test_worklist_reports_a_cut_queue_rather_than_implying_it_ended(client):
    """Past the cap the payload says so; the progress pair still counts the whole lot."""
    tag = _tag()
    tok = await _staff(client, "admin")
    lot_id, lot_number, _ = await _lot_with_units(client, tok, tag, 2)
    # A lot over the cap only through a lowered cap would need a config knob, so this checks the
    # honest-reporting fields exist and agree on a small lot rather than manufacturing 501 rows.
    body = (await client.get(f"/staff/lots/worklist?lot_number={lot_number}", headers=_h(tok))).json()
    assert body["limit"] == 500
    assert body["truncated"] is False
    assert len(body["assets"]) == body["progress"]["awaiting_grade_units"] == 2


async def test_worklist_is_closed_to_a_non_manager(client):
    """The queue is inventory intelligence: lot numbers, serials and what is ungraded."""
    tag = _tag()
    admin_tok = await _staff(client, "admin")
    _, lot_number, ids = await _lot_with_units(client, admin_tok, tag, 1)

    for role in ("sales", "warehouse", "technician"):
        tok = await _staff(client, role)
        r = await client.get(f"/staff/lots/worklist?lot_number={lot_number}", headers=_h(tok))
        assert r.status_code == 403, f"{role}: {r.status_code}"

    g = await client.post(f"/staff/assets/{ids[0]}/grade", json={"grade": "A"}, headers=_h(await _staff(client, "sales")))
    assert g.status_code == 403, g.text
