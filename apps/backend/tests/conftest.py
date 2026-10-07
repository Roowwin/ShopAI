import pytest_asyncio
import httpx

from app.main import app

@pytest_asyncio.fixture
async def client():
    # base_url uses https so httpx actually SENDS our Secure refresh cookies
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="https://t") as c:
            yield c
    finally:
        # pytest-asyncio gives every test a fresh event loop; pooled asyncpg
        # connections from the previous loop are dead on checkout. Disposing
        # the pool at teardown makes every test build connections on ITS loop.
        from app.core.db import get_engine
        await get_engine().dispose()
