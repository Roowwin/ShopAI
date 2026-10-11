"""catalog v2: the new categories and brands the ~50-product demo catalog needs (additive only)

The storefront reads categories and brands live, and `POST /staff/products` refuses (422) any slug
it does not know - so catalog v2's spread over desktops, monitors, networking, accessories, parts
and processors needs its own category and brand rows before the seeder can create a single one of
them. This migration inserts exactly those rows: no column, constraint, index or default anywhere
changes.

The rows go in with a bare `ON CONFLICT DO NOTHING` rather than 0002's `ON CONFLICT (slug)`: both
tables carry TWO unique columns (`name` and `slug`), and a name already taken under another slug
must not abort the migration. `lg` and `netgear` are here because the catalog's monitor and
networking spreads are Dell/HP/LG and Cisco/TP-Link/Netgear respectively; every other slug is the
set the spec named.

The downgrade deletes the rows this migration inserted, verbatim-restoring the pre-0012 catalog.
One thing it deliberately does NOT do, inherited from the 0002 pattern: delete the products the
seeder later creates in these categories. They reference `category_id`, so once the seeder has run
these DELETEs raise a foreign-key error until those products (and their assets) are removed first.
"""

from alembic import op

revision = "0012_catalog_v2"
down_revision = "0011_autonomy_grants"
branch_labels = None
depends_on = None

SQL = """
INSERT INTO categories (name, slug) VALUES
  ('Desktops','desktops'), ('Monitors','monitors'), ('Networking','networking'),
  ('Accessories','accessories'), ('Parts','parts'), ('Processors','processors')
ON CONFLICT DO NOTHING;

INSERT INTO brands (name, slug) VALUES
  ('Lenovo','lenovo'), ('Dell','dell'), ('HP','hp'), ('ASUS','asus'), ('Logitech','logitech'),
  ('Cisco','cisco'), ('TP-Link','tp-link'), ('Netgear','netgear'), ('Intel','intel'), ('AMD','amd'),
  ('Kingston','kingston'), ('Seagate','seagate'), ('LG','lg')
ON CONFLICT DO NOTHING;
"""


def upgrade():
    op.execute(SQL)


def downgrade():
    op.execute("DELETE FROM categories WHERE slug IN "
               "('desktops','monitors','networking','accessories','parts','processors');")
    op.execute("DELETE FROM brands WHERE slug IN "
               "('lenovo','dell','hp','asus','logitech','cisco','tp-link','netgear',"
               "'intel','amd','kingston','seagate','lg');")
