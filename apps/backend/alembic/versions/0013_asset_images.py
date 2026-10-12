"""the Asset Studio's media: the uploaded file, its per-asset assignment, and a lot's grade templates

Three tables, and the reason there are three rather than one.

* `media_objects` holds the BYTES, once per upload.
* `asset_images` holds an ASSIGNMENT: this asset shows this file. "Apply to all model" is the
  reason the two are split - it writes one assignment row per matching unit, so a 4 MB photo
  applied across a box of twenty costs twenty small rows instead of eighty megabytes. It is also
  what makes the button idempotent: the UNIQUE (asset_id, media_id) plus ON CONFLICT DO NOTHING
  means a second press adds nothing rather than duplicating every row.
* `lot_grade_templates` is the reference photo for a grade WITHIN A LOT - a judgement about a
  batch, which is why it hangs off `lots` and not off an asset, and why it is keyed (lot_id, grade):
  one template per grade per lot, and assigning a new one REPLACES the old rather than accumulating.

THE THREE `*_by` COLUMNS CARRY NO FOREIGN KEY, and that is the rule this schema already keeps for
every actor: `stock_movements.actor_staff_id` and `audit_log.actor_id` are bare BIGINTs too. A
media row is a record of what somebody DID, so it must not pin the identity that did it - and here
that is not a matter of taste: the suite's per-file teardown sweeps `DELETE FROM staff_users WHERE
email LIKE 'pytest-%'`, and an FK from a table the sweep does not name makes that DELETE fail with
a 23503. The first cut of this migration had the FKs and took 35 tests and 49 errors down with it.
The actor is still named; `audit_log` is where a name is joined back on, and the row survives the
identity exactly as the ledger does.

THE BYTES LIVE IN POSTGRES, deliberately. The stack has a moto object store, but nothing in
apps/backend talks to it (no boto3, no bucket env on the api service) and it is reachable only over
the compose network: a browser needs a URL it can fetch with the staff session. Keeping the bytes
behind /staff means an asset photo is not world-readable, and it needs no new dependency, no new
bucket policy and no second origin. The cap is 5 MiB and the type is a whitelist, both enforced by
CHECK here and again in the door (a 413/422 with a reason beats a 23514). If unit photography ever
outgrows this, `media_objects` is the row to repoint at the bucket - `asset_images` and the
templates reference it by id and would not move.

No GRANTs: infra/postgres/init/01-roles.sh sets ALTER DEFAULT PRIVILEGES for rfo_migrator, so every
table created from here is SELECT/INSERT/UPDATE/DELETE for rfo_app automatically. Nothing in this
migration is made append-only (unlike stock_movements): a mis-taken photo has to be removable, and
the trail of who put it there is the audit row the door writes, not the row's survival.

The downgrade drops exactly these three tables. It cannot restore anything about them: the bytes
have no other home, so a downgrade is also what deletes the studio's media.
"""

from alembic import op

revision = "0013_asset_images"
down_revision = "0012_catalog_v2"
branch_labels = None
depends_on = None

DDL = r'''
CREATE TABLE media_objects (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL
    CHECK (content_type IN ('image/jpeg','image/png','image/webp','image/gif')),
  byte_size BIGINT NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  bytes BYTEA NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by BIGINT NULL
);

CREATE TABLE asset_images (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_id BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  media_id BIGINT NOT NULL REFERENCES media_objects(id) ON DELETE CASCADE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by BIGINT NULL,
  applied_by_bulk BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (asset_id, media_id)
);
CREATE INDEX asset_images_asset_idx ON asset_images (asset_id);
CREATE INDEX asset_images_media_idx ON asset_images (media_id);

CREATE TABLE lot_grade_templates (
  lot_id BIGINT NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  grade CHAR(1) NOT NULL CHECK (grade IN ('A','B','C','D')),
  media_id BIGINT NOT NULL REFERENCES media_objects(id) ON DELETE CASCADE,
  set_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  set_by BIGINT NULL,
  PRIMARY KEY (lot_id, grade)
);
CREATE INDEX lot_grade_templates_media_idx ON lot_grade_templates (media_id);
'''

def upgrade():
    op.execute(DDL)

def downgrade():
    op.execute("DROP TABLE IF EXISTS lot_grade_templates;")
    op.execute("DROP TABLE IF EXISTS asset_images;")
    op.execute("DROP TABLE IF EXISTS media_objects;")
