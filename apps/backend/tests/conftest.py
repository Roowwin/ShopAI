import os
import tempfile

import pytest_asyncio
import httpx

from app.main import app

# TESTS NEVER WRITE INTO THE OPERATOR'S MEDIA FOLDER. Every upload now also writes a real file into
# `MEDIA_DIR`, and the compose service points that at a folder on the host that a person opens in
# Explorer. A suite that uploaded fixtures would therefore be dropping `mission-pgroup-*.png` and
# `defect.png` into somebody's product photography - which is exactly what happened once, before
# this line existed (`1a06281f-defect.png`, left by an RMA fixture whose teardown knows about its own
# tables but not about `media_objects`).
#
# FORCED, not `setdefault`: the compose service already sets `MEDIA_DIR=/media-files`, so a default
# would never apply and the tests would write straight through to the host. A fresh temp directory
# per run, thrown away by the OS.
os.environ["MEDIA_DIR"] = tempfile.mkdtemp(prefix="rfo-test-media-")


@pytest_asyncio.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="https://t") as c:
            yield c
    finally:
        import app.core.db as rfo_db
        import app.core.redis as rfo_redis
        import app.services.ai as rfo_ai
        await rfo_db.get_engine().dispose()
        if getattr(rfo_db, "_ai_engine", None) is not None:
            await rfo_db._ai_engine.dispose()
            rfo_db._ai_engine = None
            rfo_db._AIMaker = None
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
