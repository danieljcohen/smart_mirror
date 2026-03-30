import base64
import logging
import os
import warnings
from datetime import datetime, timedelta, timezone
from functools import wraps

import cv2
import face_recognition
import jwt
import numpy as np
from flask import Blueprint, jsonify, request

from db import ensure_user, get_user_by_name

logger = logging.getLogger(__name__)

auth_bp = Blueprint("auth", __name__, url_prefix="/auth")

JWT_SECRET = os.getenv("JWT_SECRET", "smart-mirror-dev-secret-key-min-32-bytes!")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24

warnings.filterwarnings("ignore", message=".*HMAC key.*", category=UserWarning)


def _create_token(user: dict) -> str:
    payload = {
        "sub": str(user["id"]),
        "name": user["name"],
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception as e:
        logger.warning("JWT decode failed: %s: %s", type(e).__name__, e)
        return None


def require_auth(f):
    """Decorator that injects `current_user` dict into the wrapped route."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return jsonify({"error": "missing token"}), 401
        payload = _decode_token(header[7:])
        if payload is None:
            return jsonify({"error": "invalid token"}), 401
        kwargs["current_user"] = {"id": int(payload["sub"]), "name": payload["name"]}
        return f(*args, **kwargs)
    return wrapper


def _match_face_image(image_bytes: bytes) -> str | None:
    """Decode an image, find a face, match against known encodings. Returns name or None."""
    from app import KNOWN_ENCODINGS, KNOWN_NAMES, TOLERANCE

    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        return None

    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    encodings = face_recognition.face_encodings(rgb)
    if not encodings:
        return None

    if not KNOWN_ENCODINGS:
        return None

    distances = face_recognition.face_distance(KNOWN_ENCODINGS, encodings[0])
    best_idx = int(np.argmin(distances))
    if distances[best_idx] <= TOLERANCE:
        return KNOWN_NAMES[best_idx]
    return None


@auth_bp.post("/face-login")
def face_login():
    data = request.get_json(silent=True) or {}
    image_b64 = data.get("image")
    if not image_b64:
        return jsonify({"error": "missing 'image' field (base64)"}), 400

    if "," in image_b64:
        image_b64 = image_b64.split(",", 1)[1]

    try:
        image_bytes = base64.b64decode(image_b64)
    except Exception:
        return jsonify({"error": "invalid base64"}), 400

    name = _match_face_image(image_bytes)
    if name is None:
        return jsonify({"error": "no matching face found"}), 401

    user = ensure_user(name)
    token = _create_token(user)
    return jsonify({"token": token, "user": user})


@auth_bp.post("/name-login")
def name_login():
    data = request.get_json(silent=True) or {}
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "missing 'name' field"}), 400

    user = get_user_by_name(name)
    if user is None:
        return jsonify({"error": f"unknown user '{name}'"}), 401

    token = _create_token(user)
    return jsonify({"token": token, "user": user})


@auth_bp.post("/register")
def register():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    images_b64: list[str] = data.get("images") or []

    if not name:
        return jsonify({"error": "missing 'name' field"}), 400
    if not images_b64:
        return jsonify({"error": "at least one image required"}), 400

    from app import KNOWN_FACES_DIR, load_known_faces

    person_dir = KNOWN_FACES_DIR / name
    person_dir.mkdir(parents=True, exist_ok=True)

    saved = 0
    for i, img_b64 in enumerate(images_b64):
        if "," in img_b64:
            img_b64 = img_b64.split(",", 1)[1]
        try:
            img_bytes = base64.b64decode(img_b64)
            arr = np.frombuffer(img_bytes, dtype=np.uint8)
            img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if img is None:
                continue
            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            if not face_recognition.face_encodings(rgb):
                logger.warning("No face detected in registration image %d for '%s'", i, name)
                continue
            ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            cv2.imwrite(str(person_dir / f"{ts}_{i}.jpg"), img)
            saved += 1
        except Exception as e:
            logger.warning("Failed to save registration image %d for '%s': %s", i, name, e)

    if saved == 0:
        return jsonify({"error": "no face detected in any of the provided images"}), 400

    load_known_faces()
    user = ensure_user(name)
    token = _create_token(user)
    return jsonify({"token": token, "user": user, "images_saved": saved})


@auth_bp.get("/me")
@require_auth
def me(current_user: dict):
    return jsonify(current_user)
