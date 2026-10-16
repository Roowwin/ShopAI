#!/usr/bin/env python
"""Publish the whole catalogue: one price, one photograph and one status walk per product group.

WHAT THIS IS. The backoffice does these three acts one group at a time - the Photo folder page puts
a folder of photographs into the pool, a group page offers the best-ranked one for a press, and
"Publish remaining lots" walks its units onto the shop floor. This script is the same three acts for
every group the catalogue has, driven through the same HTTP doors, so what it writes is
indistinguishable from an operator who did it by hand: same triggers, same audit rows, same margin
guard, same `storefront_id`.

WHAT IT WILL NOT DO - each of these is a decision, not an omission:

  * It does not re-price a group that already carries a price. "Keep all price resale" is a statement
    about what is on the shelf, and a priced group is a decision somebody already took.
  * It does not replace a photograph a group already has. The folder's files are named after the
    model, which makes them better CANDIDATES, not better pictures - a hand-attached photograph of
    the actual device outranks one that merely has the right words in its name.
  * It does not invent a price where the group's units carry no resale at all. Those groups are left
    unpriced, and the bulk publish names them in `skipped` - which is the honest answer, and the one
    the screen gives too.

THE PHOTOGRAPH IT ATTACHES IS THE TOP SUGGESTION, AND THAT IS WORTH SAYING OUT LOUD.
`services/group_image_match.py` is built as a suggestion a person looks at before pressing, and no
other door in the app attaches in bulk. Run this WITHOUT `--attach-images` and it prices and
publishes and leaves every photograph to a human. Run it with the flag and it takes the first
name-ranked candidate for each group that has no photograph - which is what "publish them with
matching image" asked for.

RUN IT - the api service bakes its source rather than mounting it, so a new file has to be copied in:

    docker compose cp apps/backend/scripts/publish_catalogue.py api:scripts/publish_catalogue.py
    docker compose exec api python scripts/publish_catalogue.py --attach-images --dry-run
    docker compose exec api python scripts/publish_catalogue.py --attach-images --limit 2
    docker compose exec api python scripts/publish_catalogue.py --attach-images

It signs in as an admin, creating one at `--admin-email` when that address has no staff row (the
password is printed once). Delete that staff row afterwards - it is a key to the whole backoffice.
"""
from __future__ import annotations

import argparse
import os
import sys
import time

# Invoked as ``python scripts/publish_catalogue.py``, Python puts scripts/ - not the app root - on
# sys.path, so ``import app`` would fail without this. Same line, same reason, as seed_demo.py.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from seed_demo import Api, ensure_admin  # noqa: E402  sibling script: the HTTP client and the login

# One bulk request may not name more than this - staff_groups.MAX_BULK_IDS. Both are capped for the
# same reason: a single press must not become an unbounded number of statements in one transaction.
BULK_MAX = 500

# .env sets RATE_LIMIT_STAFF_RPS=10, and a script that ignores it spends the run being told 429.
# One write per ~0.13s stays under the ceiling; the door is a person's tool, not a batch API.
THROTTLE = 0.13

PAGE = 200  # the worklist door's own `limit` cap


def pace() -> None:
    time.sleep(THROTTLE)


def all_groups(api: Api) -> list[dict]:
    """Every group, read through the worklist door the screen itself reads.

    `limit` is 200 at the door, so this walks pages rather than asking for a bigger one: a request
    for 500 would come back 422 and the script would report an empty catalogue as a clean one.
    """
    out: list[dict] = []
    offset = 0
    while True:
        r = api.need(api.get("/staff/product-groups", params={"limit": PAGE, "offset": offset}), 200)
        page = r.json()
        out += page
        if len(page) < PAGE:
            return out
        offset += PAGE


def median_resale(api: Api, group_id: int) -> int | None:
    """The group's own median Resale - the aggregate the screen's Resale quick-fill button reads.

    Read from the door rather than recomputed here, so this script and the button cannot disagree
    about what "the Resale price of this grade" means. It is computed on read from the units, so it
    is also the one number that stays right when the units change under it.
    """
    d = api.need(api.get(f"/staff/product-groups/{group_id}"), 200).json()
    return d["aggregates"]["resale"]["median"]


def attach_top(api: Api, group_id: int) -> str | None:
    """Claim the best-ranked pooled photograph for a group. Returns its filename, or None.

    An empty suggestion list is a normal answer and not a failure: it means the pool holds nothing
    whose name contains every word of this model, and that photograph has to be assigned by hand.
    """
    s = api.need(api.get(f"/staff/product-groups/{group_id}/image-suggestions"), 200).json()
    ranked = s.get("suggestions") or []
    if not ranked:
        return None
    top = ranked[0]
    api.need(api.post(f"/staff/product-groups/{group_id}/image/attach",
                      {"media_id": top["media_id"]}), 200)
    return top["filename"]


def publish(api: Api, ids: list[int]) -> dict:
    """Hand the whole list to the bulk door, in chunks it will accept. Returns its totals rolled up."""
    totals = {"groups_published": 0, "units_listed": 0, "units_skipped_already_listed": 0,
              "units_hidden_below_cost": 0, "groups_skipped": 0}
    skipped: list[dict] = []
    without_image: list[dict] = []
    for i in range(0, len(ids), BULK_MAX):
        chunk = ids[i:i + BULK_MAX]
        r = api.need(api.post("/staff/product-groups/publish", {"ids": chunk}), 200)
        j = r.json()
        for k in totals:
            totals[k] += j["totals"][k]
        skipped += j["skipped"]
        without_image += j["without_image"]
        pace()
    return {"totals": totals, "skipped": skipped, "without_image": without_image}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-url", default=os.environ.get("API_INTERNAL_URL", "http://api:8000"))
    ap.add_argument("--admin-email", default="publish-bot@rfo.local",
                    help="staff admin to sign in as; created when the address has no row")
    ap.add_argument("--admin-password", default=None,
                    help="password for an EXISTING --admin-email (otherwise a new one is made)")
    ap.add_argument("--attach-images", action="store_true",
                    help="attach the top-ranked pooled photograph to every group that has none")
    ap.add_argument("--limit", type=int, default=None,
                    help="work only the first N groups that need something (a smoke test)")
    ap.add_argument("--dry-run", action="store_true", help="say what would change; write nothing")
    a = ap.parse_args()

    api = Api(a.base_url)
    ensure_admin(api, a.admin_email, a.admin_password)

    groups = all_groups(api)
    todo = [g for g in groups
            if g["price_override"] is None or (a.attach_images and g["media_id"] is None)]
    if a.limit is not None:
        todo = todo[:a.limit]

    print(f"{len(groups)} groups; {len(todo)} need something"
          f"{' (dry run)' if a.dry_run else ''}")

    photographed, unphotographed, priced, priceless, failed = [], [], [], [], []
    ready: list[int] = []

    for n, g in enumerate(todo, 1):
        label = f"{g['brand']} {g['model']} / {g['grade']} (group {g['id']})"
        # THE PHOTOGRAPH, for a group that has none. Skip first when the flag is off, so a run
        # without it does not even ask the pool a question.
        if a.attach_images and g["media_id"] is None:
            if a.dry_run:
                # The pool question is a GET, so a dry run asks it and reports the truth - whether
                # this group would get a photograph at all. Only the claim is withheld. Reporting
                # "would attach" without asking is how a dry run comes back saying every group is
                # covered on a folder that names half of them.
                ranked = (api.need(api.get(f"/staff/product-groups/{g['id']}/image-suggestions"),
                                   200).json().get("suggestions") or [])
                pace()
                if not ranked:
                    unphotographed.append(label)
                else:
                    photographed.append(f"{label}: would claim {ranked[0]['filename']}")
            else:
                try:
                    name = attach_top(api, g["id"])
                except RuntimeError as e:
                    failed.append(f"{label}: image - {e}")
                    name = None
                if name is None:
                    unphotographed.append(label)
                else:
                    photographed.append(f"{label}: {name}")
                pace()

        # THE PRICE, for a group nobody has priced. `median` is None when not one unit of the grade
        # carries a resale, which leaves the group unpriced on purpose - see the module docstring.
        if g["price_override"] is None:
            median = median_resale(api, g["id"])
            pace()
            if median is None:
                priceless.append(label)
            elif a.dry_run:
                priced.append(f"{label}: would set {median} (resale)")
                ready.append(g["id"])
            else:
                try:
                    api.need(api.patch(f"/staff/product-groups/{g['id']}",
                                       {"price_override": int(median), "price_source": "resale"}), 200)
                except RuntimeError as e:
                    failed.append(f"{label}: price - {e}")
                else:
                    priced.append(f"{label}: {median} (resale)")
                    ready.append(g["id"])
                pace()
        else:
            ready.append(g["id"])

        if n % 25 == 0:
            print(f"  {n}/{len(todo)} …")

    print(f"\nphotograph: {len(photographed)} {'would claim' if a.dry_run else 'attached'}, "
          f"{len(unphotographed)} with no candidate")
    print(f"price:      {len(priced)} {'would set' if a.dry_run else 'set'}, "
          f"{len(priceless)} left unpriced (no resale on any unit)")
    if failed:
        print(f"failed:     {len(failed)}")
        for f in failed[:10]:
            print("  " + f)
    if a.dry_run:
        print(f"\nDRY RUN - would publish {len(ready)} groups. Nothing was written.")
        return 0

    print(f"\npublishing {len(ready)} groups …")
    result = publish(api, ready)
    t = result["totals"]
    print(f"published {t['groups_published']} groups, {t['units_listed']} units now on the shelf")
    print(f"  {t['units_skipped_already_listed']} units were already listed")
    print(f"  {t['units_hidden_below_cost']} units sit below their cost basis and the shop will hide them")
    print(f"  {t['groups_skipped']} groups held back: " +
          ", ".join(f"{s['brand']} {s['model']}/{s['grade']} ({s['reason']})"
                    for s in result["skipped"][:10]) if result["skipped"] else "  no group was held back")
    if result["without_image"]:
        print(f"  {len(result['without_image'])} published groups still have no photograph")
    return 0


if __name__ == "__main__":
    sys.exit(main())
