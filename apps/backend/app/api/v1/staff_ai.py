import base64
import json
from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.api.v1.deps import require_roles
from app.core.db import get_db, get_ai_db
from app.services.ai import AIError, ai_json, ai_text
from app.services.audit import audit

router = APIRouter(prefix="/staff/ai", tags=["staff-ai"])

VISION_SCHEMA = {
    "type": "object",
    "properties": {
        "brand": {"type": "string"},
        "model": {"type": "string"},
        "serial_visible": {"type": "string"},
        "condition_notes": {"type": "string"},
        "suggested_grade": {"type": "string", "enum": ["A", "B", "C", "D", "unclear"]},
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
    },
    "required": ["brand", "model", "serial_visible", "condition_notes", "suggested_grade", "confidence"],
}


@router.post("/intake-draft")
async def intake_draft(image: UploadFile = File(...),
                       staff: dict = Depends(require_roles("admin", "manager", "warehouse", "technician")),
                       db=Depends(get_db)):
    raw = await image.read()
    if len(raw) > 6 * 1024 * 1024:
        raise HTTPException(status_code=422, detail="image too large (max 6MB)")
    if image.content_type and not image.content_type.startswith("image/"):
        raise HTTPException(status_code=422, detail="image file required")
    b64 = base64.b64encode(raw).decode()
    try:
        draft = await ai_json(
            "Look at the product photo. Identify brand, model, any serial/label text you can read, the condition, and suggest a grade (A=excellent, B=good, C=usable, D=parts/unclear). Only report what you actually see.",
            schema=VISION_SCHEMA,
            system="You are a refurbishment intake assistant for an AU/NZ electronics store. Respond only in JSON. Never invent serial numbers; if unsure, lower your confidence.",
            images_b64=[b64])
    except AIError as e:
        raise HTTPException(status_code=502, detail=str(e))
    await audit(db, "staff", entity="ai", action="intake_draft", actor_id=staff["id"],
                after={"brand": draft.get("brand"), "model": draft.get("model"),
                       "confidence": draft.get("confidence")})
    await db.commit()
    return draft


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


CHAT_DAILY_CAP = 100


@router.post("/chat")
async def chat(body: ChatIn,
               staff: dict = Depends(require_roles("admin", "manager", "technician", "warehouse", "sales")),
               db=Depends(get_db), ai_db=Depends(get_ai_db)):
    from app.core.redis import get_redis

    r = get_redis()
    key = "rfo:chat:" + str(staff["id"]) + ":" + date.today().isoformat()
    n = await r.incr(key)
    if n == 1:
        await r.expire(key, 86400)
    if n > CHAT_DAILY_CAP:
        raise HTTPException(status_code=429, detail="daily assistant quota reached")

    ctx = await ai_snapshot(ai_db)

    try:
        answer = await ai_text(
            body.message,
            system=("You are the RFO staff assistant. Today is " + date.today().isoformat() + ". "
                    "Verified stock, lots and offers for AU/NZ (prices in AUD cents):\n" + ctx + "\n"
                    "Answer ONLY from that data; if it is not in the data, say you do not have it. "
                    "Show prices as AUD dollars with cents."))
    except AIError as e:
        raise HTTPException(status_code=502, detail=str(e))
    if not answer:
        raise HTTPException(status_code=502, detail="assistant returned nothing")
    return {"answer": answer}


class DescribeIn(BaseModel):
    product_id: int


DESC_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "description": {"type": "string"},
        "keywords": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["title", "description", "keywords"],
}


@router.post("/description-draft")
async def description_draft(body: DescribeIn,
                            staff: dict = Depends(require_roles("admin", "manager", "sales")),
                            db=Depends(get_db)):
    p = (await db.execute(text("""
        SELECT pr.id, pr.title, pr.model, b.name AS brand, c.name AS category, pr.specs
        FROM products pr JOIN brands b ON b.id = pr.brand_id JOIN categories c ON c.id = pr.category_id
        WHERE pr.id = :i"""), {"i": body.product_id})).mappings().first()
    if p is None:
        raise HTTPException(status_code=404, detail="product not found")
    graders = (await db.execute(text("""
        SELECT grade, count(*) AS n, min(sale_price_cents) AS minp
        FROM assets WHERE product_id = :i AND grade IS NOT NULL GROUP BY grade"""), {"i": body.product_id})).mappings().all()
    facts = json.dumps({"title": p["title"], "brand": p["brand"], "category": p["category"],
                        "model": p["model"], "specs": p["specs"],
                        "grades": [{"grade": g["grade"], "units": int(g["n"]),
                                    "price_from_cents": int(g["minp"])} for g in graders]})
    try:
        draft = await ai_json(
            "Write a store listing (title <= 90 chars, description, and 5 keywords) from these verified facts: " + facts,
            schema=DESC_SCHEMA,
            system="You write listings for certified refurbished electronics, Australia/New Zealand, Australian English. Clear, honest, no exaggeration; do not invent specs not provided.")
    except AIError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return draft
async def ai_snapshot(ai_db) -> str:
    cat = (await ai_db.execute(text("SELECT title, available_units, price_from_cents FROM ai.catalog ORDER BY available_units DESC LIMIT 12"))).mappings().all()
    lots = (await ai_db.execute(text("SELECT lot_number, status, units FROM ai.lots ORDER BY lot_number DESC LIMIT 8"))).mappings().all()
    promos = (await ai_db.execute(text("SELECT name, kind, value, active FROM ai.promotions"))).mappings().all()
    return json.dumps({
        "catalog": [{"title": c["title"], "available_units": int(c["available_units"]),
                     "price_from_cents": c["price_from_cents"]} for c in cat],
        "recent_lots": [{"lot": l["lot_number"], "status": l["status"], "units": int(l["units"])} for l in lots],
        "promotions": [{"name": p["name"], "kind": p["kind"], "value": int(p["value"]), "active": bool(p["active"])} for p in promos],
    })
