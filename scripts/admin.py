"""Tiny admin CLI for the app database (data/app.db).

Usage:
    python scripts/admin.py users                 # list all users
    python scripts/admin.py watchlist <username>  # show a user's saved stocks
    python scripts/admin.py delete-user <username>
    python scripts/admin.py clear-email <username>

Safe by construction: parameterized queries, foreign keys ON (deleting a
user cascades to their watchlist rows), and delete asks for confirmation.
"""

import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("APP_DB_PATH", ROOT / "data" / "app.db"))


def connect() -> sqlite3.Connection:
    if not DB_PATH.exists():
        sys.exit(f"No database at {DB_PATH} — has the API run at least once?")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def cmd_users(conn: sqlite3.Connection) -> None:
    rows = conn.execute(
        "SELECT u.id, u.username, u.email, u.created_at,"
        " COUNT(w.id) AS saved"
        " FROM users u LEFT JOIN watchlist w ON w.user_id = u.id"
        " GROUP BY u.id ORDER BY u.id"
    ).fetchall()
    if not rows:
        print("No users.")
        return
    print(f"{'id':>4}  {'username':<32} {'email':<32} {'saved':>5}  created")
    for r in rows:
        print(
            f"{r['id']:>4}  {r['username']:<32} {r['email'] or '—':<32}"
            f" {r['saved']:>5}  {r['created_at']}"
        )


def cmd_watchlist(conn: sqlite3.Connection, username: str) -> None:
    rows = conn.execute(
        "SELECT w.symbol, w.added_at FROM watchlist w"
        " JOIN users u ON u.id = w.user_id WHERE u.username = ?"
        " ORDER BY w.added_at DESC",
        (username,),
    ).fetchall()
    if not rows:
        print(f"No saved stocks for {username!r} (or no such user).")
        return
    for r in rows:
        print(f"{r['symbol']:<8} added {r['added_at']}")


def cmd_delete_user(conn: sqlite3.Connection, username: str) -> None:
    row = conn.execute(
        "SELECT id, (SELECT COUNT(*) FROM watchlist WHERE user_id = users.id) AS n"
        " FROM users WHERE username = ?",
        (username,),
    ).fetchone()
    if row is None:
        sys.exit(f"No user named {username!r}.")
    answer = input(
        f"Delete {username!r} and their {row['n']} saved stock(s)? [y/N] "
    )
    if answer.strip().lower() != "y":
        print("Aborted.")
        return
    conn.execute("DELETE FROM users WHERE id = ?", (row["id"],))
    conn.commit()
    print(f"Deleted {username!r}.")


def cmd_clear_email(conn: sqlite3.Connection, username: str) -> None:
    cur = conn.execute("UPDATE users SET email = NULL WHERE username = ?", (username,))
    conn.commit()
    print("Cleared." if cur.rowcount else f"No user named {username!r}.")


def main() -> None:
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    conn = connect()
    try:
        match args:
            case ["users"]:
                cmd_users(conn)
            case ["watchlist", username]:
                cmd_watchlist(conn, username)
            case ["delete-user", username]:
                cmd_delete_user(conn, username)
            case ["clear-email", username]:
                cmd_clear_email(conn, username)
            case _:
                sys.exit(__doc__)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
