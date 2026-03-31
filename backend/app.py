import os
import atexit
import logging
import threading
import time
from datetime import datetime
from pathlib import Path

import base64

import cv2
import face_recognition
import numpy as np
from dotenv import load_dotenv
from flask import Flask, Response, jsonify
from flask_cors import CORS

from db import init_db, get_user_by_name, ensure_user, get_layout, save_layout, DEFAULT_LAYOUT
from auth import auth_bp
from gemini import gemini_bp
import face_store

load_dotenv(Path(__file__).resolve().parent / ".env")

app = Flask(__name__)
CORS(app)
app.register_blueprint(auth_bp)
app.register_blueprint(gemini_bp)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DETECTION_MODEL = os.getenv("DETECTION_MODEL", "hog")  # "hog" is faster on Pi, "cnn" is more accurate
TOLERANCE = float(os.getenv("TOLERANCE", "0.6"))
FRAME_RESIZE = float(os.getenv("FRAME_RESIZE", "0.25"))  # scale down for speed on Pi
CAMERA_INDEX = int(os.getenv("CAMERA_INDEX", "0"))
ENCODING_POLL_INTERVAL = int(os.getenv("ENCODING_POLL_INTERVAL", "300"))  # seconds


# ── Persistent camera ──────────────────────────────────────────────

class Camera:
    """Thread-safe wrapper that keeps the webcam open for the lifetime of the process."""

    def __init__(self, index: int = 0):
        self._cap = cv2.VideoCapture(index)
        self._lock = threading.Lock()
        if not self._cap.isOpened():
            logger.error("Cannot open camera %d", index)

    @property
    def is_open(self) -> bool:
        return self._cap.isOpened()

    def read(self) -> tuple[bool, np.ndarray | None]:
        with self._lock:
            return self._cap.read()

    def release(self) -> None:
        with self._lock:
            self._cap.release()
            logger.info("Camera released")


camera: Camera | None = None


def get_camera() -> Camera:
    global camera
    if camera is None or not camera.is_open:
        camera = Camera(CAMERA_INDEX)
    return camera


def _shutdown_camera() -> None:
    if camera is not None:
        camera.release()


atexit.register(_shutdown_camera)


# ── Face encoding ──────────────────────────────────────────────────

def _encoding_poll_loop() -> None:
    """Background thread: periodically refresh encodings from Supabase."""
    while True:
        time.sleep(ENCODING_POLL_INTERVAL)
        logger.debug("Polling Supabase for new face encodings…")
        face_store.load_known_faces()


# ── Recognition helpers ────────────────────────────────────────────

def recognize_frame(frame: np.ndarray) -> list[dict]:
    """Run recognition on a single BGR frame."""
    with face_store._FACE_LOCK:
        known_encs = list(face_store.KNOWN_ENCODINGS)
        known_names = list(face_store.KNOWN_NAMES)

    small = cv2.resize(frame, (0, 0), fx=FRAME_RESIZE, fy=FRAME_RESIZE)
    rgb_small = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)

    locations = face_recognition.face_locations(rgb_small, model=DETECTION_MODEL)
    encodings = face_recognition.face_encodings(rgb_small, locations)

    scale = int(1 / FRAME_RESIZE)
    results = []
    for encoding, (top, right, bottom, left) in zip(encodings, locations):
        name = "unknown"
        confidence = 0.0

        if known_encs:
            distances = face_recognition.face_distance(known_encs, encoding)
            best_idx = int(np.argmin(distances))
            if distances[best_idx] <= TOLERANCE:
                name = known_names[best_idx]
                confidence = round(1.0 - distances[best_idx], 3)

        results.append({
            "name": name,
            "confidence": confidence,
            "top": top * scale,
            "right": right * scale,
            "bottom": bottom * scale,
            "left": left * scale,
        })
    return results


def _draw_labels(frame: np.ndarray, faces: list[dict]) -> np.ndarray:
    for f in faces:
        color = (0, 200, 0) if f["name"] != "unknown" else (0, 0, 200)
        cv2.rectangle(frame, (f["left"], f["top"]), (f["right"], f["bottom"]), color, 2)
        label = f"{f['name']} ({f['confidence']:.0%})" if f["name"] != "unknown" else "unknown"
        cv2.putText(frame, label, (f["left"], f["top"] - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
    return frame


def _generate_mjpeg():
    """Yield MJPEG frames with bounding boxes from the shared camera."""
    cam = get_camera()
    if not cam.is_open:
        return

    while True:
        ok, frame = cam.read()
        if not ok:
            break
        faces = recognize_frame(frame)
        frame = _draw_labels(frame, faces)
        _, buf = cv2.imencode(".jpg", frame)
        yield (b"--frame\r\n"
               b"Content-Type: image/jpeg\r\n\r\n" + buf.tobytes() + b"\r\n")


# ── REST endpoints ──────────────────────────────────────────────────

@app.get("/recognize")
def recognize_single():
    """Grab the latest frame from the already-open camera and run recognition."""
    cam = get_camera()
    if not cam.is_open:
        return jsonify({"error": "cannot open camera"}), 500

    ok, frame = cam.read()
    if not ok:
        return jsonify({"error": "failed to capture frame"}), 500

    faces = recognize_frame(frame)
    return jsonify({"timestamp": datetime.now().isoformat(), "faces": faces})


@app.get("/video_feed")
def video_feed():
    """Live MJPEG stream with bounding boxes."""
    return Response(_generate_mjpeg(), mimetype="multipart/x-mixed-replace; boundary=frame")


@app.get("/people")
def list_people():
    """List all registered people and their encoding counts."""
    from db import get_supabase
    sb = get_supabase()
    result = sb.table("users").select("name, face_encodings(id)").execute()
    people = {
        u["name"]: {"encoding_count": len(u.get("face_encodings") or [])}
        for u in result.data
    }
    return jsonify(people)


@app.post("/reload")
def reload_faces():
    """Reload face encodings from Supabase."""
    face_store.load_known_faces()
    return jsonify({"status": "reloaded", "known_people": sorted(set(face_store.KNOWN_NAMES))})


# ── Snapshot endpoint ────────────────────────────────────────────────

@app.get("/snapshot")
def snapshot():
    """Return the current camera frame as a base64 JPEG data URL."""
    cam = get_camera()
    if not cam.is_open:
        return jsonify({"error": "cannot open camera"}), 500

    ok, frame = cam.read()
    if not ok:
        return jsonify({"error": "failed to capture frame"}), 500

    _, buf = cv2.imencode(".jpg", frame)
    b64 = base64.b64encode(buf.tobytes()).decode("ascii")
    return jsonify({"image": f"data:image/jpeg;base64,{b64}"})


# ── Layout endpoints ────────────────────────────────────────────────

AVAILABLE_WIDGETS = [
    {"id": "clock", "name": "Clock", "description": "Current time and date", "defaultLayout": {"w": 4, "h": 2, "minW": 2, "minH": 2}},
    {"id": "weather", "name": "Weather", "description": "Local weather conditions", "defaultLayout": {"w": 4, "h": 2, "minW": 3, "minH": 2}},
    {"id": "greeting", "name": "Greeting", "description": "Personalized greeting message", "defaultLayout": {"w": 6, "h": 2, "minW": 3, "minH": 2}},
    {"id": "gemini-chat", "name": "Gemini Chat", "description": "AI chat with image support powered by Google Gemini", "defaultLayout": {"w": 4, "h": 4, "minW": 3, "minH": 3}},
]


@app.get("/widgets")
def list_widgets():
    return jsonify(AVAILABLE_WIDGETS)


@app.get("/layout/<name>")
def get_layout_by_name(name: str):
    """Public endpoint used by the mirror display to fetch a user's layout."""
    user = get_user_by_name(name)
    if user is None:
        return jsonify({"layout": DEFAULT_LAYOUT})
    layout = get_layout(user["id"])
    return jsonify({"layout": layout or DEFAULT_LAYOUT})



if __name__ == "__main__":
    init_db()
    face_store.load_known_faces()
    # Refresh encodings from Supabase in the background
    t = threading.Thread(target=_encoding_poll_loop, daemon=True)
    t.start()
    get_camera()
    app.run(host="0.0.0.0", port=3000, debug=False)
