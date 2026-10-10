import json
import os
from typing import Any

import httpx

from app.core.config import get_settings


class AIError(Exception):
    pass


_http: httpx.AsyncClient | None = None
LAST_VIA: dict[str, str] = {"via": "local"}


async def _post_generate(url: str, payload: dict, timeout: float, api_key: str | None) -> dict:
    global _http
    if _http is None:
        _http = httpx.AsyncClient(timeout=timeout)
    headers = {"Authorization": "Bearer " + api_key} if api_key else None
    r = await _http.post(url.rstrip("/") + "/api/generate", json=payload, timeout=timeout, headers=headers)
    if r.status_code != 200:
        raise AIError("ollama http " + str(r.status_code) + ": " + r.text[:120])
    return r.json()


async def _ollama(payload: dict, timeout: float) -> dict:
    s = get_settings()
    if not s.AI_ENDPOINT:
        raise AIError("AI_ENDPOINT not configured")
    return await _post_generate(s.AI_ENDPOINT, payload, timeout, None)


def _cloud_text_cfg() -> tuple[str, str, str]:
    ep = (os.getenv("AI_CLOUD_ENDPOINT", "") or "").strip()
    key = (os.getenv("AI_CLOUD_API_KEY", "") or "").strip()
    mdl = (os.getenv("AI_CLOUD_TEXT_MODEL", "") or "").strip()
    return ep, key, mdl


def cloud_text_active() -> bool:
    ep, key, m = _cloud_text_cfg()
    return bool(ep and key and m)


async def _post_chat(ep: str, model: str, messages: list, timeout: float, api_key: str | None, response_format: dict | None) -> str:
    global _http
    if _http is None:
        _http = httpx.AsyncClient(timeout=timeout)
    headers = {"Authorization": "Bearer " + api_key} if api_key else None
    payload: dict[str, Any] = {"model": model, "messages": messages}
    if response_format is not None:
        payload["response_format"] = response_format
    r = await _http.post(ep.rstrip("/") + "/v1/chat/completions", json=payload, timeout=timeout, headers=headers)
    if r.status_code != 200:
        raise AIError("cloud http " + str(r.status_code) + ": " + r.text[:120])
    data = r.json()
    try:
        return data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        raise AIError("cloud response missing content")


async def _post_chat(ep: str, model: str, messages: list, timeout: float, api_key: str | None, response_format: dict | None) -> str:
    global _http
    if _http is None:
        _http = httpx.AsyncClient(timeout=timeout)
    headers = {"Authorization": "Bearer " + api_key} if api_key else None
    payload: dict[str, Any] = {"model": model, "messages": messages}
    if response_format is not None:
        payload["response_format"] = response_format
    r = await _http.post(ep.rstrip("/") + "/v1/chat/completions", json=payload, timeout=timeout, headers=headers)
    if r.status_code != 200:
        raise AIError("cloud http " + str(r.status_code) + ": " + r.text[:120])
    data = r.json()
    try:
        return data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        raise AIError("cloud response missing content")


async def ollama_generate(prompt: str, system: str | None = None,
                          images_b64: list[str] | None = None,
                          schema: dict | None = None,
                          model: str | None = None,
                          timeout: float = 180.0) -> dict:
    s = get_settings()
    base_model = model or (s.AI_VISION_MODEL if images_b64 else s.AI_TEXT_MODEL)
    body: dict[str, Any] = {"model": base_model, "prompt": prompt, "stream": False}
    if system:
        body["system"] = system
    if images_b64:
        body["images"] = images_b64
    if schema:
        body["format"] = schema

    ep, key, cloud_m = _cloud_text_cfg()
    if not images_b64 and ep and key and cloud_m:
        messages: list[dict[str, Any]] = []
        if system:
            messages.append({"role": "system", "content": system})
        usr = prompt
        if schema:
            usr = usr + "\nReturn ONLY a JSON object with no extra text, matching this schema: " + json.dumps(schema)
        messages.append({"role": "user", "content": usr})
        rf = {"type": "json_object"} if schema else None
        try:
            LAST_VIA["via"] = "cloud"
            return {"response": await _post_chat(ep, cloud_m, messages, timeout, key, rf), "via": "cloud"}
        except Exception:
            pass   # cloud flaked -> fall through to the local model

    if "gpt-oss" in base_model and (os.getenv("AI_THINK", "") or "").strip().lower() != "true":
        body["think"] = False

    body["options"] = {"num_ctx": 8192}   # fallback/l local context floor
    LAST_VIA["via"] = "local"
    return await _ollama(body, timeout)


async def ai_text(prompt: str, system: str | None = None, model: str | None = None) -> str:
    res = await ollama_generate(prompt, system=system, model=model)
    return (res.get("response") or "").strip()


def _extract_json(raw: str) -> str | None:
    raw = raw.strip()
    start = raw.find("{")
    if start < 0:
        return None
    depth = 0
    for i in range(start, len(raw)):
        c = raw[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return raw[start:i + 1]
    return None


async def ai_json(prompt: str, schema: dict, system: str | None = None,
                  images_b64: list[str] | None = None, model: str | None = None) -> dict:
    res = await ollama_generate(prompt, system=system, images_b64=images_b64, schema=schema, model=model)
    raw = (res.get("response") or "").strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        candidate = _extract_json(raw)
        if candidate is not None:
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                pass
        raise AIError("invalid JSON from model: " + raw[:180])