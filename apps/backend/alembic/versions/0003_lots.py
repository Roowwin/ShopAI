from alembic import op

revision = "0003_lots"
down_revision = "0002_seed"
branch_labels = None
depends_on = None

DDL = r'''
CREATE TABLE lots (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  lot_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'intake' CHECK (status IN ('intake','active','completed','cancelled')),
  warehouse TEXT NULL,
  notes TEXT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE FUNCTION rfo_lots_check_status() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF (OLD.status, NEW.status) IN (
        ('intake','active'),('intake','cancelled'),
        ('active','completed'),('active','cancelled'),
        ('completed','active')) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'illegal lot transition % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lots_status BEFORE UPDATE ON lots
FOR EACH ROW EXECUTE FUNCTION rfo_lots_check_status();
CREATE TRIGGER trg_lots_touch BEFORE UPDATE ON lots
FOR EACH ROW EXECUTE FUNCTION rfo_touch_updated_at();

ALTER TABLE assets ADD COLUMN lot_id BIGINT NULL REFERENCES lots(id);
CREATE INDEX assets_lot_idx ON assets (lot_id);

INSERT INTO lots (lot_number, status, warehouse)
SELECT * FROM (VALUES
  ('LOT-2026-0001','intake','WH-A'),
  ('LOT-2026-0002','active','WH-A')
) AS v(lot_number, status, warehouse)
WHERE NOT EXISTS (SELECT 1 FROM lots WHERE lot_number IN ('LOT-2026-0001','LOT-2026-0002'));

UPDATE assets SET lot_id = (SELECT id FROM lots WHERE lot_number='LOT-2026-0001') WHERE serial_number='RX-SEED-001';
UPDATE assets SET lot_id = (SELECT id FROM lots WHERE lot_number='LOT-2026-0002') WHERE serial_number LIKE 'RX-BULK-%';

ALTER TABLE assets ALTER COLUMN lot_id SET NOT NULL;

UPDATE assets SET status='listed'
WHERE serial_number IN (SELECT 'RX-BULK-' || lpad(g::text,4,'0') FROM generate_series(1,10) g)
  AND status='graded';

CREATE VIEW v_storefront_assets AS
SELECT a.*, l.lot_number, l.updated_at AS lot_updated_at
FROM assets a JOIN lots l ON l.id = a.lot_id
WHERE l.status = 'active' AND a.status = 'listed';

CREATE FUNCTION rfo_lot_status_from_assets() RETURNS trigger AS $$
DECLARE
  v_lot BIGINT := COALESCE(NEW.lot_id, OLD.lot_id);
  v_listed INT;
BEGIN
  SELECT count(*) INTO v_listed FROM assets WHERE lot_id = v_lot AND status = 'listed';
  IF v_listed = 0 THEN
    UPDATE lots SET status='completed' WHERE id = v_lot AND status='active';
  ELSE
    UPDATE lots SET status='active' WHERE id = v_lot AND status='completed';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_assets_lot_status AFTER INSERT OR UPDATE ON assets
FOR EACH ROW EXECUTE FUNCTION rfo_lot_status_from_assets();
'''

def upgrade():
    op.execute(DDL)

def downgrade():
    op.execute("DROP VIEW IF EXISTS v_storefront_assets;")
    op.execute("DROP TRIGGER IF EXISTS trg_assets_lot_status ON assets;")
    op.execute("DROP TRIGGER IF EXISTS trg_lots_status ON lots;")
    op.execute("DROP TRIGGER IF EXISTS trg_lots_touch ON lots;")
    op.execute("DROP FUNCTION IF EXISTS rfo_lots_check_status, rfo_lot_status_from_assets;")
    op.execute("ALTER TABLE assets ALTER COLUMN lot_id DROP DEFAULT;")
    op.execute("ALTER TABLE assets DROP COLUMN lot_id;")
    op.execute("DROP TABLE lots;")
