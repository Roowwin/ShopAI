import argparse
import asyncio
import secrets
import sys

from sqlalchemy import text

from app.core.db import get_engine
from app.core.security import hash_password

async def bootstrap(email: str, role: str) -> int:
    pw = secrets.token_urlsafe(18)
    engine = get_engine()
    async with engine.begin() as conn:
        row = await conn.execute(text("SELECT id FROM staff_users WHERE email = :e"), {"e": email})
        sid = row.scalar()
        if sid is not None:
            print(f"OK staff-user exists (id={sid}) - password left unchanged")
            return 0
        res = await conn.execute(
            text("INSERT INTO staff_users (email, display_name, role) VALUES (:e, :dn, :role) RETURNING id"),
            {"e": email, "dn": email.split("@")[0], "role": role})
        sid = res.scalar_one()
        await conn.execute(text("INSERT INTO staff_passwords (staff_id, password_hash) VALUES (:i, :h)"),
                           {"i": sid, "h": hash_password(pw)})
    await engine.dispose()
    print(f"CREATED staff id={sid}")
    print(f"EMAIL: {email}")
    print(f"PASSWORD: {pw}")
    print("STORE CREDENTIALS SAFELY - shown once only")
    return 0

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--email", required=True)
    ap.add_argument("--role", default="admin", choices=["admin", "manager", "technician", "warehouse", "sales"])
    a = ap.parse_args()
    sys.exit(asyncio.run(bootstrap(a.email, a.role)))