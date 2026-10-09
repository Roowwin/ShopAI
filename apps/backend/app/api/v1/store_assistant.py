import hashlib
import json
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.core import redis as rfo_redis
from app.core.config import get_settings
from app.core.db import get_ai_public_db
from app.services.ai import AIError, ai_json, ai_text
from datetime import date

router = APIRouter(prefix="/store/assistant", tags=["public-assistant"])

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_CARD = re.compile(r"\b(?:\d[ -]*?){13,16}\b")
_PHONE = re.compile(r"\+?\d[\d\-\s]{7,}")
_BLOCKED = re.compile(r"cost price|cost-price|margin|supplier|wholesale", re.I)


def scrub(t: str):
    hits = 0
    for rx in (_CARD, _EMAIL, _PHONE):
        hits += len(rx.findall(t))
        t = rx.sub("[redacted]", t)
    return t, hits


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=900)
    session_id: str = Field(min_length=8, max_length=64)


ROUTE_SCHEMA = {
    "type": "object",
    "properties": {
        "action": {"type": "string", "enum": ["none", "search"]},
        "q": {"type": "string"},
        "max_price_cents": {"type": ["integer", "null"], "maximum": 1000000},
        "grade": {"type": ["string", "null"], "enum": ["A", "B", "C", "D", None]},
    },
    "required": ["action"],
}


@router.post("/chat")
async def public_chat(body: ChatIn, ai_db=Depends(get_ai_public_db)):
    s = get_settings()
    if not s.PUBLIC_CHAT_ENABLED:
        raise HTTPException(status_code=404, detail="not found")

    r = rfo_redis.get_redis()
    if await r.exists("rfo:pubchat:kill"):
        raise HTTPException(status_code=503, detail="assistant paused")

    bk = "rfo:pubchat:budget:" + date.today().isoformat()
    n = await r.incr(bk)
    if n == 1:
        await r.expire(bk, 90000)
    if n > s.PUBLIC_CHAT_DAILY_MAX:
        raise HTTPException(status_code=503, detail="daily limit reached")

    clean, pci_hits = scrub(body.message.strip())
    hk = hashlib.sha256(body.session_id.encode()).hexdigest()[:12]
    key = "rfo:pubchat:s:" + hk
    raw_hist = await r.get(key)
    hist = json.loads(raw_hist) if raw_hist else []
    if len(hist) >= 6:
        raise HTTPException(status_code=429, detail="session turn limit reached")

    try:
        decision = await ai_json("Customer says: " + clean + "\nIf this asks to find/see products: action=search with args (q, max_price_cents). Otherwise action=none.",
            schema=ROUTE_SCHEMA,
            system="You route shopper requests for a refurbished store. Reply only as JSON. Never invent numbers.")
    except AIError as e:
        raise HTTPException(status_code=502, detail=str(e))

    rows = []
    if decision.get("action") == "search":
        args = decision.get("args") or {}
        q = (args.get("q") or clean)[:40]
        cond = ["(title ILIKE :pat OR brand ILIKE :pat OR model ILIKE :pat OR slug ILIKE :pat)"]
        params = {"pat": "%" + q + "%"}
        if args.get("max_price_cents"):
            cond.append("price_from_cents <= :mp"); params["mp"] = int(args["max_price_cents"])
        if args.get("grade") in ("A", "B", "C", "D"):
            cond.append("grade = :g"); params["g"] = args["grade"]
        sql = "SELECT slug, title, brand, grade, price_from_cents, units_available FROM ai_public.v_available WHERE " + " AND ".join(cond) + " ORDER BY price_from_cents LIMIT 5"
        rows = (await ai_db.execute(text(sql), params)).mappings().all()

    try:
        answer = await ai_text(
            "Customer asks: " + clean + "\nTool results (verified, only these exist): " +
            json.dumps([{"title": x["title"], "grade": x["grade"], "price_aud": round(x["price_from_cents"]/100, 2)} for x in rows]) +
            "\nAnswer briefly, only from the results; if none, say nothing matches and suggest broadening.",
            system="You help shoppers find refurbished devices from tool results only. Never invent products, prices or stock. You cannot access accounts, orders, payments. Refuse internal costs, suppliers, other customers.")
    except AIError as e:
        raise HTTPException(status_code=502, detail=str(e))

    if _BLOCKED.search(answer):
        answer = "I can only help with the products listed on our storefront."

    hist = (hist + ["C: " + clean[:120], "A: " + answer[:120]])[-6:]
    await r.set(key, json.dumps(hist), ex=1800)

    import logging
    logging.info("pubchat sid=%s len=%d pii=%d tools=%d", hk, len(clean), pci_hits, len(rows))
    return {"text": answer,
            "products": [{"title": x["title"], "brand": x["brand"], "grade": x["grade"],
                          "price_cents": int(x["price_from_cents"]), "units_available": int(x["units_available"]),
                          "url": "https://shop.rfo.localhost/products/" + x["slug"]} for x in rows],
            "pii_warning": pci_hits > 0}
