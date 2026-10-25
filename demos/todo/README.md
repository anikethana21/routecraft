# To-Do List Auth Demo

A small FastAPI API for testing RouteCraft against a realistic, authenticated
CRUD service. Everything is in memory, so restarting the process resets the
data.

## Run

From the repository root:

```bash
python demos/todo/main.py
```

Or:

```bash
npm run demo:todo
```

| Item | URL |
| --- | --- |
| Swagger UI | <http://127.0.0.1:8012/docs> |
| OpenAPI document | <http://127.0.0.1:8012/openapi.json> |
| Health check | <http://127.0.0.1:8012/health> |

Requires Python 3.10+ with FastAPI, Uvicorn and `python-multipart`:

```bash
python -m pip install -r demos/todo/requirements.txt
```

## Demo accounts

| Username | Password | Role |
| --- | --- | --- |
| `demo` | `demo123` | user |
| `admin` | `admin123` | administrator |

## Authorize in RouteCraft

1. Open <http://127.0.0.1:8012/docs> and start RouteCraft.
2. Click **Authorize**.
3. Open the `todoAuth` card. It uses the OAuth 2.0 password flow.
4. Enter `demo` and `demo123`, leave Client ID and Client secret empty, and click
   **Get token**.
5. Click **Save**.

You can also call `POST /auth/login` with:

```json
{ "username": "demo", "password": "demo123" }
```

Then paste the returned `access_token` into the Authorize dialog. Tokens expire
after eight hours.

## What is implemented

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/auth/register` | Create a regular user |
| `POST` | `/auth/login` | JSON login, returns a bearer token |
| `POST` | `/auth/token` | OAuth 2.0 password flow, used by Authorize |
| `GET` | `/auth/me` | Current user |
| `POST` | `/auth/logout` | Invalidate the current token |
| `GET` | `/todos` | List/filter/sort/paginate the current user's todos |
| `POST` | `/todos` | Create a todo |
| `GET` | `/todos/stats` | Counts by status and priority |
| `GET` | `/todos/{id}` | Read one todo |
| `PUT` | `/todos/{id}` | Replace a todo |
| `PATCH` | `/todos/{id}` | Update part of a todo |
| `DELETE` | `/todos/{id}` | Delete a todo |
| `POST` | `/todos/{id}/complete` | Mark complete |
| `POST` | `/todos/{id}/reopen` | Reopen |
| `DELETE` | `/todos` | Clear the current user's list |
| `GET` | `/admin/todos` | List every user's todos (admin) |
| `GET` | `/admin/stats` | Counts across every user (admin) |
| `GET` | `/admin/todos/{id}` | Read any todo (admin) |
| `DELETE` | `/admin/todos/{id}` | Delete any todo (admin) |
| `DELETE` | `/admin/todos` | Clear every todo (admin) |

`GET /todos` supports `status`, `priority`, `q`, `tag`, `due_before`,
`due_after`, `limit`, `offset`, `sort` and `order`. Administrators can add
`owner` to read another user's list.

## Authorization rules

- A regular user only sees and changes their own todos.
- Reading or changing another user's todo returns `403`.
- The `/admin/*` endpoints require the `admin` account and return `403` for
  regular users.
- Missing, expired or invalid tokens return `401`.
- Deleting a todo returns `204`; reading it afterwards returns `404`.

## CORS and timings

CORS is open for demo use. Every response includes:

- `X-Request-Id` â€” the caller's request ID or a generated one.
- `X-Process-Time` â€” server processing time in milliseconds.
- `X-Demo-Server` â€” `todo:8012`.

List endpoints also return `X-Total-Count`.

Test the preflight:

```bash
curl -i -X OPTIONS http://127.0.0.1:8012/todos \
  -H "Origin: http://example.test" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type"
```

## Automated check

```bash
npm run test:todo
```

The check starts the API on port 8012 if needed, exercises authentication,
authorization, validation, CRUD, filters, admin routes, CORS and timing
headers, and (when the userscript build exists) drives the OAuth password flow
and `GET /todos` in RouteCraft.

