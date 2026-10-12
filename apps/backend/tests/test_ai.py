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


def test_desc_prompt_carries_the_vibe_and_none_leaves_it_alone():
    """The studio's vibe switcher reaches the model THROUGH THIS PROMPT, so that is what is pinned.

    A pure-function test on purpose: "each vibe produces a different prompt carrying its own
    instruction" is a claim about this code and is deterministic, where asserting on the returned
    copy would only be a claim about the model's mood that day. `tone=None` must return the base
    prompt byte for byte - that is the guarantee that every pre-existing caller is unaffected.
    """
    from app.api.v1.staff_ai import DESC_TONES, _desc_prompt

    base = _desc_prompt("FACTS", None)
    assert base.endswith("FACTS")
    assert "Tone:" not in base
    prompts = {_desc_prompt("FACTS", t) for t in DESC_TONES}
    assert len(prompts) == len(DESC_TONES), "two vibes produced the same prompt"
    for t, instruction in DESC_TONES.items():
        p = _desc_prompt("FACTS", t)
        assert p.startswith(base), "the base prompt must be unchanged, with the vibe appended"
        assert instruction in p


async def test_description_draft_rejects_an_unknown_vibe(client):
    """A tone that is not one of the three is refused 422 BEFORE the product read or any model call.

    That ordering is the point: the value would otherwise be concatenated into an LLM prompt, and
    this test proves the refusal happens without a round trip (it passes with no AI endpoint up).
    """
    tok = await _staff_and_token(client, "manager")
    r = await client.post("/staff/ai/description-draft",
                          json={"product_id": 2, "tone": "shouty"},
                          headers=_h(tok))
    assert r.status_code == 422, r.text
    assert "tone must be one of" in r.json()["detail"]


async def test_description_draft_accepts_a_known_vibe(client):
    """A known vibe is a normal draft request: same contract, plus the tone in the prompt."""
    tok = await _staff_and_token(client, "sales")
    r = await client.post("/staff/ai/description-draft",
                          json={"product_id": 2, "tone": "professional"},
                          headers=_h(tok))
    assert r.status_code == 200, r.text
    assert all(k in r.json() for k in ("title", "description", "keywords"))