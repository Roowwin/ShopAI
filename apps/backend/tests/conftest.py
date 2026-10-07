import pytest_asyncio
import httpx

from app.main import app

@pytest_asyncio.fixture
async def client():
    # base_url uses https so httpx actually SENDS our Secure refresh cookies
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="https://t") as c:
        yield c