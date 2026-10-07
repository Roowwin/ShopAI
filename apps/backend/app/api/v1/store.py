import re

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.api.v1 import sessions
from app.api.v1.deps import get_customer
from app.core import security
from app.core.config import get_settings
from app.core.db import get_db

router = APIRouter(prefix="/store", tags=["store-auth"])

class RegisterIn(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=10, max_length=128)
    display_name: str = Field(default="", max_length=80)

class LoginIn(BaseModel):
    email: str
    password: str

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

@router.post("/auth/register")
async def register(body: RegisterIn, response: Response, db=Depends(get_db)):
    if not _EMAIL.match(body.email):
        raise HTTPException(status_code=422, detail="invalid email")
    if not (body.password.isalnum() or re.search(r"[A-Za-z]", body.password)) or not re.search(r"[0-9]", body.password):
        raise HTTPException(status_code=422, detail="weak password")
    try:
        row = (await db.execute(text("INSERT INTO users (email, display_name) VALUES (:e, :d) RETURNING id, public_id::text"),
                                {"e": body.email, "d": body.display_name})).mappings().one()
        await db.execute(text("INSERT INTO password_credentials (user_id, password_hash) VALUES (:i, :h)"),
                         {"i": row["id"], "h": security.hash_password(body.password)})
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="email already registered")
    return await sessions.issue(db, "store", row["id"], row["public_id"], None, response)

@router.post("/auth/login")
async def login(body: LoginIn, response: Response, db=Depends(get_db)):
    row = (await db.execute(text("SELECT u.id, u.public_id::text, u.status, c.password_hash FROM users u JOIN password_credentials c ON c.user_id = u.id WHERE u.email = :e"),
                            {"e": body.email})).mappings().first()
    if row is None or row["status"] != "active" or not security.verify_password(row["password_hash"], body.password):
        raise HTTPException(status_code=401, detail="invalid credentials")
    return await sessions.issue(db, "store", row["id"], row["public_id"], None, response)

@router.post("/auth/refresh")
async def refresh(response: Response, rfo_rt_store: str | None = Cookie(default=None), db=Depends(get_db)):
    identity_id = await sessions.rotate(db, "store", rfo_rt_store)
    row = (await db.execute(text("SELECT id, public_id::text FROM users WHERE id = :i"), {"i": identity_id})).mappings().first()
    if row is None:
        raise HTTPException(status_code=401, detail="account gone")
    return await sessions.issue(db, "store", row["id"], row["public_id"], None, response)

@router.post("/auth/logout", status_code=204)
async def logout(response: Response, rfo_rt_store: str | None = Cookie(default=None), db=Depends(get_db)):
    await sessions.revoke(db, "store", rfo_rt_store)
    sessions.clear_refresh_cookie(response, "store")

@router.get("/me")
async def me(customer: dict = Depends(get_customer)):
    return customer