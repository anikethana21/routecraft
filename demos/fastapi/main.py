"""RouteCraft demo API (FastAPI).

Run from this directory:

    python -m uvicorn main:app --host 127.0.0.1 --port 8010

Open:
    http://127.0.0.1:8010/docs
    http://127.0.0.1:8010/openapi.json
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

CODES = [200, 201, 202, 204, 301, 400, 401, 403, 404, 409, 418, 422, 429, 500, 502, 503]
STARTED = datetime.now(timezone.utc)

app = FastAPI(
    title="FastAPI Status Codes Demo",
    description=(
        "A small FastAPI service for verifying RouteCraft. Every status code endpoint "
        "returns the code you asked for. Open /docs in RouteCraft to load this spec."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url=None,
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-Id", "X-Demo-Server"],
)

ITEMS: list[dict[str, Any]] = [
    {"id": 1, "name": "FastAPI badge", "price": 9.5, "status": "available"},
    {"id": 2, "name": "OpenAPI sticker", "price": 2.0, "status": "available"},
]


def request_id(request: Request) -> str:
    return request.headers.get("x-request-id") or f"fastapi-{int(datetime.now().timestamp() * 1000)}"


@app.middleware("http")
async def add_demo_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Demo-Server"] = "fastapi:8010"
    response.headers["X-Request-Id"] = request_id(request)
    return response


@app.get("/", tags=["health"], summary="Health check")
def health() -> dict[str, Any]:
    return {
        "status": "healthy",
        "service": "FastAPI Status Codes Demo",
        "port": 8010,
        "codes": "/codes",
        "docs": "/docs",
        "openapi": "/openapi.json",
        "started_at": STARTED.isoformat(),
    }


@app.get("/rc", include_in_schema=False)
def rc_redirect():
    """Shortcut alias for /docs. Type /rc to load RouteCraft instantly."""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/docs")


@app.get("/codes", tags=["status codes"], summary="List testable status codes")
def codes() -> dict[str, Any]:
    return {
        "codes": CODES,
        "hint": "GET /status/<code> returns that status code.",
    }


@app.get("/status/{code}", tags=["status codes"], summary="Return a specific HTTP status code")
def status_code(code: int, request: Request):
    if code < 200 or code > 599:
        raise HTTPException(status_code=400, detail="Use a status code between 200 and 599.")

    if code in (204, 304):
        return Response(status_code=code)

    payload = {
        "status": code,
        "message": f"This is a {code} response from FastAPI.",
        "server": "fastapi:8010",
        "request_id": request_id(request),
        "method": request.method,
        "path": str(request.url.path),
    }
    return Response(
        content=json.dumps(payload, indent=2),
        status_code=code,
        media_type="application/json",
        headers={"X-Demo-Server": "fastapi:8010"},
    )


@app.get("/items", tags=["items"], summary="List demo items")
def list_items() -> list[dict[str, Any]]:
    return ITEMS


@app.post("/items", tags=["items"], status_code=201, summary="Create a demo item")
async def create_item(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except Exception as exc:  # pragma: no cover - exercised through HTTP
        raise HTTPException(status_code=422, detail=f"Body is not valid JSON: {exc}") from exc
    if not isinstance(body, dict) or not str(body.get("name", "")).strip():
        raise HTTPException(status_code=422, detail="name is required.")
    item = {
        "id": len(ITEMS) + 1,
        "name": str(body["name"]).strip(),
        "price": float(body.get("price", 0)),
        "status": "available",
    }
    ITEMS.append(item)
    return item


@app.get("/secure", tags=["auth"], summary="Bearer-protected endpoint")
def secure(request: Request) -> dict[str, Any]:
    if request.headers.get("authorization") != "Bearer demo-token":
        raise HTTPException(status_code=401, detail="Send Authorization: Bearer demo-token.")
    return {"ok": True, "user": "demo", "server": "fastapi:8010", "scopes": ["items:read", "items:write"]}


@app.post("/echo", tags=["echo"], summary="Echo a JSON body")
async def echo(request: Request) -> dict[str, Any]:
    raw = await request.body()
    try:
        body = json.loads(raw) if raw else None
    except json.JSONDecodeError:
        body = raw.decode("utf-8", errors="replace")
    return {
        "method": request.method,
        "headers": dict(request.headers),
        "query": dict(request.query_params),
        "body": body,
    }



