import base64
import faulthandler
import logging
import traceback

import cv2
import face_recognition
import numpy as np
from flask import Blueprint, jsonify, request

import face_store
from db import ensure_user, save_encoding

logger = logging.getLogger(__name__)

auth_bp = Blueprint("auth", __name__, url_prefix="/auth")

# Dump a native stack trace to stderr on SIGSEGV so we can see where dlib
# crashes instead of getting a silent process exit.
faulthandler.enable()


@auth_bp.post("/register")
def register():
    """
    Register a new face. The Pi encodes the face locally and saves the
    128-float encoding vector to Supabase. No image files are stored.

    Body: { name: string, images: string[] }  (images are base64 data URLs)
    """
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    images_b64: list[str] = data.get("images") or []

    if not name:
        return jsonify({"error": "missing 'name' field"}), 400
    if not images_b64:
        return jsonify({"error": "at least one image required"}), 400

    user = ensure_user(name)
    saved = 0

    for i, img_b64 in enumerate(images_b64):
        if "," in img_b64:
            img_b64 = img_b64.split(",", 1)[1]
        try:
            img_bytes = base64.b64decode(img_b64)
            arr = np.frombuffer(img_bytes, dtype=np.uint8)
            img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if img is None:
                logger.warning("Image %d for '%s': cv2 could not decode", i, name)
                continue

            # Scale down to max 640px — dlib is more stable on smaller images
            h, w = img.shape[:2]
            max_dim = max(h, w)
            if max_dim > 640:
                scale = 640 / max_dim
                img = cv2.resize(img, (int(w * scale), int(h * scale)))

            logger.info("Image %d for '%s': %dx%d after resize", i, name, img.shape[1], img.shape[0])
            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            encodings = face_recognition.face_encodings(rgb)
            if not encodings:
                logger.warning("No face detected in registration image %d for '%s'", i, name)
                continue
            save_encoding(user["id"], encodings[0].tolist())
            saved += 1
        except Exception as e:
            logger.warning("Failed to process registration image %d for '%s': %s\n%s",
                           i, name, e, traceback.format_exc())

    if saved == 0:
        return jsonify({"error": "no face detected in any of the provided images"}), 400

    face_store.load_known_faces()
    return jsonify({"user": user, "encodings_saved": saved})
