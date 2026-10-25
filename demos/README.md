# Demo APIs

Three small APIs for verifying RouteCraft end to end: an authenticated To-Do
list, plus FastAPI, Java, and Flask status-code demos.

| Demo | Docs | OpenAPI | Port |
| --- | --- | --- | --- |
| To-Do List Auth | <http://127.0.0.1:8012/docs> | <http://127.0.0.1:8012/openapi.json> | 8012 |
| FastAPI | <http://127.0.0.1:8010/docs> | <http://127.0.0.1:8010/openapi.json> | 8010 |
| Java (standard library) | <http://127.0.0.1:8011/docs> | <http://127.0.0.1:8011/openapi.json> | 8011 |
| Flask | <http://127.0.0.1:8013/docs> | <http://127.0.0.1:8013/openapi.json> | 8013 |

All demos also expose a `/rc` shortcut that redirects to `/docs`.

## Run the To-Do API

From the repository root:

```bash
python demos/todo/main.py
# or: npm run demo:todo
```

Requires Python 3.10+ and FastAPI/Uvicorn/`python-multipart`:

```bash
python -m pip install -r demos/todo/requirements.txt
```

Accounts:

| Username | Password | Role |
| --- | --- | --- |
| `demo` | `demo123` | user |
| `admin` | `admin123` | administrator |

Open <http://127.0.0.1:8012/docs>, start RouteCraft, click **Authorize**, open
`todoAuth`, enter `demo` / `demo123`, and click **Get token**. It supports full
CRUD (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`), filters, sorting, pagination,
per-user authorization, an admin role, CORS and timing headers. The complete
endpoint table is in [`todo/README.md`](todo/README.md).

## Run FastAPI

```bash
cd demos/fastapi
python -m uvicorn main:app --host 127.0.0.1 --port 8010
```

Requires Python 3.10+ and FastAPI/Uvicorn.

## Run Java

The Java demo uses only `com.sun.net.httpserver`, so it needs no Maven or Gradle.
Use JDK 17 or newer.

```bash
javac -encoding UTF-8 -d demos/java/bin demos/java/RouteCraftJavaDemo.java
java -cp demos/java/bin RouteCraftJavaDemo 8011
```

## Run Flask

```bash
python demos/flask/app.py
```

Requires Python 3.10+ and Flask.

## Status codes

The FastAPI, Java, and Flask status-code APIs support:

```text
200  201  202  204  301
400  401  403  404  409  418  422  429
500  502  503
```

```bash
curl -i http://127.0.0.1:8010/status/418
curl -i http://127.0.0.1:8011/status/503
curl -i http://127.0.0.1:8013/status/418
```

- `GET /codes` returns the list as JSON.
- `GET /status/{code}` returns exactly that status code. `204` and `304` are sent without a body.
- `GET /secure` expects `Authorization: Bearer demo-token`.
- `POST /echo` returns the request body and headers.
- `GET /items` and `POST /items` provide a small in-memory collection.

## Verify with RouteCraft

1. Start the demo you want to test.
2. Install the Tampermonkey userscript or load the Chrome extension.
3. Open a `/docs` page (or `/rc` shortcut). RouteCraft detects the spec origin automatically.
4. For the To-Do API, authorize and try a full CRUD flow. For the status demos, expand `GET /status/{code}`, click **Try it out**, enter `418` (or any code above), and press **Execute**.

You can also open the live spec through the MCP server without installing anything:

```bash
node mcp/server.mjs open http://127.0.0.1:8012/openapi.json --operation "GET /todos"
node mcp/server.mjs open http://127.0.0.1:8010/openapi.json --operation "GET /status/{code}"
node mcp/server.mjs open http://127.0.0.1:8013/openapi.json --operation "GET /status/{code}"
```

That opens a browser tab with the operation already expanded.

Run the automated checks with:

```bash
npm run test:todo    # auth, authorization, CRUD, CORS, timing + userscript OAuth flow
npm run test:demos   # live FastAPI + Java, every status code, userscript UI
npm run test:mcp     # MCP client, local browser page, deep link and zero-CORS bridge
```

`test:todo` starts the To-Do API on port 8012 when needed. `test:demos` verifies
every status code in both languages, both OpenAPI documents, and a live `418`
response through the userscript UI.
