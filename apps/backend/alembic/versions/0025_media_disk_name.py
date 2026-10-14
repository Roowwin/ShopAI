"""media_objects: the name this file is written under in the media folder

WHY A COLUMN AND NOT A CONVENTION. Uploaded bytes now also land as a real file in a folder on the
host, so somebody can open it in Explorer, copy it, back it up, or hand the whole lot to a CDN. The
file has to be NAMEABLE, and the name cannot be derived from anything already on the row: the
folder is uploaded before a group has claimed any of it, so two photographs called `IMG_4471.jpg`
are two rows with the same `filename` and nothing else to tell them apart.

`disk_name` is therefore what was actually written, and it carries a short prefix of the row's
`public_id` so it cannot collide while staying readable: `3f2a9c11-IMG_4471.jpg`.

NULL IS A REAL STATE AND NOT A MISSING ONE. Every row that predates this migration has no file on
disk, and a row whose file could not be written - the folder is missing, read-only, or the disk is
full - keeps its bytes in the database and stays perfectly usable, because THE DATABASE REMAINS THE
SOURCE OF TRUTH for what the shop serves. The folder is a copy for a person to look at. A non-null
`disk_name` means "there is a file at this name", nothing more, and a missing file breaks nothing
except that person's expectation - which is the trade this makes on purpose: a shop whose images
vanish because a folder was moved would be a far worse failure than a folder that drifts.

It is also the key a move to object storage needs (ADR 0001 wants media in MinIO/S3, deliberately
not done yet because the dev stack's object store is in-memory - see services/media.py). An S3
cutover reads this column as the object key and writes it for new rows; the shop's serving path
does not move either way.
"""

from alembic import op

revision = "0025_media_disk_name"
down_revision = "0024_product_groups"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE media_objects ADD COLUMN IF NOT EXISTS disk_name TEXT NULL;")
    # The export script and any reconciliation walk the rows that HAVE a file, so the index is
    # partial: most rows may never have one, and a partial index on "has a file" is a fraction of
    # the size of one on every row.
    op.execute("CREATE INDEX IF NOT EXISTS media_objects_disk_idx ON media_objects (disk_name) "
               "WHERE disk_name IS NOT NULL;")


def downgrade():
    # The files on disk are NOT touched. Dropping the column loses the only record of what was
    # written, but deleting a person's folder is not this migration's to do - and the bytes are
    # still in the row either way.
    op.execute("DROP INDEX IF EXISTS media_objects_disk_idx;")
    op.execute("ALTER TABLE media_objects DROP COLUMN IF EXISTS disk_name;")
