"""Write every image the app already holds into the media folder.

WHY THIS EXISTS. New uploads land in the folder on their own (`services/media.store_upload` writes
the copy and records `disk_name`), but everything uploaded BEFORE that landed only in the database.
Without this the folder would be empty on a shop that already has photographs in it, which is a
confusing thing to hand somebody who asked for "one folder where all the images are".

IT IS ALSO THE RECONCILER. The folder is a copy, not the source of truth, so it can drift: a file
deleted by hand, a folder replaced, a database restored from a dump. Running this again fills in
whatever is missing and never touches a row that already has its file - so it is safe to re-run, and
safe to run on a shop that is live.

IDEMPOTENT AND SKIPPING, in that order. Rows that already have a `disk_name` whose file is present
are left completely alone; a row whose file has gone missing is rewritten; a row that has never had
one is written for the first time. Nothing is deleted, so this can only ever add files.

    docker compose run --rm api python scripts/export_media_to_disk.py
    docker compose run --rm api python scripts/export_media_to_disk.py --missing-only

`--missing-only` re-writes nothing that exists, which is the faster pass once the folder is built.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys

# The script lives beside the `app` package rather than inside it, so running it as a file puts
# `scripts/` on the path instead of the backend root. Derived rather than hard-coded to /app so the
# same file works from a checkout outside the container.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text  # noqa: E402

from app.core.db import get_engine  # noqa: E402
from app.services.media import disk_name_for, media_dir, write_to_disk  # noqa: E402


async def run(missing_only: bool) -> int:
    target = media_dir()
    try:
        os.makedirs(target, exist_ok=True)
    except OSError as e:
        print(f"the media folder {target!r} could not be created or opened: {e}")
        return 2
    if not os.access(target, os.W_OK):
        print(f"the media folder {target!r} is not writable by this process - check the mount")
        return 2
    print(f"media folder: {target}")

    eng = get_engine()
    written = skipped = failed = 0
    async with eng.begin() as conn:
        rows = (await conn.execute(text(
            "SELECT id, public_id::text AS public_id, filename, disk_name, bytes "
            "FROM media_objects ORDER BY id"))).mappings().all()
        print(f"{len(rows)} image(s) in the database")
        for r in rows:
            name = r["disk_name"] or disk_name_for(r["public_id"], r["filename"])
            on_disk = os.path.exists(os.path.join(target, name))
            if on_disk and (missing_only or r["disk_name"] == name):
                skipped += 1
                continue
            if not write_to_disk(name, bytes(r["bytes"])):
                failed += 1
                print(f"  ! {r['id']:>6} {name} - could not be written")
                continue
            if r["disk_name"] != name:
                await conn.execute(text("UPDATE media_objects SET disk_name = :d WHERE id = :i"),
                                   {"d": name, "i": r["id"]})
            written += 1

    print(f"written {written}, already there {skipped}, failed {failed}")
    return 0 if failed == 0 else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--missing-only", action="store_true",
                    help="do not rewrite a file that is already present")
    args = ap.parse_args()
    return asyncio.run(run(args.missing_only))


if __name__ == "__main__":
    raise SystemExit(main())
