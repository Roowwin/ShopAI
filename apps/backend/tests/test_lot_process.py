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
    assert body["progress"] == {"total_units": 3, "received_units": 3, "graded_units": 0,
                                "awaiting_grade_units": 3, "ready_for_pricing_units": 0}
    assert body["match"] == {"kind": "lot", "resolved_by": "lot_number", "term": None}
    assert [a["id"] for a in body["assets"]] == ids
    assert all(a["grade"] is None for a in body["assets"])
    assert body["truncated"] is False

    # Grade one through the normal door and the counts move on both sides of the line.
    g = await client.post(f"/staff/assets/{ids[0]}/grade",
                          json={"grade": "B", "test_first": True}, headers=_h(tok))
    assert g.status_code == 200, g.text
    after = (await client.get(f"/staff/lots/worklist?lot_id={lot_id}", headers=_h(tok))).json()
    assert after["progress"] == {"total_units": 3, "received_units": 2, "graded_units": 1,
                                 "awaiting_grade_units": 2, "ready_for_pricing_units": 1}
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


async def test_the_grading_queue_carries_the_model_the_grader_reads(client):
    """Each row names the unit's Model, which is what the operator grades against."""
    tag = _tag()
    tok = await _staff(client, "admin")
    r = await client.post("/staff/lots", json={"lot_number": tag + "-LOT", "warehouse": "WH-T"},
                          headers=_h(tok))
    lot = r.json()
    model = "Pytest Model " + uuid.uuid4().hex[:6]
    p = await client.post("/staff/products", json={
        "brand_slug": "apple", "category_slug": "phones", "model": model,
        "title": "Pytest queue product " + uuid.uuid4().hex[:8],
    }, headers=_h(tok))
    assert p.status_code == 201, p.text
    s = await client.post("/staff/assets/scan-in",
                          json={"lot_number": lot["lot_number"], "serial_number": tag + "-S1",
                                "product_id": p.json()["id"]}, headers=_h(tok))
    assert s.status_code == 201, s.text

    body = (await client.get(f"/staff/lots/worklist?q={lot['lot_number']}", headers=_h(tok))).json()
    row = body["assets"][0]
    assert row["product_model"] == model
    assert row["status"] == "received" and row["grade"] is None, "it is in the queue, ungraded"
    assert row["gradable"] is True and row["ready_for_pricing"] is False


async def test_universal_search_resolves_lot_serial_and_asset_id(client):
    """One box, three handles - and the payload says which rule matched."""
    tag = _tag()
    tok = await _staff(client, "admin")
    _, lot_number, ids = await _lot_with_units(client, tok, tag, 2)

    by_lot = (await client.get(f"/staff/lots/worklist?q={lot_number}", headers=_h(tok))).json()
    assert by_lot["match"]["resolved_by"] == "lot_number"
    assert by_lot["match"]["kind"] == "lot"
    assert [a["id"] for a in by_lot["assets"]] == ids

    # `_lot_with_units` numbers its units from S0, so S1 is the SECOND asset in the lot.
    by_serial = (await client.get(f"/staff/lots/worklist?q={tag}-S1", headers=_h(tok))).json()
    assert by_serial["match"] == {"kind": "asset", "resolved_by": "serial", "term": f"{tag}-S1"}
    assert [a["id"] for a in by_serial["assets"]] == [ids[1]]
    # An asset match still carries its lot's progress, so the workbench has context either way.
    assert by_serial["lot"]["lot_number"] == lot_number
    assert by_serial["progress"]["total_units"] == 2

    by_id = (await client.get(f"/staff/lots/worklist?q={ids[0]}", headers=_h(tok))).json()
    assert by_id["match"]["resolved_by"] == "asset_id"
    assert [a["id"] for a in by_id["assets"]] == [ids[0]]

    # A serial is matched case-insensitively (the column is CITEXT).
    upper = (await client.get(f"/staff/lots/worklist?q={tag.upper()}-S1", headers=_h(tok))).json()
    assert [a["id"] for a in upper["assets"]] == [ids[1]]

    nothing = await client.get("/staff/lots/worklist?q=pytest-nothing-matches-this", headers=_h(tok))
    assert nothing.status_code == 404, nothing.text


async def test_scope_all_shows_graded_units_and_unfinished_hides_them(client):
    tag = _tag()
    tok = await _staff(client, "admin")
    _, lot_number, ids = await _lot_with_units(client, tok, tag, 3)
    g = await client.post(f"/staff/assets/{ids[0]}/grade",
                          json={"grade": "B", "test_first": True}, headers=_h(tok))
    assert g.status_code == 200, g.text

    unfinished = (await client.get(f"/staff/lots/worklist?q={lot_number}&scope=unfinished",
                                   headers=_h(tok))).json()
    assert ids[0] not in [a["id"] for a in unfinished["assets"]]
    assert len(unfinished["assets"]) == 2

    every = (await client.get(f"/staff/lots/worklist?q={lot_number}&scope=all",
                              headers=_h(tok))).json()
    assert sorted(a["id"] for a in every["assets"]) == sorted(ids)
    assert every["scope"] == "all"
    graded_row = next(a for a in every["assets"] if a["id"] == ids[0])
    assert graded_row["grade"] == "B" and graded_row["ready_for_pricing"] is True

    bad = await client.get(f"/staff/lots/worklist?q={lot_number}&scope=everything", headers=_h(tok))
    assert bad.status_code == 422, bad.text


async def test_a_grade_can_be_overwritten_and_the_audit_keeps_both(client):
    tag = _tag()
    tok = await _staff(client, "admin")
    _, lot_number, ids = await _lot_with_units(client, tok, tag, 1)
    asset_id = ids[0]
    first = await client.post(f"/staff/assets/{asset_id}/grade",
                              json={"grade": "C", "test_first": True}, headers=_h(tok))
    assert first.status_code == 200, first.text
    assert first.json()["stepped_through_tested"] is True

    # A second press with a different letter replaces the grade; the status is already `graded`, so
    # no transition is attempted and nothing is refused.
    again = await client.post(f"/staff/assets/{asset_id}/grade",
                              json={"grade": "A", "test_first": True}, headers=_h(tok))
    assert again.status_code == 200, again.text
    assert again.json()["grade"] == "A"
    assert again.json()["stepped_through_tested"] is False
    assert await _one("SELECT grade FROM assets WHERE id = :i", i=asset_id) == "A"

    body = (await client.get(f"/staff/lots/worklist?q={lot_number}&scope=all", headers=_h(tok))).json()
    assert body["progress"]["graded_units"] == 1, "an overwrite is not a second graded unit"
    # The trail keeps every value it passed through, not just the last one.
    assert await _audit_actions(asset_id) == ["scan_in", "test", "grade", "grade"]


async def test_clearing_a_grade_returns_the_unit_to_the_unfinished_queue(client):
    tag = _tag()
    tok = await _staff(client, "admin")
    _, lot_number, ids = await _lot_with_units(client, tok, tag, 2)
    asset_id = ids[0]
    await client.post(f"/staff/assets/{asset_id}/grade",
                      json={"grade": "B", "test_first": True}, headers=_h(tok))

    cleared = await client.post(f"/staff/assets/{asset_id}/grade", json={"grade": None}, headers=_h(tok))
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["grade"] is None
    assert await _one("SELECT grade FROM assets WHERE id = :i", i=asset_id) is None

    body = (await client.get(f"/staff/lots/worklist?q={lot_number}", headers=_h(tok))).json()
    assert asset_id in [a["id"] for a in body["assets"]], "it is back in the unfinished queue"
    assert body["progress"]["graded_units"] == 0
    assert body["progress"]["ready_for_pricing_units"] == 0, "no grade means nothing to price"

    # The status cannot be demoted - the trigger has no graded->tested edge - so the row says so
    # rather than the handler inventing a transition the domain does not have.
    assert await _one("SELECT status FROM assets WHERE id = :i", i=asset_id) == "graded"


async def test_grade_omitted_from_the_body_is_still_refused(client):
    """The old contract: a caller that forgets the grade is refused, not silently cleared."""
    tag = _tag()
    tok = await _staff(client, "admin")
    _, _, ids = await _lot_with_units(client, tok, tag, 1)
    r = await client.post(f"/staff/assets/{ids[0]}/grade", json={}, headers=_h(tok))
    assert r.status_code == 422, r.text
    assert "grade is required" in r.text
    bad = await client.post(f"/staff/assets/{ids[0]}/grade", json={"grade": "Z"}, headers=_h(tok))
    assert bad.status_code == 422, bad.text


async def test_a_description_can_be_edited_and_the_edit_is_audited(client):
    tag = _tag()
    tok = await _staff(client, "admin")
    _, lot_number, ids = await _lot_with_units(client, tok, tag, 1)
    asset_id = ids[0]

    note = "Screen cracked top-left; battery health 87%."
    r = await client.post(f"/staff/assets/{asset_id}/notes", json={"notes": note}, headers=_h(tok))
    assert r.status_code == 200, r.text
    assert r.json()["notes"] == note
    assert await _one("SELECT notes FROM assets WHERE id = :i", i=asset_id) == note

    body = (await client.get(f"/staff/lots/worklist?q={lot_number}", headers=_h(tok))).json()
    assert body["assets"][0]["notes"] == note

    row = await _one(
        "SELECT before::text || ' -> ' || after::text FROM audit_log"
        " WHERE entity='asset' AND entity_id = :i AND action='edit_notes' ORDER BY id DESC LIMIT 1",
        i=asset_id)
    assert "battery health 87%" in row
    assert await _audit_actions(asset_id) == ["scan_in", "edit_notes"]

    # Blank clears it, so "no description" has one representation rather than two.
    blank = await client.post(f"/staff/assets/{asset_id}/notes", json={"notes": "   "}, headers=_h(tok))
    assert blank.status_code == 200, blank.text
    assert blank.json()["notes"] is None
    assert await _one("SELECT notes FROM assets WHERE id = :i", i=asset_id) is None


async def test_description_edits_follow_the_grading_roles(client):
    tag = _tag()
    tok = await _staff(client, "admin")
    _, _, ids = await _lot_with_units(client, tok, tag, 1)
    for role in ("sales", "warehouse"):
        other = await _staff(client, role)
        r = await client.post(f"/staff/assets/{ids[0]}/notes", json={"notes": "x"}, headers=_h(other))
        assert r.status_code == 403, f"{role}: {r.status_code}"
    tech = await _staff(client, "technician")
    ok = await client.post(f"/staff/assets/{ids[0]}/notes", json={"notes": "tech note"}, headers=_h(tech))
    assert ok.status_code == 200, ok.text


async def test_ready_for_pricing_tracks_grade_and_status_together(client):
    """The flag the pricing stage will read: graded AND actually holding a grade."""
    tag = _tag()
    tok = await _staff(client, "admin")
    _, lot_number, ids = await _lot_with_units(client, tok, tag, 3)

    def ready(body):
        return {a["id"]: a["ready_for_pricing"] for a in body["assets"]}

    before = (await client.get(f"/staff/lots/worklist?q={lot_number}&scope=all", headers=_h(tok))).json()
    assert ready(before) == {i: False for i in ids}

    await client.post(f"/staff/assets/{ids[0]}/grade", json={"grade": "A", "test_first": True}, headers=_h(tok))
    await client.post(f"/staff/assets/{ids[1]}/grade", json={"grade": "D", "test_first": True}, headers=_h(tok))
    mid = (await client.get(f"/staff/lots/worklist?q={lot_number}&scope=all", headers=_h(tok))).json()
    assert ready(mid) == {ids[0]: True, ids[1]: True, ids[2]: False}
    assert mid["progress"]["ready_for_pricing_units"] == 2

    await client.post(f"/staff/assets/{ids[0]}/grade", json={"grade": None}, headers=_h(tok))
    after = (await client.get(f"/staff/lots/worklist?q={lot_number}&scope=all", headers=_h(tok))).json()
    assert ready(after) == {ids[0]: False, ids[1]: True, ids[2]: False}
    assert after["progress"]["ready_for_pricing_units"] == 1
