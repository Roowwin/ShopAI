import pytest
import pytest_asyncio
from sqlalchemy import text

from app.core.db import get_ai_engine


@pytest_asyncio.fixture(autouse=True)
async def _fresh_ai_pool():
    yield
    await get_ai_engine().dispose()
    import app.core.db as rfo_db
    rfo_db._ai_engine = None
    rfo_db._AIMaker = None


async def test_ai_staff_cannot_read_customer_tables():
    eng = get_ai_engine()
    with pytest.raises(Exception):
        async with eng.connect() as c:
            await c.execute(text("SELECT count(*) FROM public.users"))


async def test_ai_staff_reads_ai_views():
    eng = get_ai_engine()
    async with eng.connect() as c:
        n = (await c.execute(text("SELECT count(*) FROM ai.catalog"))).scalar_one()
        l = (await c.execute(text("SELECT count(*) FROM ai.lots"))).scalar_one()
    assert n >= 1 and l >= 2


async def test_ai_public_role_throttled_and_readonly():
    eng = get_ai_engine()
    async with eng.connect() as c:
        row = (await c.execute(text("SELECT rolconnlimit FROM pg_roles WHERE rolname = 'rfo_ai_public'"))).scalar_one()
    assert row == 20
