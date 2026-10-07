from alembic import op

revision = "0002_seed"
down_revision = "0001_initial"
branch_labels = None
depends_on = None

SEED = r'''
INSERT INTO brands (name, slug) VALUES ('Apple','apple'),('Samsung','samsung')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (name, slug) VALUES ('Phones','phones'),('Laptops','laptops'),('Tablets','tablets')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO products (brand_id, category_id, model, title, slug, description, specs)
SELECT b.id, c.id, v.model, v.title, v.slug, v.descr, v.specs::jsonb
FROM (VALUES
 ('apple','phones','iPhone 13','Refurbished iPhone 13','iphone-13','Grade-b refurbished iPhone 13.','{"storage":"128GB","screen":"6.1in"}'),
 ('samsung','phones','Galaxy S21','Refurbished Galaxy S21','galaxy-s21','Grade-b refurbished Galaxy S21.','{"storage":"128GB","screen":"6.2in"}')
) AS v(b, c, model, title, slug, descr, specs)
JOIN brands b ON b.slug = v.b
JOIN categories c ON c.slug = v.c
ON CONFLICT (slug) DO NOTHING;

-- bulk stock: 1 unit on product #1, 4999 on product #2 (planner-honest selectivity for tests)
INSERT INTO assets (product_id, serial_number, status, grade, cost_cents)
SELECT 2, 'RX-BULK-' || lpad(g::text, 4, '0'), 'graded', 'B', 22000
FROM generate_series(1, 4999) g
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE serial_number = 'RX-BULK-' || lpad(g::text, 4, '0'));

INSERT INTO assets (product_id, serial_number, status, location)
SELECT 1, 'RX-SEED-001', 'received', 'WH-A-01-12'
ON CONFLICT DO NOTHING;

INSERT INTO promotions (name, kind, value, starts_at, ends_at, active)
SELECT 'AU Spring Sale', 'percent', 10, now(), now() + INTERVAL '30 days', true
WHERE NOT EXISTS (SELECT 1 FROM promotions WHERE name = 'AU Spring Sale');
'''

def upgrade():
    op.execute(SEED)

def downgrade():
    op.execute("DELETE FROM product_promotions WHERE promotion_id IN (SELECT id FROM promotions WHERE name='AU Spring Sale');")
    op.execute("DELETE FROM promotions WHERE name='AU Spring Sale';")
    op.execute("DELETE FROM assets WHERE serial_number LIKE 'RX-%';")
    op.execute("DELETE FROM products WHERE slug IN ('iphone-13','galaxy-s21');")
    op.execute("DELETE FROM categories WHERE slug IN ('phones','laptops','tablets');")
    op.execute("DELETE FROM brands WHERE slug IN ('apple','samsung');")