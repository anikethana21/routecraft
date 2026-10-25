---
name: routecraft
description: Use when the user wants to inspect, browse, test, or demo an OpenAPI/Swagger API in a browser, or when an API request is blocked by CORS. Opens RouteCraft with the user's spec and can send CORS-free requests through the RouteCraft MCP server.
license: MIT
compatibility: Requires the RouteCraft MCP server (routecraft-mcp) or a local checkout of routecraft.
metadata:
  tags: "openapi,swagger,api-testing,mcp,zero-cors"
---

# RouteCraft

RouteCraft is an OpenAPI explorer and API console. It looks like Swagger UI / FastAPI `/docs`, but every endpoint has a **Try it out** â†’ **Execute** flow and the browser tab gets a zero-CORS bridge.

## When to use it

Use RouteCraft when the user:

- asks to see or explore an OpenAPI/Swagger document;
- wants to test an API from a browser;
- needs to verify HTTP status codes, auth, headers or a request body;
- is blocked by CORS on a localhost or third-party API;
- asks an agent to "open the docs" or "show me the API".

Do not use it for a static API reference that the user only wants summarized; answer directly unless they ask to open the UI.

## Tools

Call these through the RouteCraft MCP server. Some clients prefix tool names with the server name (for example `routecraft_open_swagger`).

1. **`inspect_spec`** â€” summarize a spec before opening it. Pass `specUrl` (an `http(s)` URL or a local JSON/YAML path) and optional `headers` for a protected spec endpoint.
2. **`open_swagger`** â€” open the browser UI. Pass `specUrl`, optional `operation` (for example `GET /pets`), optional `serverUrl` when the spec points at the wrong host, and `openBrowser: false` if the user only wants the URL.
3. **`http_request`** â€” verify an endpoint without a browser. Pass `url`, `method`, `headers`, `body` and optional `timeoutMs`.
4. **`close_swagger`** â€” stop the local app server when the user is finished.

## Workflow

1. Find the real spec URL. Check `/openapi.json`, `/swagger.json`, `/v3/api-docs`, `/docs`, or the path the user supplied. Do not invent one.
2. If the spec is large or the user asks "what is in this API", call `inspect_spec` and summarize the title, servers and important operations.
3. Call `open_swagger`. If the user asked for a specific endpoint, pass it as `operation` so the page expands and scrolls to it.
4. Give the user the returned **App URL** as a clickable link. Say that the tab is live and the server stays open until the MCP process stops.
5. When the user asks for a status code or a quick check, call `http_request` and report the method, URL, status, content type and a short body excerpt.
6. If the request is destructive (DELETE, bulk update, payment), ask before sending it.

## Fallbacks

If the MCP server is not configured but the RouteCraft repository is available:

```bash
node mcp/server.mjs open <spec-url-or-file>
```

If the npm package is installed:

```bash
npx -y routecraft-mcp open <spec-url-or-file>
```

Both commands print the app URL and keep the local server running. Use `Ctrl+C` to stop.

## Rules

- Never print bearer tokens, API keys or cookies in the final answer.
- Do not send destructive or billable requests without confirmation.
- Prefer the spec's declared `servers` URL. Use `serverUrl` only when the spec is wrong or missing a local host.
- `204` and `304` responses have empty bodies; do not call them missing.
- A `301` may return no `Location`; report the status rather than guessing the destination.
- If the bridge or local server fails, say which URL failed and suggest running `npm run build` in the RouteCraft checkout, then retry.

