import logging
import time
import uuid as uuidlib

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import get_settings
from app.core.db import get_engine

logging.basicConfig(level=get_settings().LOG_LEVEL)

app = FastAPI(title="RFO API", version="0.1.0-phase3a")

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    expose_headers=["X-Request-ID"],
)

@app.middleware("http")
async def request_context(request: Request, call_next):
    rid = request.headers.get("X-Request-ID") or uuidlib.uuid4().hex
    t0 = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Request-ID"] = rid
    logging.info("%s %s %s %.1fms rid=%s", request.method, request.url.path,
                 response.status_code, (time.perf_counter() - t0) * 1000, rid)
    return response

@app.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok"}

@app.get("/readyz")
async def readyz():
    try:
        async with get_engine().connect() as conn:
            await conn.execute(text("SELECT 1"))
        return {"db": True}
    except Exception:
        return JSONResponse(status_code=503, content={"db": False})