"""Auth + watchlist endpoint tests against a throwaway SQLite database."""

import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from api import accounts
from api import app as api_app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(accounts, "DB_PATH", tmp_path / "test.db")
    accounts.init_db()
    accounts._auth_log.clear()
    accounts._quote_cache.clear()
    api_app.app.config["TESTING"] = True
    return api_app.app.test_client()


def register(client, username="alice_1", password="correct horse"):
    return client.post(
        "/api/auth/register", json={"username": username, "password": password}
    )


# ------------------------------------------------------------------ auth


def test_register_login_me_logout_roundtrip(client):
    assert register(client).status_code == 201
    assert client.get("/api/auth/me").get_json()["user"]["username"] == "alice_1"

    assert client.post("/api/auth/logout", json={}).status_code == 200
    assert client.get("/api/auth/me").get_json()["user"] is None

    ok = client.post("/api/auth/login", json={"username": "alice_1", "password": "correct horse"})
    assert ok.status_code == 200
    assert client.get("/api/auth/me").get_json()["user"]["username"] == "alice_1"


def test_register_rejects_bad_usernames_and_short_passwords(client):
    for bad in ["ab", "has space", "semi;colon", "x" * 33, ""]:
        r = register(client, username=bad)
        assert r.status_code == 400, bad
    assert register(client, password="short").status_code == 400


def test_register_duplicate_username_conflicts_case_insensitively(client):
    assert register(client, username="Alice_1").status_code == 201
    assert register(client, username="alice_1").status_code == 409


def test_login_wrong_password_and_unknown_user_same_error(client):
    register(client)
    client.post("/api/auth/logout", json={})
    wrong = client.post("/api/auth/login", json={"username": "alice_1", "password": "not it, sorry"})
    unknown = client.post("/api/auth/login", json={"username": "nobody_9", "password": "whatever12"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.get_json() == unknown.get_json()


def test_auth_requires_json_body(client):
    r = client.post("/api/auth/register", data="username=alice&password=12345678")
    assert r.status_code == 400


def test_auth_rate_limit(client):
    for _ in range(accounts.AUTH_LIMIT_REQUESTS):
        client.post("/api/auth/login", json={"username": "alice_1", "password": "wrong password"})
    r = client.post("/api/auth/login", json={"username": "alice_1", "password": "wrong password"})
    assert r.status_code == 429


def test_change_password(client):
    register(client)
    r = client.post(
        "/api/auth/change-password",
        json={"current_password": "wrong guess!", "new_password": "a whole new pw"},
    )
    assert r.status_code == 401

    r = client.post(
        "/api/auth/change-password",
        json={"current_password": "correct horse", "new_password": "short"},
    )
    assert r.status_code == 400

    r = client.post(
        "/api/auth/change-password",
        json={"current_password": "correct horse", "new_password": "a whole new pw"},
    )
    assert r.status_code == 200

    client.post("/api/auth/logout", json={})
    old = client.post("/api/auth/login", json={"username": "alice_1", "password": "correct horse"})
    assert old.status_code == 401
    new = client.post("/api/auth/login", json={"username": "alice_1", "password": "a whole new pw"})
    assert new.status_code == 200


def test_change_password_requires_login(client):
    r = client.post(
        "/api/auth/change-password",
        json={"current_password": "x" * 8, "new_password": "y" * 8},
    )
    assert r.status_code == 401


def test_password_is_stored_hashed(client, tmp_path):
    register(client, password="super secret pw")
    import sqlite3

    row = sqlite3.connect(tmp_path / "test.db").execute(
        "SELECT password_hash FROM users"
    ).fetchone()
    assert "super secret pw" not in row[0]
    assert row[0].startswith(("scrypt:", "pbkdf2:"))


# -------------------------------------------------------------- watchlist


def test_watchlist_requires_login(client):
    assert client.get("/api/watchlist").status_code == 401
    assert client.post("/api/watchlist", json={"symbol": "AAPL"}).status_code == 401
    assert client.delete("/api/watchlist/AAPL").status_code == 401


def test_watchlist_add_list_remove(client):
    register(client)
    assert client.post("/api/watchlist", json={"symbol": "aapl"}).status_code == 201
    assert client.post("/api/watchlist", json={"symbol": "AAPL"}).status_code == 409
    assert client.post("/api/watchlist", json={"symbol": "not a ticker!"}).status_code == 400

    with patch.object(accounts, "_fetch_quote", return_value=None):
        data = client.get("/api/watchlist").get_json()
    assert data["total"] == 1
    assert data["items"][0]["symbol"] == "AAPL"
    assert data["has_more"] is False

    assert client.delete("/api/watchlist/AAPL").status_code == 200
    assert client.delete("/api/watchlist/AAPL").status_code == 404


def test_watchlist_pagination(client):
    register(client)
    for i in range(12):
        client.post("/api/watchlist", json={"symbol": f"T{i}"})
    with patch.object(accounts, "_fetch_quote", return_value=None):
        page1 = client.get("/api/watchlist?offset=0&limit=10").get_json()
        page2 = client.get("/api/watchlist?offset=10&limit=10").get_json()
    assert page1["total"] == 12 and len(page1["items"]) == 10 and page1["has_more"]
    assert len(page2["items"]) == 2 and not page2["has_more"]
    symbols = [i["symbol"] for i in page1["items"] + page2["items"]]
    assert len(set(symbols)) == 12


def test_watchlists_are_per_user(client):
    register(client, username="alice_1")
    client.post("/api/watchlist", json={"symbol": "AAPL"})
    client.post("/api/auth/logout", json={})

    register(client, username="bob_2")
    client.post("/api/watchlist", json={"symbol": "QCOM"})
    with patch.object(accounts, "_fetch_quote", return_value=None):
        data = client.get("/api/watchlist").get_json()
    assert [i["symbol"] for i in data["items"]] == ["QCOM"]

    symbols = client.get("/api/watchlist/symbols").get_json()["symbols"]
    assert symbols == ["QCOM"]


def test_watchlist_cap(client):
    register(client)
    with patch.object(accounts, "WATCHLIST_MAX", 3):
        for i in range(3):
            assert client.post("/api/watchlist", json={"symbol": f"T{i}"}).status_code == 201
        assert client.post("/api/watchlist", json={"symbol": "T99"}).status_code == 400


def test_session_survives_new_client_with_same_cookie(client):
    """Closing and reopening the app == a fresh client presenting the same
    cookie; the user should still be logged in and see their list."""
    register(client)
    client.post("/api/watchlist", json={"symbol": "NVDA"})
    cookie = next(
        (c for c in client._cookies.values() if c.key == "session"), None
    )
    assert cookie is not None

    fresh = api_app.app.test_client()
    fresh.set_cookie("session", cookie.value)
    with patch.object(accounts, "_fetch_quote", return_value=None):
        data = fresh.get("/api/watchlist").get_json()
    assert [i["symbol"] for i in data["items"]] == ["NVDA"]
