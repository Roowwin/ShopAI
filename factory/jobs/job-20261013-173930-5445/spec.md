# Parent-Child 2: product stock photos via product_media + staff product-detail returning ALL assets

## Context
The parent/child shape is already in the schema and is NOT to be rebuilt. `products` (0001_initial.py:85,
`catalog.py:30`) is the PARENT - brand, category, model, title, description, specs, `image_url`
(added by 0008). `assets.product_id` (`warehouse.py:33`, index `assets_product_idx`) is the CHILD
link, and the importer already groups by brand + model at write time
(`staff_imports._resolve_product`). `GET /catalog/{slug}` already returns a product with its listed
units. Creating another product table, another FK, or another grouping rule would brick this.

Two real gaps remain, and this job is only those two.

1. `product_media` is DEAD CODE. `0001_initial.py:103` created it for multiple stock photos per
   product (product_id, storage_key, kind, position, is_primary, alt_text) - and nothing has ever
   written or read one row: zero references in any `.py`/`.ts`/`.tsx`/`.sql`, zero rows. Product
   stock photography is a single `products.image_url` (set on 63 of 1,838 products).
2. There is NO staff-side product detail. `GET /catalog/{slug}` (`store_catalog.py:225`) is the
   storefront's view: it returns `units` FILTERED to `status='listed'` on active lots. Nothing
   returns a product with EVERY asset - including received, graded, unlisted and sold ones.

## Deliverable

* `alembic/versions/0014_product_media_live.py` - makes `product_media` live and populated:
  * `storage_key` becomes NULLABLE; new `media_id BIGINT NULL REFERENCES media_objects(id) ON DELETE CASCADE`
    so a stock photo's BYTES reuse the 0013 `media_objects` table (no second byte store).
  * CHECK (storage_key IS NOT NULL OR media_id IS NOT NULL) - a row must have a source.
  * Unique partial index (product_id, media_id) WHERE media_id IS NOT NULL (the idempotency key,
    mirroring `asset_images`), index on media_id, and a unique partial index on (product_id)
    WHERE is_primary - one primary stock photo per product, which is what a card renders.
  * BACKFILL: every product with a non-blank `image_url` and no media row yet gets one row
    (storage_key = image_url, is_primary = true, alt_text = title). `image_url` is NOT modified or
    dropped - the storefront still reads it, and this job does not touch the frontend.
  * Downgrade: delete the byte-backed rows and the url-mirrored rows, drop the indexes/constraint/
    column, restore `storage_key` NOT NULL.
* `app/api/v1/staff_ops.py` - the two write doors, both `require_roles("admin","manager")` and
  audited, reusing the 0013 upload rules (raster whitelist, 5 MiB cap, sniffed type):
  * `POST /staff/products/{product_id}/media` - upload one stock photo (multipart `file`, optional
    `alt_text`): one `media_objects` row + one `product_media` row, `is_primary` true only when the
    product has none, `position` = max+1.
  * `DELETE /staff/products/{product_id}/media/{media_row_id}` - remove one assignment, and the
    `media_objects` row only when no other product_media row still references it.
* `app/api/v1/staff_views.py` - the two reads, `require_roles(*READ_ROLES)`:
  * `GET /staff/products/{product_id}` - the PARENT plus `media[]` (url-backed and byte-backed,
    primary first) and `assets[]` - EVERY child, no status filter, each with its status, grade,
    prices, location and lot. Plus `asset_count` and a `status_counts` breakdown.
  * `GET /staff/products/{product_id}/media/{media_row_id}/raw` - the bytes, addressed by the
    product_media row id AND the product, `nosniff`.
* `tests/test_product_media.py` - the new suite.

## Acceptance
* Gate: `docker compose run --rm api pytest -q` with the accepted 3 deselects - report the exact
  passed/failed counts, before and after, so a delta is attributable. NO NEW failures.
* New tests prove, against the live DB:
  * an upload writes one `media_objects` row and one `product_media` row (the bytes do not move);
  * a second upload does NOT become primary, and `position` increments;
  * a non-raster content type is 422 and an oversized file is 413;
  * the detail read returns url-backed (backfilled) AND byte-backed media together;
  * the detail read returns ALL assets - a `received`, an unlisted and a `listed` one - where
    `/catalog/{slug}` returns only the listed one (the difference is the acceptance);
  * raw bytes come back with the sniffed content type and `nosniff`;
  * a `warehouse`/`sales` token gets 403 on both new doors;
  * the delete removes the assignment and leaves the other product's media alone.
* `apps/storefront` and `apps/backoffice` untouched (state it).

## Constraints
- Work only on branch factory/job-20261013-173930-5445 (git worktree provided)
- LF / no BOM; PS 5.1 write rules
- Run: docker compose run --rm api pytest -q   (must be green)
- Do NOT touch: .env, secrets/, infra/nginx/certs/
- Backend boundary only: apps/backend/ and alembic/. The frontend is FORBIDDEN.
