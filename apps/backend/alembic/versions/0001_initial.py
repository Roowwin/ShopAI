from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

DDL = r'''
-- ============ IDENTITY (customers) ============
CREATE TABLE users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  email CITEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE password_credentials (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE oauth_identities (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  email_at_provider TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject)
);
CREATE INDEX oauth_identities_user_idx ON oauth_identities (user_id);

CREATE TABLE email_tokens (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify','reset')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX email_tokens_user_idx ON email_tokens (user_id);
CREATE INDEX email_tokens_hash_idx ON email_tokens (token_hash);

-- ============ STAFF ============
CREATE TABLE staff_users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  email CITEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('admin','manager','technician','warehouse','sales')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  totp_secret TEXT NULL,
  totp_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE staff_passwords (
  staff_id BIGINT PRIMARY KEY REFERENCES staff_users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL
);

-- ============ CATALOG ============
CREATE TABLE brands (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parent_id BIGINT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX categories_parent_idx ON categories (parent_id);

CREATE TABLE products (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  brand_id BIGINT NOT NULL REFERENCES brands(id),
  category_id BIGINT NOT NULL REFERENCES categories(id),
  model TEXT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  specs JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX products_brand_idx ON products (brand_id);
CREATE INDEX products_category_idx ON products (category_id);
CREATE INDEX products_status_idx ON products (status);

CREATE TABLE product_media (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'image' CHECK (kind IN ('image','video','doc')),
  position INT NOT NULL DEFAULT 0,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  alt_text TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX product_media_product_idx ON product_media (product_id);

-- ============ SERIALIZED ASSETS ============
CREATE TABLE assets (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  product_id BIGINT NULL REFERENCES products(id),
  serial_number CITEXT NULL,
  imei TEXT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN
    ('received','tested','in_repair','graded','listed','reserved','sold','shipped','returned','scrapped')),
  grade TEXT NULL CHECK (grade IN ('A','B','C','D')),
  cost_cents BIGINT NULL CHECK (cost_cents >= 0),
  intake_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  location TEXT NULL,
  condition_report JSONB NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'listed' OR grade IS NOT NULL)
);
CREATE UNIQUE INDEX uq_assets_serial ON assets (serial_number) WHERE serial_number IS NOT NULL;
CREATE INDEX assets_product_idx ON assets (product_id);
CREATE INDEX assets_status_idx ON assets (status);

CREATE FUNCTION rfo_touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION rfo_assets_check_status() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF (OLD.status, NEW.status) IN (
        ('received','tested'),('received','scrapped'),
        ('tested','in_repair'),('tested','graded'),('tested','scrapped'),
        ('in_repair','tested'),('in_repair','graded'),('in_repair','scrapped'),
        ('graded','listed'),('graded','scrapped'),
        ('listed','reserved'),('listed','sold'),('listed','scrapped'),
        ('reserved','sold'),('reserved','listed'),
        ('sold','shipped'),('sold','returned'),
        ('shipped','returned'),
        ('returned','tested'),('returned','scrapped')) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'illegal asset transition % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_assets_status BEFORE UPDATE ON assets
FOR EACH ROW EXECUTE FUNCTION rfo_assets_check_status();
CREATE TRIGGER trg_assets_touch BEFORE UPDATE ON assets
FOR EACH ROW EXECUTE FUNCTION rfo_touch_updated_at();

-- ============ LEDGER (partitioned, append-only) ============
CREATE TABLE stock_movements (
  id BIGINT GENERATED ALWAYS AS IDENTITY,
  moved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  asset_id BIGINT NOT NULL REFERENCES assets(id),
  qty INT NOT NULL CHECK (qty <> 0),
  reason TEXT NOT NULL,
  actor_staff_id BIGINT NULL,
  PRIMARY KEY (id, moved_at)
) PARTITION BY RANGE (moved_at);
CREATE INDEX stock_movements_asset_idx ON stock_movements (asset_id);

CREATE FUNCTION rfo_create_stock_month(p_year INT, p_month INT) RETURNS void AS $fn$
DECLARE
  v_start DATE := make_date(p_year, p_month, 1);
  v_end   DATE := (v_start + INTERVAL '1 month')::date;
  v_name  TEXT := 'stock_movements_' || p_year::text || '_' || lpad(p_month::text, 2, '0');
BEGIN
  IF to_regclass('public.' || v_name) IS NULL THEN
    EXECUTE format('CREATE TABLE %I PARTITION OF stock_movements FOR VALUES FROM (%L) TO (%L)', v_name, v_start, v_end);
    EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM rfo_app', v_name);
  END IF;
END $fn$ LANGUAGE plpgsql;

DO $$
DECLARE t timestamptz := date_trunc('month', now()); i INT;
BEGIN
  FOR i IN 0..5 LOOP
    PERFORM rfo_create_stock_month(EXTRACT(YEAR FROM t)::int, EXTRACT(MONTH FROM t)::int);
    t := t + INTERVAL '1 month';
  END LOOP;
END $$;

-- ============ RESERVATIONS (double-buy guard) ============
CREATE TABLE reservations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  asset_id BIGINT NOT NULL REFERENCES assets(id),
  customer_id BIGINT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','confirmed','released','converted')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_res_active_asset ON reservations (asset_id) WHERE status IN ('active','confirmed');
CREATE INDEX reservations_asset_idx ON reservations (asset_id);
CREATE INDEX reservations_customer_idx ON reservations (customer_id);
CREATE INDEX reservations_expires_idx ON reservations (expires_at) WHERE status IN ('active','confirmed');

-- ============ ORDERS (AUD cents, AU/NZ GST) ============
CREATE TABLE orders (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  customer_id BIGINT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','shipped','delivered','cancelled','refunded')),
  currency CHAR(3) NOT NULL DEFAULT 'AUD' CHECK (currency = 'AUD'),
  subtotal_cents BIGINT NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  tax_cents BIGINT NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  shipping_cents BIGINT NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0),
  total_cents BIGINT NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  shipping_country CHAR(2) NOT NULL CHECK (shipping_country IN ('AU','NZ')),
  ship_to_name TEXT NULL, ship_line1 TEXT NULL, ship_line2 TEXT NULL,
  ship_city TEXT NULL, ship_state TEXT NULL, ship_postcode TEXT NULL,
  placed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (total_cents = subtotal_cents + tax_cents + shipping_cents)
);
CREATE INDEX orders_customer_idx ON orders (customer_id);
CREATE INDEX orders_status_idx ON orders (status);
CREATE TRIGGER trg_orders_touch BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION rfo_touch_updated_at();

CREATE TABLE order_lines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id),
  asset_id BIGINT NULL UNIQUE REFERENCES assets(id),
  product_id BIGINT NULL REFERENCES products(id),
  qty INT NOT NULL DEFAULT 1 CHECK (qty > 0),
  sku_title TEXT NOT NULL,
  unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents >= 0),
  line_total_cents BIGINT NOT NULL CHECK (line_total_cents >= 0)
);
CREATE INDEX order_lines_order_idx ON order_lines (order_id);
CREATE INDEX order_lines_product_idx ON order_lines (product_id);

CREATE TABLE order_tax_lines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id),
  jurisdiction TEXT NOT NULL CHECK (jurisdiction IN ('AU_GST','NZ_GST')),
  rate_bp INT NOT NULL CHECK (rate_bp IN (1000,1500)),
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0)
);
CREATE INDEX order_tax_lines_order_idx ON order_tax_lines (order_id);

CREATE TABLE payments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id),
  provider TEXT NULL,
  provider_ref TEXT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  status TEXT NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated','succeeded','failed','refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payments_order_idx ON payments (order_id);

-- ============ PROMOTIONS (offers/sales) ============
CREATE TABLE promotions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('percent','fixed')),
  value BIGINT NOT NULL CHECK (value > 0),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE product_promotions (
  product_id BIGINT NOT NULL REFERENCES products(id),
  promotion_id BIGINT NOT NULL REFERENCES promotions(id),
  PRIMARY KEY (product_id, promotion_id)
);
CREATE INDEX product_promotions_promotion_idx ON product_promotions (promotion_id);

-- ============ AUDIT (append-only) ============
CREATE TABLE audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('staff','system','customer')),
  actor_id BIGINT NULL,
  entity TEXT NOT NULL,
  entity_id BIGINT NULL,
  action TEXT NOT NULL,
  before JSONB NULL,
  after JSONB NULL,
  meta JSONB NULL
);
CREATE INDEX audit_entity_idx ON audit_log (entity, entity_id);
CREATE INDEX audit_at_idx ON audit_log (at DESC);

-- append-only guarantees: app role never mutates or deletes
REVOKE UPDATE, DELETE ON audit_log FROM rfo_app;
REVOKE UPDATE, DELETE ON stock_movements FROM rfo_app;
'''

def upgrade():
    op.execute(DDL)

def downgrade():
    op.execute("DROP TABLE IF EXISTS product_promotions, promotions, payments, order_tax_lines, order_lines, orders,"
               " reservations, stock_movements, audit_log, assets, product_media, products, categories, brands,"
               " email_tokens, oauth_identities, password_credentials, staff_passwords, staff_users, users CASCADE;")
    op.execute("DROP FUNCTION IF EXISTS rfo_assets_check_status, rfo_touch_updated_at, rfo_create_stock_month;")