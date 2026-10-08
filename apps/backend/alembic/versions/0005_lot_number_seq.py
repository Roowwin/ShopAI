from alembic import op

revision = "0005_lot_number_seq"
down_revision = "0004_refresh_tokens"
branch_labels = None
depends_on = None

def upgrade():
    op.execute("CREATE SEQUENCE IF NOT EXISTS lot_number_seq START 1;")

def downgrade():
    op.execute("DROP SEQUENCE IF EXISTS lot_number_seq;")