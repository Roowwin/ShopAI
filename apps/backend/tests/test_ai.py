import struct
import uuid
import zlib

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine


def _png_bytes(width: int = 64, height: int = 64) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    row = b"\x00" + b"\x80\x80\x80" * width
    raw = row * height
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def _staff_and_token(client, role: str) -> str:
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    sid, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    return r.json()["access_token"]


async def test_vision_intake_draft_contract(client):
    tok = await _staff_and_token(client, "technician")
    r = await client.post("/staff/ai/intake-draft",
                          files={"image": ("unit.png", _png_bytes(), "image/png")},
                          headers=_h(tok))
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("brand", "model", "serial_visible", "condition_notes", "suggested_grade", "confidence"):
        assert k in d, d
    assert d["suggested_grade"] in ("A", "B", "C", "D", "unclear")
    assert d["confidence"] in ("low", "medium", "high")


async def test_chat_grounding(client):
    tok = await _staff_and_token(client, "sales")
    r = await client.post("/staff/ai/chat", json={"message": "Which products have stock, and how much are they?"}, headers=_h(tok))
    assert r.status_code == 200, r.text
    assert len(r.json()["answer"]) > 10


async def test_description_draft(client):
    tok = await _staff_and_token(client, "manager")
    r = await client.post("/staff/ai/description-draft", json={"product_id": 2}, headers=_h(tok))
    assert r.status_code == 200, r.text
    d = r.json()
    assert all(k in d for k in ("title", "description", "keywords"))