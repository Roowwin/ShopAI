"""GET /staff/overview's `dashboard` block - the /admin/dashboard page's one read.

Two things this file exists to catch, and neither is a status code:

* the door's role gate on the block the new page reads (sales may price units but must not read
  the dashboard), and
* DISAGREEMENT with the database. Every count is asserted as a DELTA against a baseline read of
  the SAME endpoint taken before this test's fixtures existed, never against a literal. The dev
  DB is shared and holds ~6k real assets, so a literal would be correct exactly once; a delta says
  "these fixtures are what moved this number", which is the claim that can keep being true.

Hermetic in the house sense: builds its own product -> two lots -> five units through the real
staff flow, buys one of them to produce a paid order, and removes the order side and its staff
identities in a finally. The assets, their movements and the two lots cannot be removed (rfo_app
has no DELETE on the append-only stock_movements, which references assets, and the lots are
referenced by those assets), so each run leaves inventory rows behind - which is exactly why the
assertions are deltas. The stuck/lots_stuck fixtures backdate intake_at / received_at because
those are the columns the endpoint ages by; updated_at cannot be backdated at all (the
rfo_touch_updated_at trigger rewrites it on every UPDATE), which is also why the endpoint must not
use it for "how long has this sat here".
"""
import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine

DASHBOARD_KEYS = {"pricing_pending", "revenue_last_7d_cents", "orders_last_7d", "stuck_assets",
                  "lots_stuck", "grade_mix", "category_mix", "team_activity"}
TEAM_KEYS = {"actor_id", "actor_email", "actions"}


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def _cleanup():
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                             "(SELECT id FROM staff_users WHERE email LIKE 'pytest-%')"))
        await c.execute(text("DELETE FROM staff_users WHERE email LIKE 'pytest-%'"))


async def _login(client, email: str, role: str) -> tuple[int, dict]:
    sid, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return sid, _h(r.json()["access_token"])


async def test_dashboard_door_is_role_gated(client):
    """No credential -> 401; a sales staff token -> 403; an admin -> 200 with the dashboard block.

    Sales is the sharp edge again: it is a real staff role that writes prices, so 403 here (not
    401) proves the gate is the ROLE gate and not merely "is there a staff token".
    """
    await _cleanup()
    try:
        r = await client.get("/staff/overview")
        assert r.status_code == 401, r.text
        _, hs = await _login(client, "pytest-" + uuid.uuid4().hex + "@test.rfo", "sales")
        r = await client.get("/staff/overview", headers=hs)
        assert r.status_code == 403, r.text
        _, h = await _login(client, "pytest-" + uuid.uuid4().hex + "@test.rfo", "admin")
        r = await client.get("/staff/overview", headers=h)
        assert r.status_code == 200, r.text
        assert DASHBOARD_KEYS <= set(r.json()["dashboard"]), sorted(r.json()["dashboard"])
    finally:
        await _cleanup()


async def test_dashboard_counts_match_its_own_fixtures(client):
    """The `dashboard` block against units this test created, in known states.

    Fixtures: two graded-but-unpriced units, one graded -> priced -> listed unit (grade B, in a
    `phones` product), two units backdated into the received/tested backlog, and one lot left in
    intake with a backdated received_at. Then the listed unit is bought and paid for.
    """
    await _cleanup()
    eng = get_engine()
    suffix = uuid.uuid4().hex[:8]
    slug = "pytest-dash-" + suffix
    admin_email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    sn_stuck = "pytest-dash-stuck-" + suffix
    oid = None

    async def _dashboard(h) -> dict:
        r = await client.get("/staff/overview", headers=h)
        assert r.status_code == 200, r.text
        return r.json()

    async def _scan(h, lot_number: str, serial: str, pid: int) -> int:
        r = await client.post("/staff/assets/scan-in", json={"lot_number": lot_number,
                                                             "serial_number": serial, "product_id": pid},
                              headers=h)
        assert r.status_code == 201, r.text
        return r.json()["id"]

    async def _step(h, aid: int, step: str, body: dict):
        r = await client.post(f"/staff/assets/{aid}/{step}", json=body, headers=h)
        assert r.status_code == 200, r.text

    try:
        admin_id, h = await _login(client, admin_email, "admin")
        j0 = await _dashboard(h)
        b0 = j0["dashboard"]
        s0 = j0["inventory"]["by_status"]

        # --- fixtures ---------------------------------------------------------------
        r = await client.post("/staff/products", json={"brand_slug": "apple", "category_slug": "phones",
                                                       "model": "Pytest Dash", "title": "Pytest Dash Phone",
                                                       "slug": slug}, headers=h)
        assert r.status_code == 201, r.text
        pid = r.json()["id"]
        # The mix is keyed by categories.NAME, not by the slug this test creates the product
        # with ("phones" -> "Phones"), so read the name rather than hard-coding a display label.
        async with eng.begin() as c:
            cat_name = (await c.execute(text("SELECT name FROM categories WHERE slug = :s"),
                                        {"s": "phones"})).scalar_one()

        lot_a = (await client.post("/staff/lots", json={"notes": "pytest dashboard backlog"}, headers=h)).json()
        lot_b = (await client.post("/staff/lots", json={"notes": "pytest dashboard sale"}, headers=h)).json()

        # two graded, unpriced units: the pricing backlog
        u1 = await _scan(h, lot_b["lot_number"], "pytest-dash-g1-" + suffix, pid)
        u2 = await _scan(h, lot_b["lot_number"], "pytest-dash-g2-" + suffix, pid)
        for aid, grade in ((u1, "A"), (u2, "C")):
            await _step(h, aid, "status", {"status": "tested"})
            await _step(h, aid, "grade", {"grade": grade})

        # one unit all the way to listed: the grade/category mix, and the sale
        u3 = await _scan(h, lot_b["lot_number"], "pytest-dash-l1-" + suffix, pid)
        await _step(h, u3, "status", {"status": "tested"})
        await _step(h, u3, "grade", {"grade": "B"})
        await _step(h, u3, "price", {"sale_price_cents": 19900})
        await _step(h, u3, "status", {"status": "listed"})

        # two units left behind in received / tested, aged past the 7-day line
        u4 = await _scan(h, lot_a["lot_number"], "pytest-dash-r-" + suffix, pid)
        u5 = await _scan(h, lot_a["lot_number"], sn_stuck, pid)
        await _step(h, u5, "status", {"status": "tested"})
        async with eng.begin() as c:
            await c.execute(text("UPDATE assets SET intake_at = now() - interval '10 days' WHERE id = :i"), {"i": u4})
            await c.execute(text("UPDATE assets SET intake_at = now() - interval '20 days' WHERE id = :i"), {"i": u5})
            # the lot stays in intake and is aged past its own 14-day line
            await c.execute(text("UPDATE lots SET received_at = now() - interval '20 days' WHERE id = :i"), {"i": lot_a["id"]})

        j1 = await _dashboard(h)
        d1 = j1["dashboard"]
        s1 = j1["inventory"]["by_status"]

        # --- the inventory counts, as deltas ---------------------------------------
        assert s1["graded"] - s0["graded"] == 2, (s0, s1)     # the two unpriced units
        assert s1["listed"] - s0["listed"] == 1, (s0, s1)
        assert s1["received"] - s0["received"] == 1, (s0, s1)
        assert s1["tested"] - s0["tested"] == 1, (s0, s1)

        assert d1["pricing_pending"] - b0["pricing_pending"] == 2, d1["pricing_pending"]
        assert d1["grade_mix"]["B"] - b0["grade_mix"]["B"] == 1, d1["grade_mix"]
        assert (d1["category_mix"].get(cat_name, 0) - b0["category_mix"].get(cat_name, 0)) == 1, d1["category_mix"]
        assert d1["lots_stuck"]["count"] - b0["lots_stuck"]["count"] == 1, d1["lots_stuck"]
        assert d1["stuck_assets"]["count"] - b0["stuck_assets"]["count"] == 2, d1["stuck_assets"]

        # the oldest serial cannot be asserted against the fixture (it is a global min over real
        # stock), so it is asserted against the DB's own answer to the same question - the same
        # "the endpoint and the database agree" claim test_overview.py makes for by_status.
        async with eng.begin() as c:
            row = (await c.execute(text("""
                SELECT count(*), (array_agg(serial_number ORDER BY intake_at ASC))[1]
                FROM assets
                WHERE status IN ('received', 'tested') AND intake_at < now() - interval '7 days'
            """))).one()
        assert d1["stuck_assets"]["count"] == row[0], (d1["stuck_assets"], row)
        assert d1["stuck_assets"]["oldest_serial_number"] == row[1], (d1["stuck_assets"], row)

        # --- the leaderboard: shape, order, cap, and agreement with the DB ----------
        ta = d1["team_activity"]
        assert isinstance(ta, list) and len(ta) <= 5, ta
        assert all(set(e) == TEAM_KEYS for e in ta), ta
        acts = [e["actions"] for e in ta]
        assert acts == sorted(acts, reverse=True) and all(a >= 1 for a in acts), ta
        async with eng.begin() as c:
            rows = (await c.execute(text("""
                SELECT a.actor_id, s.email, count(*)
                FROM audit_log a
                LEFT JOIN staff_users s ON s.id = a.actor_id
                WHERE a.actor_type = 'staff' AND a.actor_id IS NOT NULL
                  AND a.at >= now() - interval '7 days'
                GROUP BY a.actor_id, s.email
                ORDER BY count(*) DESC, a.actor_id ASC
                LIMIT 5
            """))).all()
            mine = (await c.execute(text("""
                SELECT count(*) FROM audit_log
                WHERE actor_type = 'staff' AND actor_id = :i AND at >= now() - interval '7 days'
            """), {"i": admin_id})).scalar_one()
        assert [(e["actor_id"], e["actor_email"], e["actions"]) for e in ta] == \
               [(r[0], r[1], int(r[2])) for r in rows], ta
        assert mine >= 1, "the fixture's own staff actions must be audited"
        by_actor = {e["actor_id"]: e["actions"] for e in ta}
        if admin_id in by_actor:
            assert by_actor[admin_id] == mine, (by_actor[admin_id], mine)

        # --- the sale: revenue and orders are 7-day, paid-only ---------------------
        await client.post(f"/staff/lots/{lot_b['id']}/activate", headers=h)
        r = await client.post("/store/checkout", json={"asset_ids": [u3], "shipping_country": "AU",
                                                       "ship_to_name": "T", "ship_line1": "x",
                                                       "ship_city": "Sydney", "ship_postcode": "2000"})
        assert r.status_code == 200, r.text
        order = r.json()
        oid = order["order_public_id"]
        assert (await client.post(f"/store/orders/{oid}/pay")).status_code == 200
        r = await client.post(f"/store/orders/{oid}/simulate-payment")
        assert r.status_code == 200 and r.json()["status"] == "paid", r.text

        j2 = await _dashboard(h)
        d2 = j2["dashboard"]
        assert d2["revenue_last_7d_cents"] - d1["revenue_last_7d_cents"] == order["total_cents"], d2
        assert d2["orders_last_7d"] - d1["orders_last_7d"] == 1, d2
        # the sold unit left the LISTED population, so both mixes drop it again
        assert d2["grade_mix"]["B"] - d1["grade_mix"]["B"] == -1, d2["grade_mix"]
        assert d2["category_mix"].get(cat_name, 0) - d1["category_mix"].get(cat_name, 0) == -1, d2["category_mix"]
    finally:
        async with eng.begin() as c:
            if oid is not None:
                for table in ("order_tax_lines", "payments", "order_lines"):
                    await c.execute(text(f"DELETE FROM {table} WHERE order_id IN (SELECT id FROM orders WHERE public_id = :o)"),
                                    {"o": oid})
                await c.execute(text("DELETE FROM orders WHERE public_id = :o"), {"o": oid})
            await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                                 "(SELECT id FROM staff_users WHERE email = :e)"), {"e": admin_email})
            await c.execute(text("DELETE FROM staff_users WHERE email = :e"), {"e": admin_email})


async def test_stale_stock_ages_from_the_audit_trail(client):
    """`stale_listed` counts units LISTED for over 90 days, aged from the audit trail.

    This is the one dashboard count whose date is not on the asset row, so this test is where the
    claim is actually proved. `updated_at` cannot answer it (rfo_touch_updated_at rewrites it on
    every UPDATE) and there is no listed_at column, so the endpoint reads the latest status
    transition into `listed` out of audit_log. On the dev DB the live answer is 0 - every unit in it
    is days old - so a test is the only place the counting can be seen to work at all.

    THREE THINGS A NAIVE IMPLEMENTATION GETS WRONG, and all three are asserted here:

      * a unit that is `listed` with NO recorded listing transition is NOT counted. 146 of today's
        4368 listed units are in exactly that state, and the payload cannot tell their age - a count
        that guessed at them (from `updated_at`, say) would invent the very fact the alert reports;
      * a unit whose only listing transition is 100 days old COUNTS (+1 against the baseline), and
      * the SAME unit, re-listed today, does NOT count any more. The age is the MAX of the asset's
        listing transitions, not the MIN: a unit that was listed, pulled, and put back up is a young
        listing, and a MIN would mark it stale for the rest of its life and send the operator to
        discount a unit that has just gone up.

    The unit is walked to `listed` in SQL rather than through `/status`, because the API layer is
    what writes the audit row: going through the endpoint would leave a transition dated today and
    there would be nothing left to test.

    `audit_log` is INSERT-only for the app role (SELECT + INSERT, no UPDATE and no DELETE - the same
    append-only grant `stock_movements` carries), so the aged rows are inserted with an explicit `at`
    rather than backdated afterwards, and they cannot be cleaned up. That is what the delta
    assertions are for. The fixture deliberately ENDS with the unit re-listed today, so what it
    leaves behind is a young listing and never a stale one: the residue is the rows, not a stale
    unit, and the live count on the dev DB stays 0.
    """
    await _cleanup()
    eng = get_engine()
    suffix = uuid.uuid4().hex[:8]
    admin_email = "pytest-" + uuid.uuid4().hex + "@test.rfo"

    async def _stale(h) -> int:
        r = await client.get("/staff/overview", headers=h)
        assert r.status_code == 200, r.text
        return r.json()["dashboard"]["stale_listed"]["count"]

    async def _log_listing(asset_id: int, age: str):
        """One status->listed transition, aged by `age` (an SQL interval literal)."""
        async with eng.begin() as c:
            await c.execute(text("""
                INSERT INTO audit_log (at, actor_type, entity, entity_id, action, before, after)
                VALUES (now() - interval '""" + age + """', 'staff', 'asset', :i, 'status',
                        '{"status": "graded"}'::jsonb, '{"status": "listed"}'::jsonb)
            """), {"i": asset_id})

    try:
        _, h = await _login(client, admin_email, "admin")
        r = await client.post("/staff/products", json={"brand_slug": "apple", "category_slug": "phones",
                                                       "model": "Pytest Stale", "title": "Pytest Stale Phone",
                                                       "slug": "pytest-stale-" + suffix}, headers=h)
        assert r.status_code == 201, r.text
        pid = r.json()["id"]
        lot = (await client.post("/staff/lots", json={"notes": "pytest stale stock"}, headers=h)).json()

        r = await client.post("/staff/assets/scan-in", json={"lot_number": lot["lot_number"],
                                                             "serial_number": "pytest-stale-" + suffix,
                                                             "product_id": pid}, headers=h)
        assert r.status_code == 201, r.text
        aid = r.json()["id"]

        base = await _stale(h)

        # WALK THE LADDER IN SQL, not through /status. The audit row is written by the API layer
        # (services/audit), not by a trigger, so this produces a unit that is genuinely `listed` with
        # NO listing transition in the trail - which is the state 146 of today's 4368 listed units are
        # actually in, and the one case the endpoint must refuse to guess at. The trigger enforces the
        # ladder one rung at a time, so it is walked a statement at a time, and the two CHECKs
        # (listed => grade, listed => price) are satisfied as each rung is reached.
        async with eng.begin() as c:
            await c.execute(text("UPDATE assets SET status = 'tested' WHERE id = :i"), {"i": aid})
            await c.execute(text("UPDATE assets SET status = 'graded', grade = 'B' WHERE id = :i"), {"i": aid})
            await c.execute(text("UPDATE assets SET status = 'listed', sale_price_cents = 19900 WHERE id = :i"), {"i": aid})
        listed_untrailed = await _stale(h)
        assert listed_untrailed - base == 0, ("a listed unit with no recorded listing is not counted",
                                              base, listed_untrailed)

        # (1) its listing is three months old -> it counts
        await _log_listing(aid, "100 days")
        aged = await _stale(h)
        assert aged - base == 1, (base, aged)

        # (2) the same unit goes back up today -> it is young again, and the MAX is what makes it so
        await _log_listing(aid, "0 days")
        relisted = await _stale(h)
        assert relisted - base == 0, (base, relisted)

        # and the endpoint agrees with the database's own answer to the same question, which is the
        # claim that does not depend on this fixture being the only stale unit in a shared database
        async with eng.begin() as c:
            db_count = (await c.execute(text("""
                SELECT count(*)
                FROM assets a
                JOIN (SELECT entity_id, max(at) AS listed_at
                      FROM audit_log
                      WHERE action = 'status' AND entity = 'asset' AND after->>'status' = 'listed'
                      GROUP BY entity_id) e ON e.entity_id = a.id
                WHERE a.status = 'listed' AND e.listed_at < now() - interval '90 days'
            """))).scalar_one()
        assert relisted == db_count, (relisted, db_count)
    finally:
        async with eng.begin() as c:
            await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                                 "(SELECT id FROM staff_users WHERE email = :e)"), {"e": admin_email})
            await c.execute(text("DELETE FROM staff_users WHERE email = :e"), {"e": admin_email})
