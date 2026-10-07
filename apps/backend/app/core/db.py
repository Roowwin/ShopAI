from collections.abc import AsyncIterator
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from app.core.config import get_settings

_engine: AsyncEngine | None = None

def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = create_async_engine(
            get_settings().DATABASE_URL,
            pool_pre_ping=True,
            pool_size=10,
            max_overflow=20,
            pool_recycle=1800,
            # PgBouncer transaction mode: prepared-statement caches stay OFF at app side
            connect_args={"statement_cache_size": 0, "command_cache_size": 0,
                          "server_settings": {"application_name": "rfo-api"}},
        )
    return _engine

_SessionMaker = async_sessionmaker(get_engine(), expire_on_commit=False)

async def get_db() -> AsyncIterator[AsyncSession]:
    async with _SessionMaker() as session:
        yield session