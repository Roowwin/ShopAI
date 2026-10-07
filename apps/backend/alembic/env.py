import os
from alembic import context
from sqlalchemy import create_engine

url = os.environ.get("DATABASE_URL")
if not url:
    raise SystemExit("DATABASE_URL is required")

def run():
    engine = create_engine(url)
    try:
        with engine.connect() as conn:
            context.configure(connection=conn, target_metadata=None)
            with context.begin_transaction():
                context.run_migrations()
    finally:
        engine.dispose()

run()
print("ALEMBIC_DONE")