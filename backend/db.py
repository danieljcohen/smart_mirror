import json
import logging
import os

from supabase import create_client, Client

logger = logging.getLogger(__name__)

# Default layout uses percentage-based coordinates (0-100)
DEFAULT_LAYOUT = [
    {"widgetId": "clock",    "x": 0,     "y": 0,  "w": 33.33, "h": 25},
    {"widgetId": "weather",  "x": 66.67, "y": 0,  "w": 33.33, "h": 25},
    {"widgetId": "greeting", "x": 25,    "y": 50, "w": 50,    "h": 25},
]

_supabase: Client | None = None


def get_supabase() -> Client:
    global _supabase
    if _supabase is None:
        url = os.environ["SUPABASE_URL"]
        key = os.environ["SUPABASE_KEY"]
        _supabase = create_client(url, key)
    return _supabase


def init_db() -> None:
    """Verify Supabase connectivity on startup."""
    sb = get_supabase()
    sb.table("users").select("id").limit(1).execute()
    logger.info("Supabase connection OK")


def ensure_user(name: str) -> dict:
    """Get or create a user row by name. Returns {id, name}."""
    sb = get_supabase()
    result = sb.table("users").select("id, name").eq("name", name).execute()
    if result.data:
        return result.data[0]
    insert_result = sb.table("users").insert({"name": name}).execute()
    return insert_result.data[0]


def get_user_by_name(name: str) -> dict | None:
    sb = get_supabase()
    result = sb.table("users").select("id, name").eq("name", name).execute()
    return result.data[0] if result.data else None


def get_layout(user_id: int) -> list | None:
    sb = get_supabase()
    result = sb.table("layouts").select("layout_json").eq("user_id", user_id).execute()
    if not result.data:
        return None
    layout = result.data[0]["layout_json"]
    # JSONB comes back as a Python list; handle stringified JSON as a fallback
    return layout if isinstance(layout, list) else json.loads(layout)


def save_layout(user_id: int, layout: list) -> None:
    sb = get_supabase()
    sb.table("layouts").upsert(
        {"user_id": user_id, "layout_json": layout},
        on_conflict="user_id",
    ).execute()


def get_all_encodings() -> list[dict]:
    """Return all stored face encodings as [{name, encoding}] dicts."""
    sb = get_supabase()
    enc_result = sb.table("face_encodings").select("user_id, encoding").execute()
    if not enc_result.data:
        return []

    user_ids = list({row["user_id"] for row in enc_result.data})
    users_result = sb.table("users").select("id, name").in_("id", user_ids).execute()
    user_map = {u["id"]: u["name"] for u in users_result.data}

    return [
        {"name": user_map[row["user_id"]], "encoding": row["encoding"]}
        for row in enc_result.data
        if row["user_id"] in user_map
    ]


def save_encoding(user_id: int, encoding_list: list[float]) -> None:
    """Persist a single 128-float face encoding to Supabase."""
    sb = get_supabase()
    sb.table("face_encodings").insert(
        {"user_id": user_id, "encoding": encoding_list}
    ).execute()


def get_global_setting(key: str) -> str | None:
    """Return a value from the global settings table, or None if not set."""
    sb = get_supabase()
    result = sb.table("settings").select("value").eq("key", key).execute()
    return result.data[0]["value"] if result.data else None


def set_global_setting(key: str, value: str) -> None:
    """Upsert a key/value pair in the global settings table."""
    sb = get_supabase()
    sb.table("settings").upsert({"key": key, "value": value}, on_conflict="key").execute()
