"""product_groups: one image and one hand-set price per brand + model + grade

WHY A NEW TABLE RATHER THAN A COLUMN SOMEWHERE. Everything the shop sells is already grouped by
`products` (one row per brand + model), and every fact about a single unit already lives on
`assets`. Neither can hold this: a `products` row spans all four grades, so it cannot carry one
photo and one price PER GRADE, and storing them on `assets` is what the importer already does -
which is precisely why one keyboard of Grade A arrives priced $307.05, $320.60, $269.21, $53.72 and
$242.55, five different prices for identical stock. The group is the level at which the operator
actually makes the decision: "a Grade A 125 Wired USB Keyboard is worth this much and looks like
this", said once, for every lot that will ever contain one.

THE NATURAL KEY IS (brand_id, lower(model), grade) AND DELIBERATELY NOT product_id. `_resolve_product`
keys a product on (brand, category, model), so the same model arriving on a second sheet whose
Category column is spelled differently mints a SECOND product row - `_category_spellings` exists to
paper over the common cases, not all of them. A group keyed on product_id would fork with it, and the
operator would be asked for an image and a price they had already given. Keying on brand + model
ignores the category, which is the point: the shop's own pricing comparables already pool by model
and grade rather than by product (see services/pricing.py).

`storefront_id` IS NULL UNTIL THE GROUP IS FIRST PUBLISHED, and that null is the question a later
import asks: "is this model+grade already set up?" Non-null means an image and a price have been
given and published, so a re-import skips straight to publishing the new units instead of asking
again. It is minted at publish rather than at insert because a UUID handed out to a group nobody has
configured would answer that question yes before it is true.

`price_override` IS THE ONLY PRICE THIS TABLE KNOWS and it is set by hand. FMV, Resale and
"FMV + 60%" are suggestions the screen fills the box with; none of them is written here without a
person pressing Save. Publish reads this column and refuses when it is null - a group with no
opinion about its price must not reach the shop floor, and `assets.sale_price_cents` (0006) is
written FROM it at publish time so `chk_listed_has_price` and the margin floor keep working
unchanged.

THE BACKFILL SEEDS ONE GROUP PER (brand, model, grade) ALREADY IN STOCK, all of them unpublished and
unpriced: the operator's worklist is exactly the set of decisions not yet made, and starting it
empty would mean retyping 295 model strings by hand. `DISTINCT ON` with an ORDER BY that ends on
`p.id, p.model` picks one spelling deterministically when two products disagree only in case, so
re-running the migration on a restored dump yields the same rows rather than whichever the planner
happened to return.

NO GRANTs, and no actor FK, both for the reasons 0013 states at length: infra/postgres/init/
01-roles.sh wires ALTER DEFAULT PRIVILEGES for rfo_migrator, and an FK from `set_by` to staff_users
would make the suite's `DELETE FROM staff_users WHERE email LIKE 'pytest-%'` teardown fail.
"""

from alembic import op

revision = "0024_product_groups"
down_revision = "0023_unlist_edge"
branch_labels = None
depends_on = None

DDL = r'''
CREATE TABLE product_groups (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  brand_id BIGINT NOT NULL REFERENCES brands(id),
  model TEXT NOT NULL CHECK (btrim(model) <> ''),
  grade CHAR(1) NOT NULL CHECK (grade IN ('A','B','C','D')),
  storefront_id UUID UNIQUE,
  product_id BIGINT REFERENCES products(id),
  media_id BIGINT REFERENCES media_objects(id) ON DELETE SET NULL,
  image_url TEXT,
  price_override BIGINT CHECK (price_override >= 0),
  price_source TEXT CHECK (price_source IN ('fmv','resale','custom')),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX product_groups_key_uidx ON product_groups (brand_id, lower(model), grade);
CREATE INDEX product_groups_product_idx ON product_groups (product_id);
CREATE INDEX product_groups_media_idx ON product_groups (media_id);
-- The screen's default filter is "everything I have not set up yet", which is `storefront_id IS
-- NULL` - a partial index so that read stays cheap as the configured set grows and the unconfigured
-- one drains.
CREATE INDEX product_groups_setup_idx ON product_groups (brand_id, lower(model), grade)
  WHERE storefront_id IS NULL;

CREATE TRIGGER trg_product_groups_touch BEFORE UPDATE ON product_groups
FOR EACH ROW EXECUTE FUNCTION rfo_touch_updated_at();
'''

BACKFILL = r'''
INSERT INTO product_groups (brand_id, model, grade)
SELECT DISTINCT ON (p.brand_id, lower(p.model), a.grade)
       p.brand_id, p.model, a.grade
FROM assets a
JOIN products p ON p.id = a.product_id
WHERE a.grade IS NOT NULL
  AND btrim(p.model) <> ''
ORDER BY p.brand_id, lower(p.model), a.grade, p.id, p.model;
'''


def upgrade():
    op.execute(DDL)
    op.execute(BACKFILL)


def downgrade():
    # Dropping the table drops the groups, the images they POINT at stay in `media_objects` - a group
    # row references bytes, it does not own them, and the same file may be an asset's photo too.
    op.execute("DROP TABLE IF EXISTS product_groups;")
