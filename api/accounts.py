"""User accounts + per-user watchlists on SQLite.

Design notes (mirrors the hardening posture of app.py):
- Passwords are hashed with Werkzeug's scrypt (salted, memory-hard); the
  plaintext never touches the database or logs.
- Login state is a signed, HttpOnly, SameSite=Lax session cookie. The signing
  key is read from SECRET_KEY or generated once into data/.secret_key (0600).
- All queries are parameterized; symbols are validated against the same
  strict ticker regex the predict endpoint uses before they are stored or
  passed to yfinance.
- Auth endpoints get a stricter per-IP rate limit than the general API to
  slow online password guessing, and login returns the same generic error
  for wrong-username and wrong-password (with a dummy hash check to keep the
  timing similar).
"""

import logging
import os
import re
import secrets
import sqlite3
import time
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import yfinance as yf
from flask import Blueprint, g, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

logger = logging.getLogger(__name__)

bp = Blueprint("accounts", __name__)

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("APP_DB_PATH", ROOT / "data" / "app.db"))
SECRET_KEY_PATH = ROOT / "data" / ".secret_key"

USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,32}$")
PASSWORD_MIN = 8
PASSWORD_MAX = 128  # scrypt work scales with input length; cap it
TICKER_RE = re.compile(r"^\^?[A-Z0-9][A-Z0-9.\-=]{0,9}$")
WATCHLIST_MAX = 100
PAGE_MAX = 25

# Stricter than the general limiter: 10 auth attempts per IP per minute.
AUTH_LIMIT_REQUESTS = 10
AUTH_LIMIT_WINDOW_SECONDS = 60.0
_auth_log: dict[str, deque] = defaultdict(deque)

# Constant-time-ish dummy so login cost is similar whether or not the
# username exists.
_DUMMY_HASH = generate_password_hash("dummy-password-for-timing")

QUOTE_TTL_SECONDS = 10 * 60
_quote_cache: dict[str, tuple[dict | None, float]] = {}


def load_or_create_secret_key() -> str:
    env = os.environ.get("SECRET_KEY")
    if env:
        return env
    SECRET_KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
    if SECRET_KEY_PATH.exists():
        return SECRET_KEY_PATH.read_text().strip()
    key = secrets.token_hex(32)
    fd = os.open(SECRET_KEY_PATH, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(key)
    return key


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, symbol)
);
CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id, added_at DESC);
"""


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(SCHEMA)


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db


@bp.teardown_app_request
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def _auth_rate_limited(client_ip: str) -> bool:
    now = time.monotonic()
    window = _auth_log[client_ip]
    while window and now - window[0] > AUTH_LIMIT_WINDOW_SECONDS:
        window.popleft()
    if len(window) >= AUTH_LIMIT_REQUESTS:
        return True
    window.append(now)
    return False


def _json_body() -> dict | None:
    """Reject non-JSON bodies. Combined with SameSite=Lax cookies this also
    blocks classic form-based CSRF: a cross-site <form> can't send
    application/json without a CORS preflight."""
    if not request.is_json:
        return None
    body = request.get_json(silent=True)
    return body if isinstance(body, dict) else None


def current_user_id() -> int | None:
    uid = session.get("uid")
    return uid if isinstance(uid, int) else None


def login_required(view):
    from functools import wraps

    @wraps(view)
    def wrapped(*args, **kwargs):
        if current_user_id() is None:
            return jsonify({"error": "Please log in first."}), 401
        return view(*args, **kwargs)

    return wrapped


# ---------------------------------------------------------------- auth


@bp.post("/api/auth/register")
def register():
    if _auth_rate_limited(request.remote_addr or "unknown"):
        return jsonify({"error": "Too many attempts — try again in a minute."}), 429
    body = _json_body()
    if body is None:
        return jsonify({"error": "Expected a JSON body."}), 400
    username = str(body.get("username", "")).strip()
    password = str(body.get("password", ""))
    if not USERNAME_RE.fullmatch(username):
        return jsonify({"error": "Username must be 3–32 characters: letters, digits, underscore."}), 400
    if not (PASSWORD_MIN <= len(password) <= PASSWORD_MAX):
        return jsonify({"error": f"Password must be {PASSWORD_MIN}–{PASSWORD_MAX} characters."}), 400

    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            (username, generate_password_hash(password)),
        )
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({"error": "That username is taken."}), 409

    session.clear()
    session["uid"] = cur.lastrowid
    session.permanent = True
    return jsonify({"username": username}), 201


@bp.post("/api/auth/login")
def login():
    if _auth_rate_limited(request.remote_addr or "unknown"):
        return jsonify({"error": "Too many attempts — try again in a minute."}), 429
    body = _json_body()
    if body is None:
        return jsonify({"error": "Expected a JSON body."}), 400
    username = str(body.get("username", "")).strip()
    password = str(body.get("password", ""))[:PASSWORD_MAX]

    row = get_db().execute(
        "SELECT id, username, password_hash FROM users WHERE username = ?", (username,)
    ).fetchone()
    if row is None:
        check_password_hash(_DUMMY_HASH, password)  # keep timing similar
        return jsonify({"error": "Invalid username or password."}), 401
    if not check_password_hash(row["password_hash"], password):
        return jsonify({"error": "Invalid username or password."}), 401

    session.clear()  # fresh session id: no fixation carry-over
    session["uid"] = row["id"]
    session.permanent = True
    return jsonify({"username": row["username"]})


@bp.post("/api/auth/logout")
def logout():
    # Same JSON gate as the other mutating endpoints so a cross-site form
    # can't even force a nuisance logout.
    if _json_body() is None:
        return jsonify({"error": "Expected a JSON body."}), 400
    session.clear()
    return jsonify({"ok": True})


@bp.get("/api/auth/me")
def me():
    uid = current_user_id()
    if uid is None:
        return jsonify({"user": None})
    row = get_db().execute("SELECT username FROM users WHERE id = ?", (uid,)).fetchone()
    if row is None:  # user deleted since cookie was issued
        session.clear()
        return jsonify({"user": None})
    return jsonify({"user": {"username": row["username"]}})


# ------------------------------------------------------------ watchlist


def _fetch_quote(symbol: str) -> dict | None:
    """Last close + day change for a watchlist row, cached for QUOTE_TTL."""
    cached = _quote_cache.get(symbol)
    if cached and time.monotonic() - cached[1] < QUOTE_TTL_SECONDS:
        return cached[0]
    quote = None
    try:
        hist = yf.Ticker(symbol).history(period="5d", auto_adjust=True)
        closes = hist["Close"].dropna()
        if len(closes) >= 2:
            last, prev = float(closes.iloc[-1]), float(closes.iloc[-2])
            quote = {
                "last": round(last, 2),
                "change_pct": round((last - prev) / prev * 100, 2),
            }
    except Exception:
        logger.warning("Quote fetch failed for %s", symbol)
    _quote_cache[symbol] = (quote, time.monotonic())
    return quote


@bp.get("/api/watchlist")
@login_required
def watchlist_page():
    try:
        offset = max(int(request.args.get("offset", 0)), 0)
        limit = min(max(int(request.args.get("limit", 10)), 1), PAGE_MAX)
    except ValueError:
        return jsonify({"error": "offset and limit must be integers."}), 400

    uid = current_user_id()
    db = get_db()
    total = db.execute(
        "SELECT COUNT(*) AS n FROM watchlist WHERE user_id = ?", (uid,)
    ).fetchone()["n"]
    rows = db.execute(
        "SELECT symbol, added_at FROM watchlist WHERE user_id = ?"
        " ORDER BY added_at DESC, id DESC LIMIT ? OFFSET ?",
        (uid, limit, offset),
    ).fetchall()

    # Quotes fetched concurrently — cold-cache pages would otherwise cost one
    # serial yfinance round-trip per row.
    symbols = [r["symbol"] for r in rows]
    with ThreadPoolExecutor(max_workers=min(8, max(len(symbols), 1))) as pool:
        quotes = dict(zip(symbols, pool.map(_fetch_quote, symbols)))
    items = [
        {"symbol": r["symbol"], "added_at": r["added_at"], "quote": quotes[r["symbol"]]}
        for r in rows
    ]
    return jsonify({
        "items": items,
        "total": total,
        "offset": offset,
        "has_more": offset + len(rows) < total,
    })


@bp.get("/api/watchlist/symbols")
@login_required
def watchlist_symbols():
    """All saved symbols, no quotes — lets the search view mark saved stocks
    without paging through the whole list."""
    rows = get_db().execute(
        "SELECT symbol FROM watchlist WHERE user_id = ? ORDER BY added_at DESC, id DESC",
        (current_user_id(),),
    ).fetchall()
    return jsonify({"symbols": [r["symbol"] for r in rows]})


@bp.post("/api/watchlist")
@login_required
def watchlist_add():
    body = _json_body()
    if body is None:
        return jsonify({"error": "Expected a JSON body."}), 400
    symbol = str(body.get("symbol", "")).strip().upper()
    if not TICKER_RE.fullmatch(symbol):
        return jsonify({"error": "Invalid ticker format."}), 400

    uid = current_user_id()
    db = get_db()
    count = db.execute(
        "SELECT COUNT(*) AS n FROM watchlist WHERE user_id = ?", (uid,)
    ).fetchone()["n"]
    if count >= WATCHLIST_MAX:
        return jsonify({"error": f"Watchlist is full ({WATCHLIST_MAX} symbols max)."}), 400
    try:
        db.execute(
            "INSERT INTO watchlist (user_id, symbol) VALUES (?, ?)", (uid, symbol)
        )
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({"error": "Already on your watchlist.", "symbol": symbol}), 409
    return jsonify({"ok": True, "symbol": symbol}), 201


@bp.delete("/api/watchlist/<symbol>")
@login_required
def watchlist_remove(symbol: str):
    symbol = symbol.strip().upper()
    if not TICKER_RE.fullmatch(symbol):
        return jsonify({"error": "Invalid ticker format."}), 400
    db = get_db()
    cur = db.execute(
        "DELETE FROM watchlist WHERE user_id = ? AND symbol = ?",
        (current_user_id(), symbol),
    )
    db.commit()
    if cur.rowcount == 0:
        return jsonify({"error": "Not on your watchlist."}), 404
    return jsonify({"ok": True})
