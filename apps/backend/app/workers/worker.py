import json
import logging

from arq import cron
from arq.connections import RedisSettings
from sqlalchemy import text

from app.core.config import get_settings
from app.core.db import get_engine

log = logging.getLogger("rfo.worker")

RELEASE_SQL = text("""
WITH expired AS (
  UPDATE reservations SET status = 'released'
  WHERE status = 'active' AND expires_at < now()
  RETURNING asset_id
)
UPDATE assets SET status = 'listed' WHERE id IN (SELECT asset_id FROM expired)
""")


async def release_expired_reservations(ctx: dict) -> int:
    engine = get_engine()
    async with engine.begin() as conn:
        res = await conn.execute(RELEASE_SQL)
        n = res.rowcount
        if n > 0:
            await conn.execute(
                text("INSERT INTO audit_log (actor_type, entity, action, meta) VALUES ('system','reservation','reservations_released', :m)"),
                {"m": json.dumps({"count": n})})
    log.info("release_expired_reservations: %s released", n)
    return n


class WorkerSettings:
    functions = [release_expired_reservations]
    cron_jobs = [cron(release_expired_reservations, minute=set(range(0, 60)), run_at_startup=True)]
    max_jobs = 5
    job_timeout = 120
    redis_settings = RedisSettings.from_dsn(get_settings().REDIS_URL or "redis://localhost:6379/0")