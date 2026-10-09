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
            connect_args={"statement_cache_size": 0,
                          "server_settings": {"application_name": "rfo-api"}},
        )
    return _engine

_SessionMaker = async_sessionmaker(get_engine(), expire_on_commit=False)

async def get_db() -> AsyncIterator[AsyncSession]:
    async with _SessionMaker() as session:
        yield session
_ai_engine: AsyncEngine | None = None
_AIMaker = None


def get_ai_engine() -> AsyncEngine:
    global _ai_engine
    if _ai_engine is None:
        url = get_settings().DATABASE_AI_STAFF_URL
        if not url:
            raise RuntimeError("AI data wall not configured (DATABASE_AI_STAFF_URL missing)")
        _ai_engine = create_async_engine(url, pool_size=3, max_overflow=5, pool_pre_ping=True,
            connect_args={"statement_cache_size": 0, "server_settings": {"application_name": "rfo-ai"}})
    return _ai_engine


async def get_ai_db():
    global _AIMaker
    if _AIMaker is None:
        _AIMaker = async_sessionmaker(get_ai_engine(), expire_on_commit=False)
    async with _AIMaker() as session:
        yield session
_ai_pub_engine: AsyncEngine | None = None
_SAPMaker = None


def get_ai_public_engine() -> AsyncEngine:
    global _ai_pub_engine
    if _ai_pub_engine is None:
        url = get_settings().DATABASE_AI_PUBLIC_URL
        if not url:
            raise RuntimeError("AI public wall not configured (DATABASE_AI_PUBLIC_URL missing)")
        _ai_pub_engine = create_async_engine(url, pool_size=4, max_overflow=6, pool_pre_ping=True,
            connect_args={"statement_cache_size": 0, "server_settings": {"application_name": "rfo-ai-pub"}})
    return _ai_pub_engine


async def get_ai_public_db():
    global _SAPMaker
    if _SAPMaker is None:
        _SAPMaker = async_sessionmaker(get_ai_public_engine(), expire_on_commit=False)
    async with _SAPMaker() as session:
        yield session
