import json
from typing import Any

import httpx

from app.core.config import get_settings


class AIError(Exception):
    pass


_http: httpx.AsyncClient | None = None


async def _ollama(payload: dict, timeout: float) -> dict:
    global _http
    if _http is None:
        _http = httpx.AsyncClient(timeout=timeout)
    s = get_settings()
    if not s.AI_ENDPOINT:
        raise AIError("AI_ENDPOINT not configured")
    r = await _http.post(s.AI_ENDPOINT.rstrip("/") + "/api/generate", json=payload, timeout=timeout)
    if r.status_code != 200:
        raise AIError("ollama http " + str(r.status_code) + ": " + r.text[:120])
    return r.json()


async def ollama_generate(prompt: str, system: str | None = None,
                          images_b64: list[str] | None = None,
                          schema: dict | None = None,
                          model: str | None = None,
                          timeout: float = 180.0) -> dict:
    s = get_settings()
    used_model = model or (s.AI_VISION_MODEL if images_b64 else s.AI_TEXT_MODEL)
    body: dict[str, Any] = {"model": used_model, "prompt": prompt, "stream": False}
    if system:
        body["system"] = system
    if images_b64:
        body["images"] = images_b64
    if schema:
        body["format"] = schema
    return await _ollama(body, timeout)


async def ai_text(prompt: str, system: str | None = None, model: str | None = None) -> str:
    res = await ollama_generate(prompt, system=system, model=model)
    return (res.get("response") or "").strip()


async def ai_json(prompt: str, schema: dict, system: str | None = None,
                  images_b64: list[str] | None = None, model: str | None = None) -> dict:
    res = await ollama_generate(prompt, system=system, images_b64=images_b64, schema=schema, model=model)
    try:
        return json.loads(res.get("response") or "{}")
    except json.JSONDecodeError:
        raise AIError("model returned invalid JSON; retry")