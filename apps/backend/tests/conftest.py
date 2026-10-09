import pytest_asyncio
import httpx

from app.main import app


@pytest_asyncio.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="https://t") as c:
            yield c
    finally:
        import app.core.redis as rfo_redis
        import app.services.ai as rfo_ai
        from app.core.db import get_engine
        await get_engine().dispose()
        if rfo_redis._client is not None:
            try:
                await rfo_redis._client.aclose()
            except Exception:
                pass
            rfo_redis._client = None
        if rfo_ai._http is not None:
            try:
                await rfo_ai._http.aclose()
            except Exception:
                pass
            rfo_ai._http = None
