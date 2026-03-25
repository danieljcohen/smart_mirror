import os
import atexit
import pickle
import logging
import threading
from datetime import datetime
from pathlib import Path

import cv2
import face_recognition
import numpy as np
from flask import Flask, Response, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent
KNOWN_FACES_DIR = BASE_DIR / "known_faces"
ENCODINGS_CACHE = BASE_DIR / "encodings.pkl"

KNOWN_ENCODINGS: list[np.ndarray] = []
KNOWN_NAMES: list[str] = []

DETECTION_MODEL = os.getenv("DETECTION_MODEL", "hog")  # "hog" is faster on Pi, "cnn" is more accurate
TOLERANCE = float(os.getenv("TOLERANCE", "0.6"))
FRAME_RESIZE = float(os.getenv("FRAME_RESIZE", "0.25"))  # scale down for speed on Pi
CAMERA_INDEX = int(os.getenv("CAMERA_INDEX", "0"))


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

def load_known_faces() -> None:
    """Scan known_faces/<name>/ directories and build encoding vectors."""
    global KNOWN_ENCODINGS, KNOWN_NAMES

    KNOWN_FACES_DIR.mkdir(parents=True, exist_ok=True)

    if ENCODINGS_CACHE.exists():
        logger.info("Loading cached encodings from %s", ENCODINGS_CACHE)
        with open(ENCODINGS_CACHE, "rb") as f:
            data = pickle.load(f)
        KNOWN_ENCODINGS = data["encodings"]
        KNOWN_NAMES = data["names"]
        logger.info("Loaded %d face(s) from cache", len(KNOWN_NAMES))
        return

    encodings, names = [], []
    for person_dir in sorted(KNOWN_FACES_DIR.iterdir()):
        if not person_dir.is_dir():
            continue
        person_name = person_dir.name
        for img_path in sorted(person_dir.iterdir()):
            if img_path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".bmp"}:
                continue
            logger.info("Encoding %s -> %s", person_name, img_path.name)
            image = face_recognition.load_image_file(str(img_path))
            face_encs = face_recognition.face_encodings(image, model=DETECTION_MODEL)
            if face_encs:
                encodings.append(face_encs[0])
                names.append(person_name)
            else:
                logger.warning("No face found in %s", img_path)

    KNOWN_ENCODINGS = encodings
    KNOWN_NAMES = names

    with open(ENCODINGS_CACHE, "wb") as f:
        pickle.dump({"encodings": encodings, "names": names}, f)

    logger.info("Encoded and cached %d face(s)", len(names))


# ── Recognition helpers ────────────────────────────────────────────

def recognize_frame(frame: np.ndarray) -> list[dict]:
    """Run recognition on a single BGR frame."""
    small = cv2.resize(frame, (0, 0), fx=FRAME_RESIZE, fy=FRAME_RESIZE)
    rgb_small = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)

    locations = face_recognition.face_locations(rgb_small, model=DETECTION_MODEL)
    encodings = face_recognition.face_encodings(rgb_small, locations)

    scale = int(1 / FRAME_RESIZE)
    results = []
    for encoding, (top, right, bottom, left) in zip(encodings, locations):
        name = "unknown"
        confidence = 0.0

        if KNOWN_ENCODINGS:
            distances = face_recognition.face_distance(KNOWN_ENCODINGS, encoding)
            best_idx = int(np.argmin(distances))
            if distances[best_idx] <= TOLERANCE:
                name = KNOWN_NAMES[best_idx]
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
    """List all registered people and their image counts."""
    KNOWN_FACES_DIR.mkdir(parents=True, exist_ok=True)
    people = {}
    for person_dir in sorted(KNOWN_FACES_DIR.iterdir()):
        if person_dir.is_dir():
            images = [f.name for f in person_dir.iterdir()
                      if f.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp"}]
            people[person_dir.name] = {"image_count": len(images), "images": sorted(images)}
    return jsonify(people)


@app.post("/reload")
def reload_faces():
    """Delete the cache and re-encode all known faces."""
    if ENCODINGS_CACHE.exists():
        ENCODINGS_CACHE.unlink()
    load_known_faces()
    return jsonify({"status": "reloaded", "known_people": sorted(set(KNOWN_NAMES))})


if __name__ == "__main__":
    load_known_faces()
    get_camera()
    app.run(host="0.0.0.0", port=3000, debug=False)
