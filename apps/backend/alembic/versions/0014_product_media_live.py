"""the stock-photo table goes live: many photos per product, url-backed or byte-backed

`product_media` was created by 0001 and then never used - zero rows, zero references in any Python,
TypeScript or SQL in this repo. Product stock photography has been a single `products.image_url`
(set on 63 of 1,838 products). This migration is what turns the unused table into the real parent's
photo set, and it is deliberately ADDITIVE to `image_url`: that column stays, keeps its values, and
the storefront keeps reading it, because the storefront is not this job's to change.

TWO KINDS OF ROW, AND WHY ONE COLUMN COULD NOT HOLD BOTH.

* A URL-BACKED row has `storage_key` set - the address the catalog already had. The 63 existing
  stock photos are backfilled as exactly this, so nothing is lost and nothing is re-fetched.
* A BYTE-BACKED row has `media_id` set and reuses `media_objects` from 0013. That is the same
  decision 0013 made for unit photography and for the same reasons: the bytes go in Postgres, behind
  the session-guarded door, with no new dependency, no bucket policy and no second origin. A product
  photo could have had its own byte table; it does not, because two byte stores would be two places
  to point at the bucket later.

`storage_key` therefore becomes NULLABLE and a CHECK keeps the row honest - a row must carry a
source, whichever kind it is. The CHECK is what stops a future writer from inserting a row that
points at nothing and renders as a broken tile.

THE TWO UNIQUE INDEXES ARE INVARIANTS, NOT DE-DUPLICATORS. `(product_id, media_id)` where
`media_id IS NOT NULL` is the idempotency key the upload door leans on, mirroring
`asset_images`'s `(asset_id, media_id)`: attaching one file to one product twice is a no-op. And
`(product_id) WHERE is_primary` is the one this table never had - a product has at most ONE primary
photo, because a card renders one, and two rows claiming it would make the choice depend on scan
order. The upload door computes the flag rather than letting a caller set it.

The downgrade reverses all of it: it deletes the byte-backed rows (the bytes have no other home, so
this is also what discards them), deletes the url-mirrored rows this migration created, drops the
indexes, the CHECK and the column, and restores `storage_key` NOT NULL. Anything a product had
before this migration is either still in `image_url` or was already gone.
"""

from alembic import op

revision = "0014_product_media_live"
down_revision = "0013_asset_images"
branch_labels = None
depends_on = None

DDL = r'''
-- A url-backed row carries storage_key; a byte-backed one carries media_id. Exactly one is
-- required, so the column that can now be either had to stop being NOT NULL.
ALTER TABLE product_media ALTER COLUMN storage_key DROP NOT NULL;

ALTER TABLE product_media
  ADD COLUMN IF NOT EXISTS media_id BIGINT NULL REFERENCES media_objects(id) ON DELETE CASCADE;

ALTER TABLE product_media
  ADD CONSTRAINT product_media_src_chk CHECK (storage_key IS NOT NULL OR media_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS product_media_product_media_uidx
  ON product_media (product_id, media_id) WHERE media_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS product_media_product_key_uidx
  ON product_media (product_id, storage_key) WHERE storage_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_media_media_idx ON product_media (media_id);
CREATE UNIQUE INDEX IF NOT EXISTS product_media_one_primary_uidx
  ON product_media (product_id) WHERE is_primary;
'''

# The 63 products that already had a photo URL become real media rows, in place, as their primary
# image. `btrim` guards the blank string (an empty url is not a photo, and 0008's column is TEXT).
# NOT EXISTS keeps the backfill re-runnable and keeps it away from any product a later upload door
# has already given rows to.
BACKFILL = r'''
INSERT INTO product_media (product_id, storage_key, kind, position, is_primary, alt_text)
SELECT p.id, btrim(p.image_url), 'image', 0, true, p.title
FROM products p
WHERE p.image_url IS NOT NULL
  AND btrim(p.image_url) <> ''
  AND NOT EXISTS (SELECT 1 FROM product_media pm WHERE pm.product_id = p.id);
'''


def upgrade():
    op.execute(DDL)
    op.execute(BACKFILL)


def downgrade():
    # Byte-backed rows first: their only copy of the bytes is the media_objects row they point at,
    # and dropping the column while they exist would leave orphans nothing can reach.
    op.execute("DELETE FROM product_media WHERE media_id IS NOT NULL;")
    # Then the rows this migration's backfill created - recognised by mirroring the product's own
    # url. Rows a person added through the door in the meantime are not touched here; they keep
    # their storage_key and survive the column drop with it.
    op.execute("DELETE FROM product_media pm USING products p "
               "WHERE pm.product_id = p.id AND pm.media_id IS NULL "
               "AND pm.storage_key = btrim(p.image_url);")
    op.execute("DROP INDEX IF EXISTS product_media_one_primary_uidx;")
    op.execute("DROP INDEX IF EXISTS product_media_media_idx;")
    op.execute("DROP INDEX IF EXISTS product_media_product_key_uidx;")
    op.execute("DROP INDEX IF EXISTS product_media_product_media_uidx;")
    op.execute("ALTER TABLE product_media DROP CONSTRAINT IF EXISTS product_media_src_chk;")
    op.execute("ALTER TABLE product_media DROP COLUMN IF EXISTS media_id;")
    op.execute("ALTER TABLE product_media ALTER COLUMN storage_key SET NOT NULL;")
