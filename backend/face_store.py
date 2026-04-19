"""Shared in-memory face encoding store."""
import logging
import threading

import numpy as np

logger = logging.getLogger(__name__)

KNOWN_ENCODINGS: list[np.ndarray] = []
KNOWN_NAMES: list[str] = []
_FACE_LOCK = threading.Lock()


def load_known_faces() -> None:
    """Reload all face encodings from Supabase into memory."""
    global KNOWN_ENCODINGS, KNOWN_NAMES
    from db import get_all_encodings

    try:
        rows = get_all_encodings()
    except Exception as e:
        logger.error("Failed to load encodings from Supabase: %s", e)
        return

    with _FACE_LOCK:
        KNOWN_ENCODINGS = [np.array(row["encoding"]) for row in rows]
        KNOWN_NAMES = [row["name"] for row in rows]

    logger.info("Loaded %d encoding(s) from Supabase", len(KNOWN_NAMES))
