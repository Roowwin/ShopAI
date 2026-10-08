from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine


async def main():
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_type = 'staff' AND identity_id = (SELECT id FROM staff_users WHERE email = 'admin@rfo.local')"))
        await c.execute(text("DELETE FROM staff_users WHERE email = 'admin@rfo.local'"))
    await eng.dispose()
    print("Admin password rotated.")
    await bootstrap("admin@rfo.local", "admin")


import asyncio
asyncio.run(main())