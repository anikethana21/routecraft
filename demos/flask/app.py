"""RouteCraft demo API (Flask).

Run from this directory:

    python app.py

Open:
    http://127.0.0.1:8013/docs
    http://127.0.0.1:8013/rc          # shortcut -> /docs
    http://127.0.0.1:8013/openapi.json
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from flask import Flask, jsonify, redirect, request, Response

app = Flask(__name__)

CODES = [200, 201, 202, 204, 301, 400, 401, 403, 404, 409, 418, 422, 429, 500, 502, 503]
STARTED = datetime.now(timezone.utc)

ITEMS = [
    {"id": 1, "name": "Flask badge", "price": 5.5, "status": "available"},
    {"id": 2, "name": "PyPI sticker", "price": 1.0, "status": "available"},
]


def request_id() -> str:
    return request.headers.get("x-request-id") or f"flask-{int(datetime.now().timestamp() * 1000)}"


@app.after_request
def add_headers(response: Response) -> Response:
    response.headers["X-Demo-Server"] = "flask:8013"
    response.headers["X-Request-Id"] = request_id()
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Expose-Headers"] = "X-Demo-Server, X-Request-Id"
    return response


@app.route("/")
def health():
    return jsonify({
        "status": "healthy",
        "service": "Flask Status Codes Demo",
        "port": 8013,
        "codes": "/codes",
        "docs": "/docs",
        "rc": "/rc",
        "openapi": "/openapi.json",
        "started_at": STARTED.isoformat(),
    })


@app.route("/rc", methods=["GET"])
def rc_redirect():
    """Shortcut alias for /docs. Type /rc to load RouteCraft instantly."""
    return redirect("/docs", code=302)


@app.route("/docs", methods=["GET"])
def docs():
    return redirect("/openapi.json", code=302)


@app.route("/openapi.json", methods=["GET"])
def openapi():
    spec = {
        "openapi": "3.1.0",
        "info": {
            "title": "Flask Status Codes Demo",
            "version": "1.0.0",
            "description": "A small Flask service for verifying RouteCraft.",
        },
        "servers": [{"url": "http://127.0.0.1:8013"}],
        "paths": {
            "/rc": {"get": {"summary": "Shortcut to /docs", "responses": {"302": {"description": "Redirect to /docs"}}}},
            "/docs": {"get": {"summary": "Swagger UI docs (redirects to OpenAPI)", "responses": {"302": {"description": "Redirect to /openapi.json"}}}},
            "/openapi.json": {"get": {"summary": "OpenAPI document", "responses": {"200": {"description": "OpenAPI JSON"}}}},
            "/codes": {"get": {"summary": "List testable status codes", "responses": {"200": {"description": "List of codes"}}}},
            "/status/{code}": {"get": {"summary": "Return a specific HTTP status code", "responses": {"200": {"description": "Requested status code"}}}},
            "/items": {"get": {"summary": "List demo items", "responses": {"200": {"description": "Items list"}}}},
            "/secure": {"get": {"summary": "Bearer-protected endpoint", "responses": {"200": {"description": "OK"}, "401": {"description": "Unauthorized"}}}},
            "/echo": {"post": {"summary": "Echo a JSON body", "responses": {"200": {"description": "Echoed request"}}}},
        },
        "components": {"securitySchemes": {"bearerAuth": {"type": "http", "scheme": "bearer"}}},
    }
    return app.response_class(
        json.dumps(spec, indent=2),
        status=200,
        mimetype="application/json",
    )


@app.route("/codes", methods=["GET"])
def codes():
    return jsonify({"codes": CODES, "hint": "GET /status/<code> returns that status code."})


@app.route("/status/<int:code>", methods=["GET"])
def status_code(code):
    if code < 200 or code > 599:
        return jsonify({"status": 400, "message": "Use a status code between 200 and 599."}), 400
    if code in (204, 304):
        return Response(status=code)
    return jsonify({
        "status": code,
        "message": f"This is a {code} response from Flask.",
        "server": "flask:8013",
        "request_id": request_id(),
        "method": request.method,
        "path": request.path,
    }), code


@app.route("/items", methods=["GET", "POST"])
def items():
    if request.method == "GET":
        return jsonify(ITEMS)
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict) or not str(body.get("name", "")).strip():
        return jsonify({"status": 422, "message": "name is required."}), 422
    item = {
        "id": len(ITEMS) + 1,
        "name": str(body["name"]).strip(),
        "price": float(body.get("price", 0)),
        "status": "available",
    }
    ITEMS.append(item)
    return jsonify(item), 201


@app.route("/secure", methods=["GET"])
def secure():
    if request.headers.get("authorization") != "Bearer demo-token":
        return jsonify({"status": 401, "message": "Send Authorization: Bearer demo-token."}), 401
    return jsonify({"ok": True, "user": "demo", "server": "flask:8013", "scopes": ["items:read", "items:write"]})


@app.route("/echo", methods=["POST"])
def echo():
    return jsonify({
        "method": request.method,
        "headers": dict(request.headers),
        "query": dict(request.args),
        "body": request.get_json(silent=True),
    })


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8013, debug=False)
