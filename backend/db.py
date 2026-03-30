import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "mirror.db"
KNOWN_FACES_DIR = BASE_DIR / "known_faces"

DEFAULT_LAYOUT = [
    {"widgetId": "clock", "x": 0, "y": 0, "w": 4, "h": 2},
    {"widgetId": "weather", "x": 8, "y": 0, "w": 4, "h": 2},
    {"widgetId": "greeting", "x": 3, "y": 4, "w": 6, "h": 2},
]


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    conn = get_db()
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id   INTEGER PRIMARY KEY,
                name TEXT    UNIQUE NOT NULL
            );
            CREATE TABLE IF NOT EXISTS layouts (
                id          INTEGER PRIMARY KEY,
                user_id     INTEGER NOT NULL REFERENCES users(id),
                layout_json TEXT    NOT NULL,
                updated_at  TEXT    NOT NULL,
                UNIQUE(user_id)
            );
        """)
        conn.commit()
    finally:
        conn.close()


def seed_users_from_faces() -> None:
    """Insert a user row for every subdirectory in known_faces/."""
    KNOWN_FACES_DIR.mkdir(parents=True, exist_ok=True)
    conn = get_db()
    try:
        for person_dir in sorted(KNOWN_FACES_DIR.iterdir()):
            if person_dir.is_dir():
                conn.execute(
                    "INSERT OR IGNORE INTO users (name) VALUES (?)",
                    (person_dir.name,),
                )
        conn.commit()
    finally:
        conn.close()


def get_user_by_name(name: str) -> dict | None:
    conn = get_db()
    try:
        row = conn.execute("SELECT id, name FROM users WHERE name = ?", (name,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def ensure_user(name: str) -> dict:
    """Get or create a user by name."""
    conn = get_db()
    try:
        conn.execute("INSERT OR IGNORE INTO users (name) VALUES (?)", (name,))
        conn.commit()
        row = conn.execute("SELECT id, name FROM users WHERE name = ?", (name,)).fetchone()
        return dict(row)
    finally:
        conn.close()


def get_layout(user_id: int) -> list | None:
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT layout_json FROM layouts WHERE user_id = ?", (user_id,)
        ).fetchone()
        return json.loads(row["layout_json"]) if row else None
    finally:
        conn.close()


def save_layout(user_id: int, layout: list) -> None:
    now = datetime.now(timezone.utc).isoformat()
    conn = get_db()
    try:
        conn.execute(
            """INSERT INTO layouts (user_id, layout_json, updated_at)
               VALUES (?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET layout_json = excluded.layout_json,
                                                   updated_at  = excluded.updated_at""",
            (user_id, json.dumps(layout), now),
        )
        conn.commit()
    finally:
        conn.close()
