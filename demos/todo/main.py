"""To-Do List API demo with authentication, authorization, CORS and full CRUD.

Run:

    python demos/todo/main.py

Then open:

    http://127.0.0.1:8012/docs
    http://127.0.0.1:8012/openapi.json

Demo accounts:

    demo  / demo123   (regular user)
    admin / admin123  (administrator)

Tokens are opaque, expire after eight hours, and live in memory. Data is
in-memory and resets when the process restarts. This is intentionally a demo:
use a real database and a real identity provider in production.
"""
from __future__ import annotations

import hashlib
import hmac
import itertools
import os
import secrets
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Annotated, Any, Literal

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

PORT = int(os.getenv("PORT", "8012"))
TOKEN_TTL_SECONDS = 8 * 60 * 60
PASSWORD_ITERATIONS = 120_000
STARTED_AT = datetime.now(timezone.utc)
LOCK = threading.RLock()

app = FastAPI(
    title="To-Do List Auth Demo",
    version="1.0.0",
    description=(
        "A small but complete To-Do API for testing RouteCraft. It includes "
        "OAuth 2.0 password-flow authentication, per-user authorization, an "
        "admin role, CORS, timing headers and full CRUD.\n\n"
        "**Demo accounts:** `demo / demo123` (user) and `admin / admin123` "
        "(administrator). Use the Authorize button and the password flow, or "
        "call `POST /auth/login` and paste the returned token."
    ),
    docs_url="/docs",
    redoc_url=None,
    openapi_url="/openapi.json",
    openapi_tags=[
        {"name": "health", "description": "Health, metadata and request timing."},
        {"name": "auth", "description": "Register, log in, inspect the current user and log out."},
        {"name": "todos", "description": "Authenticated CRUD for the current user's to-do list."},
        {"name": "admin", "description": "Administrator-only endpoints for every user's list."},
    ],
)

# --------------------------------------------------------------------------- #
# Middleware: request IDs and timing. CORS is added last so it is outermost.
# --------------------------------------------------------------------------- #


@app.middleware("http")
async def add_demo_headers(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
    started = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - started) * 1000
    response.headers["X-Request-Id"] = request_id
    response.headers["X-Process-Time"] = f"{elapsed_ms:.2f}ms"
    response.headers["X-Demo-Server"] = f"todo:{PORT}"
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "X-Request-Id",
        "X-Process-Time",
        "X-Demo-Server",
        "X-Total-Count",
        "Location",
    ],
    max_age=600,
)

# --------------------------------------------------------------------------- #
# Enums and Pydantic models
# --------------------------------------------------------------------------- #


class TodoStatus(str, Enum):
    pending = "pending"
    in_progress = "in_progress"
    completed = "completed"


class TodoPriority(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class UserPublic(BaseModel):
    username: str
    display_name: str
    role: Literal["user", "admin"]
    created_at: datetime


class RegisterRequest(StrictModel):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=6, max_length=128)
    display_name: str | None = Field(default=None, max_length=80)

    @field_validator("username")
    @classmethod
    def clean_username(cls, value: str) -> str:
        return value.strip()

    @field_validator("display_name")
    @classmethod
    def clean_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


class LoginRequest(StrictModel):
    username: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("username")
    @classmethod
    def clean_username(cls, value: str) -> str:
        return value.strip()


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    expires_at: datetime
    scope: str | None = None
    user: UserPublic


class TodoCreate(StrictModel):
    title: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    status: TodoStatus = TodoStatus.pending
    priority: TodoPriority = TodoPriority.medium
    due_date: datetime | None = None
    tags: list[str] = Field(default_factory=list, max_length=12)

    @field_validator("title")
    @classmethod
    def clean_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Title cannot be blank.")
        return value

    @field_validator("description")
    @classmethod
    def clean_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None

    @field_validator("due_date")
    @classmethod
    def normalize_due_date(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, value: list[str]) -> list[str]:
        result: list[str] = []
        seen: set[str] = set()
        for raw in value:
            tag = str(raw).strip()[:24]
            key = tag.lower()
            if tag and key not in seen:
                result.append(tag)
                seen.add(key)
        return result[:12]


class TodoReplace(TodoCreate):
    """Full replacement. Omitted optional fields reset to their defaults."""


class TodoPatch(StrictModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    status: TodoStatus | None = None
    priority: TodoPriority | None = None
    due_date: datetime | None = None
    tags: list[str] | None = Field(default=None, max_length=12)

    @field_validator("title")
    @classmethod
    def clean_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Title cannot be blank.")
        return value

    @field_validator("description")
    @classmethod
    def clean_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None

    @field_validator("due_date")
    @classmethod
    def normalize_due_date(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        return TodoCreate.clean_tags(value)

    @model_validator(mode="after")
    def require_at_least_one_field(self) -> "TodoPatch":
        if not self.model_fields_set:
            raise ValueError("Provide at least one field to update.")
        return self


class TodoOut(BaseModel):
    id: int
    title: str
    description: str | None
    status: TodoStatus
    priority: TodoPriority
    due_date: datetime | None
    tags: list[str]
    owner: str
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None


class TodoList(BaseModel):
    items: list[TodoOut]
    total: int
    limit: int
    offset: int


class TodoStats(BaseModel):
    total: int
    pending: int
    in_progress: int
    completed: int
    overdue: int
    by_priority: dict[str, int]


# --------------------------------------------------------------------------- #
# In-memory data
# --------------------------------------------------------------------------- #


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def ensure_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt),
        PASSWORD_ITERATIONS,
    )
    return f"{salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, expected = stored.split("$", 1)
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            bytes.fromhex(salt),
            PASSWORD_ITERATIONS,
        )
        return hmac.compare_digest(digest.hex(), expected)
    except (ValueError, TypeError):
        return False


USERS: dict[str, dict[str, Any]] = {
    "demo": {
        "username": "demo",
        "display_name": "Demo User",
        "role": "user",
        "password_hash": hash_password("demo123"),
        "created_at": STARTED_AT,
    },
    "admin": {
        "username": "admin",
        "display_name": "Admin User",
        "role": "admin",
        "password_hash": hash_password("admin123"),
        "created_at": STARTED_AT,
    },
}

SESSIONS: dict[str, dict[str, Any]] = {}
TODOS: dict[int, dict[str, Any]] = {}
_todo_ids = itertools.count(1)


def public_user(record: dict[str, Any]) -> UserPublic:
    return UserPublic(
        username=record["username"],
        display_name=record["display_name"],
        role=record["role"],
        created_at=record["created_at"],
    )


def insert_todo(
    owner: str,
    title: str,
    *,
    description: str | None = None,
    status_value: TodoStatus = TodoStatus.pending,
    priority: TodoPriority = TodoPriority.medium,
    due_date: datetime | None = None,
    tags: list[str] | None = None,
    created_at: datetime | None = None,
) -> dict[str, Any]:
    now = created_at or utcnow()
    with LOCK:
        todo_id = next(_todo_ids)
        todo = {
            "id": todo_id,
            "title": title,
            "description": description,
            "status": status_value.value,
            "priority": priority.value,
            "due_date": due_date,
            "tags": list(tags or []),
            "owner": owner,
            "created_at": now,
            "updated_at": now,
            "completed_at": now if status_value is TodoStatus.completed else None,
        }
        TODOS[todo_id] = todo
    return dict(todo)


def seed_data() -> None:
    today = utcnow()
    insert_todo(
        "demo",
        "Try RouteCraft",
        description="Open the docs, click Try it out, and execute this request.",
        priority=TodoPriority.high,
        due_date=today + timedelta(days=1),
        tags=["routecraft", "demo"],
        created_at=today - timedelta(days=2),
    )
    insert_todo(
        "demo",
        "Review the auth flow",
        description="Log in with demo / demo123, then create and update a todo.",
        status_value=TodoStatus.in_progress,
        priority=TodoPriority.medium,
        tags=["auth"],
        created_at=today - timedelta(days=1),
    )
    insert_todo(
        "demo",
        "Completed example",
        description="This one starts in the completed state.",
        status_value=TodoStatus.completed,
        priority=TodoPriority.low,
        tags=["demo"],
        created_at=today - timedelta(days=3),
    )
    insert_todo(
        "admin",
        "Review the admin queue",
        description="Admins can list and delete every user's todos.",
        priority=TodoPriority.high,
        tags=["admin"],
        created_at=today - timedelta(hours=4),
    )


seed_data()

# --------------------------------------------------------------------------- #
# Authentication and authorization
# --------------------------------------------------------------------------- #

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/auth/token",
    scheme_name="todoAuth",
    scopes={
        "todos:read": "Read todos.",
        "todos:write": "Create, update and delete todos.",
        "admin": "Access admin endpoints.",
    },
    description=(
        "Use the password flow with demo / demo123 or admin / admin123. "
        "You can also paste an access token from POST /auth/login."
    ),
)


def unauthorized(detail: str = "Missing, expired, or invalid bearer token.") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def forbidden(detail: str = "You do not have permission to access this resource.") -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def not_found(detail: str = "Todo not found.") -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def prune_sessions() -> None:
    now = utcnow()
    expired = [token for token, session in SESSIONS.items() if session["expires_at"] <= now]
    for token in expired:
        SESSIONS.pop(token, None)


def create_session(username: str, scope: str | None = None) -> tuple[str, datetime]:
    token = secrets.token_urlsafe(32)
    expires_at = utcnow() + timedelta(seconds=TOKEN_TTL_SECONDS)
    with LOCK:
        prune_sessions()
        SESSIONS[token] = {
            "username": username,
            "expires_at": expires_at,
            "scope": scope or "",
        }
    return token, expires_at


def authenticate(username: str, password: str) -> dict[str, Any]:
    with LOCK:
        record = USERS.get(username)
    if not record or not verify_password(password, record["password_hash"]):
        raise unauthorized("Incorrect username or password.")
    return record


def token_response(record: dict[str, Any], scope: str | None = None) -> TokenResponse:
    token, expires_at = create_session(record["username"], scope)
    return TokenResponse(
        access_token=token,
        expires_in=TOKEN_TTL_SECONDS,
        expires_at=expires_at,
        scope=scope or None,
        user=public_user(record),
    )


def get_current_user(token: Annotated[str, Depends(oauth2_scheme)]) -> dict[str, Any]:
    with LOCK:
        prune_sessions()
        session = SESSIONS.get(token)
        if not session:
            raise unauthorized()
        record = USERS.get(session["username"])
        if not record:
            raise unauthorized()
        return dict(record)


def require_admin(user: Annotated[dict[str, Any], Depends(get_current_user)]) -> dict[str, Any]:
    if user["role"] != "admin":
        raise forbidden("Administrator access is required.")
    return user


CurrentUser = Annotated[dict[str, Any], Depends(get_current_user)]
AdminUser = Annotated[dict[str, Any], Depends(require_admin)]

# --------------------------------------------------------------------------- #
# Auth endpoints
# --------------------------------------------------------------------------- #


@app.post(
    "/auth/register",
    response_model=UserPublic,
    status_code=status.HTTP_201_CREATED,
    tags=["auth"],
    summary="Register a regular user",
    responses={409: {"description": "The username is already taken."}},
)
def register(payload: RegisterRequest) -> UserPublic:
    with LOCK:
        if payload.username in USERS:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Username '{payload.username}' is already taken.",
            )
        record = {
            "username": payload.username,
            "display_name": payload.display_name or payload.username,
            "role": "user",
            "password_hash": hash_password(payload.password),
            "created_at": utcnow(),
        }
        USERS[payload.username] = record
    return public_user(record)


@app.post(
    "/auth/login",
    response_model=TokenResponse,
    tags=["auth"],
    summary="Log in with JSON and receive a bearer token",
    responses={401: {"description": "Incorrect username or password."}},
)
def login(payload: LoginRequest) -> TokenResponse:
    record = authenticate(payload.username, payload.password)
    return token_response(record)


@app.post(
    "/auth/token",
    response_model=TokenResponse,
    tags=["auth"],
    summary="OAuth 2.0 password flow",
    description=(
        "Used by the Authorize dialog. Send `username`, `password` and "
        "`grant_type=password` as form fields."
    ),
    responses={401: {"description": "Incorrect username or password."}},
)
def token(form: Annotated[OAuth2PasswordRequestForm, Depends()]) -> TokenResponse:
    record = authenticate(form.username, form.password)
    scope = " ".join(form.scopes) or None
    return token_response(record, scope)


@app.get(
    "/auth/me",
    response_model=UserPublic,
    tags=["auth"],
    summary="Read the authenticated user",
    responses={401: {"description": "Missing, expired, or invalid bearer token."}},
)
def me(user: CurrentUser) -> UserPublic:
    return public_user(user)


@app.post(
    "/auth/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["auth"],
    summary="Invalidate the current bearer token",
    responses={401: {"description": "Missing, expired, or invalid bearer token."}},
)
def logout(token: Annotated[str, Depends(oauth2_scheme)]) -> Response:
    with LOCK:
        prune_sessions()
        session = SESSIONS.pop(token, None)
    if not session:
        raise unauthorized()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

# --------------------------------------------------------------------------- #
# To-do helpers
# --------------------------------------------------------------------------- #

SortField = Literal["created_at", "updated_at", "due_date", "priority", "title"]


def find_todo(todo_id: int, user: dict[str, Any]) -> dict[str, Any]:
    with LOCK:
        todo = TODOS.get(todo_id)
        if not todo:
            raise not_found()
        if user["role"] != "admin" and todo["owner"] != user["username"]:
            raise forbidden("This todo belongs to another user.")
        return dict(todo)


def collect_todos(
    user: dict[str, Any],
    *,
    all_owners: bool,
    owner: str | None,
    status_filter: TodoStatus | None,
    priority: TodoPriority | None,
    q: str | None,
    tag: str | None,
    due_before: datetime | None,
    due_after: datetime | None,
) -> list[dict[str, Any]]:
    due_before = ensure_utc(due_before)
    due_after = ensure_utc(due_after)

    with LOCK:
        values = [dict(todo) for todo in TODOS.values()]

    if owner is not None:
        if user["role"] != "admin" and owner != user["username"]:
            raise forbidden("Only administrators can filter by another owner.")
        values = [todo for todo in values if todo["owner"] == owner]
    elif all_owners and user["role"] == "admin":
        pass
    else:
        values = [todo for todo in values if todo["owner"] == user["username"]]

    if status_filter is not None:
        values = [todo for todo in values if todo["status"] == status_filter.value]
    if priority is not None:
        values = [todo for todo in values if todo["priority"] == priority.value]
    if q:
        needle = q.casefold()
        values = [
            todo
            for todo in values
            if needle in todo["title"].casefold()
            or needle in (todo["description"] or "").casefold()
            or any(needle in item.casefold() for item in todo["tags"])
        ]
    if tag:
        wanted = tag.casefold()
        values = [todo for todo in values if any(item.casefold() == wanted for item in todo["tags"])]
    if due_before is not None:
        values = [todo for todo in values if todo["due_date"] and todo["due_date"] <= due_before]
    if due_after is not None:
        values = [todo for todo in values if todo["due_date"] and todo["due_date"] >= due_after]
    return values


def sort_todos(
    values: list[dict[str, Any]],
    sort_field: SortField,
    order: Literal["asc", "desc"],
) -> list[dict[str, Any]]:
    priority_rank = {"low": 0, "medium": 1, "high": 2}

    def key(todo: dict[str, Any]):
        if sort_field == "priority":
            return priority_rank.get(todo["priority"], -1)
        if sort_field == "title":
            return todo["title"].casefold()
        if sort_field == "due_date":
            return todo["due_date"] or datetime.max.replace(tzinfo=timezone.utc)
        return todo[sort_field]

    return sorted(values, key=key, reverse=order == "desc")


def paginate(values: list[dict[str, Any]], limit: int, offset: int) -> list[dict[str, Any]]:
    return values[offset : offset + limit]


def make_list(values: list[dict[str, Any]], limit: int, offset: int) -> TodoList:
    return TodoList(
        items=[TodoOut(**todo) for todo in paginate(values, limit, offset)],
        total=len(values),
        limit=limit,
        offset=offset,
    )


def stats_from(values: list[dict[str, Any]]) -> TodoStats:
    now = utcnow()
    by_priority = {priority.value: 0 for priority in TodoPriority}
    for todo in values:
        by_priority[todo["priority"]] = by_priority.get(todo["priority"], 0) + 1
    return TodoStats(
        total=len(values),
        pending=sum(1 for todo in values if todo["status"] == TodoStatus.pending.value),
        in_progress=sum(1 for todo in values if todo["status"] == TodoStatus.in_progress.value),
        completed=sum(1 for todo in values if todo["status"] == TodoStatus.completed.value),
        overdue=sum(
            1
            for todo in values
            if todo["due_date"] is not None
            and todo["due_date"] < now
            and todo["status"] != TodoStatus.completed.value
        ),
        by_priority=by_priority,
    )


def apply_create(payload: TodoCreate, owner: str) -> dict[str, Any]:
    now = utcnow()
    with LOCK:
        todo_id = next(_todo_ids)
        todo = {
            "id": todo_id,
            "title": payload.title,
            "description": payload.description,
            "status": payload.status.value,
            "priority": payload.priority.value,
            "due_date": payload.due_date,
            "tags": payload.tags,
            "owner": owner,
            "created_at": now,
            "updated_at": now,
            "completed_at": now if payload.status is TodoStatus.completed else None,
        }
        TODOS[todo_id] = todo
    return dict(todo)


def apply_replace(
    todo_id: int,
    payload: TodoReplace,
    user: dict[str, Any],
) -> dict[str, Any]:
    with LOCK:
        todo = TODOS.get(todo_id)
        if not todo:
            raise not_found()
        if user["role"] != "admin" and todo["owner"] != user["username"]:
            raise forbidden("This todo belongs to another user.")
        now = utcnow()
        was_completed = todo["status"] == TodoStatus.completed.value
        completed_at = todo["completed_at"]
        if payload.status is TodoStatus.completed:
            completed_at = completed_at if was_completed and completed_at else now
        else:
            completed_at = None
        todo.update(
            {
                "title": payload.title,
                "description": payload.description,
                "status": payload.status.value,
                "priority": payload.priority.value,
                "due_date": payload.due_date,
                "tags": payload.tags,
                "updated_at": now,
                "completed_at": completed_at,
            }
        )
        return dict(todo)


def apply_patch(
    todo_id: int,
    payload: TodoPatch,
    user: dict[str, Any],
) -> dict[str, Any]:
    with LOCK:
        todo = TODOS.get(todo_id)
        if not todo:
            raise not_found()
        if user["role"] != "admin" and todo["owner"] != user["username"]:
            raise forbidden("This todo belongs to another user.")
        updates = payload.model_dump(exclude_unset=True)
        now = utcnow()
        for field, value in updates.items():
            if field == "status":
                status_value = value.value if isinstance(value, TodoStatus) else value
                todo["status"] = status_value
                if status_value == TodoStatus.completed.value:
                    todo["completed_at"] = todo["completed_at"] or now
                else:
                    todo["completed_at"] = None
            elif field == "priority":
                todo["priority"] = value.value if isinstance(value, TodoPriority) else value
            elif field == "tags":
                todo["tags"] = list(value or [])
            else:
                todo[field] = value
        todo["updated_at"] = now
        return dict(todo)


# --------------------------------------------------------------------------- #
# Health endpoints
# --------------------------------------------------------------------------- #


@app.get("/", tags=["health"], summary="Service metadata")
def root() -> dict[str, Any]:
    return {
        "service": "To-Do List Auth Demo",
        "docs": "/docs",
        "openapi": "/openapi.json",
        "auth": {
            "type": "OAuth 2.0 password flow",
            "token_url": "/auth/token",
            "login_url": "/auth/login",
        },
        "accounts": ["demo (user)", "admin (administrator)"],
    }


@app.get("/health", tags=["health"], summary="Health check and counts")
def health() -> dict[str, Any]:
    with LOCK:
        users = len(USERS)
        todos = len(TODOS)
        sessions = len(SESSIONS)
    return {
        "status": "healthy",
        "service": "To-Do List Auth Demo",
        "port": PORT,
        "started_at": STARTED_AT.isoformat(),
        "users": users,
        "todos": todos,
        "sessions": sessions,
    }

# --------------------------------------------------------------------------- #
# Authenticated to-do endpoints
# --------------------------------------------------------------------------- #


@app.get(
    "/todos",
    response_model=TodoList,
    tags=["todos"],
    summary="List the current user's todos",
    description=(
        "Filter by status, priority, text, tag or due date. Paginate with "
        "`limit` and `offset`, and sort by `created_at`, `updated_at`, "
        "`due_date`, `priority` or `title`. Administrators may add `owner` "
        "to read another user's list."
    ),
    responses={
        401: {"description": "Missing, expired, or invalid bearer token."},
        403: {"description": "Only administrators can filter by another owner."},
    },
)
def list_todos(
    response: Response,
    user: CurrentUser,
    status_filter: Annotated[TodoStatus | None, Query(alias="status")] = None,
    priority: TodoPriority | None = Query(default=None),
    q: str | None = Query(default=None, min_length=1, max_length=100),
    tag: str | None = Query(default=None, min_length=1, max_length=24),
    owner: str | None = Query(default=None, description="Administrator only."),
    due_before: datetime | None = Query(default=None),
    due_after: datetime | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    sort: SortField = Query(default="created_at"),
    order: Literal["asc", "desc"] = Query(default="desc"),
) -> TodoList:
    values = collect_todos(
        user,
        all_owners=False,
        owner=owner,
        status_filter=status_filter,
        priority=priority,
        q=q,
        tag=tag,
        due_before=due_before,
        due_after=due_after,
    )
    values = sort_todos(values, sort, order)
    result = make_list(values, limit, offset)
    response.headers["X-Total-Count"] = str(result.total)
    return result


@app.get(
    "/todos/stats",
    response_model=TodoStats,
    tags=["todos"],
    summary="Count the current user's todos by status and priority",
    responses={
        401: {"description": "Missing, expired, or invalid bearer token."},
        403: {"description": "Only administrators can filter by another owner."},
    },
)
def todo_stats(
    user: CurrentUser,
    owner: str | None = Query(default=None, description="Administrator only."),
) -> TodoStats:
    values = collect_todos(
        user,
        all_owners=False,
        owner=owner,
        status_filter=None,
        priority=None,
        q=None,
        tag=None,
        due_before=None,
        due_after=None,
    )
    return stats_from(values)


@app.post(
    "/todos",
    response_model=TodoOut,
    status_code=status.HTTP_201_CREATED,
    tags=["todos"],
    summary="Create a todo",
    responses={
        401: {"description": "Missing, expired, or invalid bearer token."},
        422: {"description": "Validation error."},
    },
)
def create_todo(payload: TodoCreate, response: Response, user: CurrentUser) -> TodoOut:
    todo = apply_create(payload, user["username"])
    response.headers["Location"] = f"/todos/{todo['id']}"
    return TodoOut(**todo)


@app.delete(
    "/todos",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["todos"],
    summary="Delete every todo in the current user's list",
    responses={
        401: {"description": "Missing, expired, or invalid bearer token."},
        403: {"description": "Only administrators can delete another owner's list."},
    },
)
def clear_todos(
    user: CurrentUser,
    owner: str | None = Query(default=None, description="Administrator only."),
) -> Response:
    target = owner
    if target is not None and user["role"] != "admin" and target != user["username"]:
        raise forbidden("Only administrators can clear another user's list.")
    target = target or user["username"]
    with LOCK:
        ids = [todo_id for todo_id, todo in TODOS.items() if todo["owner"] == target]
        for todo_id in ids:
            TODOS.pop(todo_id, None)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get(
    "/todos/{todo_id}",
    response_model=TodoOut,
    tags=["todos"],
    summary="Read one todo",
    responses={
        401: {"description": "Missing, expired, or invalid bearer token."},
        403: {"description": "The todo belongs to another user."},
        404: {"description": "Todo not found."},
    },
)
def get_todo(todo_id: int, user: CurrentUser) -> TodoOut:
    return TodoOut(**find_todo(todo_id, user))


@app.put(
    "/todos/{todo_id}",
    response_model=TodoOut,
    tags=["todos"],
    summary="Replace a todo",
    description="All omitted optional fields reset to their defaults.",
    responses={
        401: {"description": "Missing, expired, or invalid bearer token."},
        403: {"description": "The todo belongs to another user."},
        404: {"description": "Todo not found."},
        422: {"description": "Validation error."},
    },
)
def replace_todo(todo_id: int, payload: TodoReplace, user: CurrentUser) -> TodoOut:
    return TodoOut(**apply_replace(todo_id, payload, user))


@app.patch(
    "/todos/{todo_id}",
    response_model=TodoOut,
    tags=["todos"],
    summary="Update part of a todo",
    responses={
        401: {"description": "Missing, expired, or invalid bearer token."},
        403: {"description": "The todo belongs to another user."},
        404: {"description": "Todo not found."},
        422: {"description": "Validation error."},
    },
)
def patch_todo(todo_id: int, payload: TodoPatch, user: CurrentUser) -> TodoOut:
    return TodoOut(**apply_patch(todo_id, payload, user))


@app.delete(
    "/todos/{todo_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["todos"],
    summary="Delete one todo",
    responses={
        401: {"description": "Missing, expired, or invalid bearer token."},
        403: {"description": "The todo belongs to another user."},
        404: {"description": "Todo not found."},
    },
)
def delete_todo(todo_id: int, user: CurrentUser) -> Response:
    with LOCK:
        todo = TODOS.get(todo_id)
        if not todo:
            raise not_found()
        if user["role"] != "admin" and todo["owner"] != user["username"]:
            raise forbidden("This todo belongs to another user.")
        TODOS.pop(todo_id, None)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post(
    "/todos/{todo_id}/complete",
    response_model=TodoOut,
    tags=["todos"],
    summary="Mark a todo complete",
    responses={
        401: {"description": "Missing, expired, or invalid bearer token."},
        403: {"description": "The todo belongs to another user."},
        404: {"description": "Todo not found."},
    },
)
def complete_todo(todo_id: int, user: CurrentUser) -> TodoOut:
    return TodoOut(**apply_patch(todo_id, TodoPatch(status=TodoStatus.completed), user))


@app.post(
    "/todos/{todo_id}/reopen",
    response_model=TodoOut,
    tags=["todos"],
    summary="Reopen a completed todo",
    responses={
        401: {"description": "Missing, expired, or invalid bearer token."},
        403: {"description": "The todo belongs to another user."},
        404: {"description": "Todo not found."},
    },
)
def reopen_todo(todo_id: int, user: CurrentUser) -> TodoOut:
    return TodoOut(**apply_patch(todo_id, TodoPatch(status=TodoStatus.pending), user))

# --------------------------------------------------------------------------- #
# Administrator endpoints
# --------------------------------------------------------------------------- #


@app.get(
    "/admin/todos",
    response_model=TodoList,
    tags=["admin"],
    summary="List every user's todos",
    responses={
        401: {"description": "Missing, expired, or invalid bearer token."},
        403: {"description": "Administrator access is required."},
    },
)
def admin_list_todos(
    response: Response,
    user: AdminUser,
    status_filter: Annotated[TodoStatus | None, Query(alias="status")] = None,
    priority: TodoPriority | None = Query(default=None),
    q: str | None = Query(default=None, min_length=1, max_length=100),
    tag: str | None = Query(default=None, min_length=1, max_length=24),
    owner: str | None = Query(default=None),
    due_before: datetime | None = Query(default=None),
    due_after: datetime | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    sort: SortField = Query(default="created_at"),
    order: Literal["asc", "desc"] = Query(default="desc"),
) -> TodoList:
    values = collect_todos(
        user,
        all_owners=True,
        owner=owner,
        status_filter=status_filter,
        priority=priority,
        q=q,
        tag=tag,
        due_before=due_before,
        due_after=due_after,
    )
    values = sort_todos(values, sort, order)
    result = make_list(values, limit, offset)
    response.headers["X-Total-Count"] = str(result.total)
    return result


@app.get(
    "/admin/stats",
    response_model=TodoStats,
    tags=["admin"],
    summary="Count every user's todos",
    responses={
        401: {"description": "Missing, expired, or invalid bearer token."},
        403: {"description": "Administrator access is required."},
    },
)
def admin_stats(user: AdminUser, owner: str | None = Query(default=None)) -> TodoStats:
    values = collect_todos(
        user,
        all_owners=True,
        owner=owner,
        status_filter=None,
        priority=None,
        q=None,
        tag=None,
        due_before=None,
        due_after=None,
    )
    return stats_from(values)


@app.get(
    "/admin/todos/{todo_id}",
    response_model=TodoOut,
    tags=["admin"],
    summary="Read any user's todo",
    responses={
        401: {"description": "Missing, expired, or invalid bearer token."},
        403: {"description": "Administrator access is required."},
        404: {"description": "Todo not found."},
    },
)
def admin_get_todo(todo_id: int, user: AdminUser) -> TodoOut:
    return TodoOut(**find_todo(todo_id, user))


@app.delete(
    "/admin/todos/{todo_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["admin"],
    summary="Delete any user's todo",
    responses={
        401: {"description": "Missing, expired, or invalid bearer token."},
        403: {"description": "Administrator access is required."},
        404: {"description": "Todo not found."},
    },
)
def admin_delete_todo(todo_id: int, user: AdminUser) -> Response:
    with LOCK:
        if todo_id not in TODOS:
            raise not_found()
        TODOS.pop(todo_id, None)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.delete(
    "/admin/todos",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["admin"],
    summary="Delete every todo, or every todo for one owner",
    responses={
        401: {"description": "Missing, expired, or invalid bearer token."},
        403: {"description": "Administrator access is required."},
    },
)
def admin_clear_todos(user: AdminUser, owner: str | None = Query(default=None)) -> Response:
    with LOCK:
        ids = [
            todo_id
            for todo_id, todo in TODOS.items()
            if owner is None or todo["owner"] == owner
        ]
        for todo_id in ids:
            TODOS.pop(todo_id, None)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/rc", include_in_schema=False)
def rc_redirect():
    """Shortcut alias for /docs. Type /rc to load RouteCraft instantly."""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/docs?rc=1")


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT)

