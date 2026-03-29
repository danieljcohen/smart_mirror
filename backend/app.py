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
from flask import Flask, Response, jsonify
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

# Protects all reads/writes to KNOWN_ENCODINGS, KNOWN_NAMES, and the cache file
_FACE_LOCK = threading.Lock()

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

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp"}


def _load_cache() -> dict:
    """Return the cache dict, or an empty skeleton if none exists."""
    if ENCODINGS_CACHE.exists():
        with open(ENCODINGS_CACHE, "rb") as f:
            data = pickle.load(f)
        # Migrate old caches that lack the image_index key
        if "image_index" not in data:
            data["image_index"] = {}
        return data
    return {"encodings": [], "names": [], "image_index": {}}


def _save_cache(data: dict) -> None:
    """Persist the cache dict to disk. Caller must hold _FACE_LOCK."""
    with open(ENCODINGS_CACHE, "wb") as f:
        pickle.dump(data, f)


def load_known_faces() -> None:
    """Scan known_faces/<name>/ and encode only images not yet in the cache."""
    global KNOWN_ENCODINGS, KNOWN_NAMES

    KNOWN_FACES_DIR.mkdir(parents=True, exist_ok=True)

    with _FACE_LOCK:
        data = _load_cache()

        # Group cached encodings and index entries by person name
        cached_encs: dict[str, list[np.ndarray]] = {}
        for enc, name in zip(data["encodings"], data["names"]):
            cached_encs.setdefault(name, []).append(enc)

        cached_index: dict[str, dict[str, float]] = {}
        for rel, mtime in data["image_index"].items():
            parts = Path(rel).parts
            if len(parts) >= 2:
                cached_index.setdefault(parts[1], {})[rel] = mtime

        final_encodings: list[np.ndarray] = []
        final_names: list[str] = []
        final_index: dict[str, float] = {}
        changed = False
        disk_people: set[str] = set()

        for person_dir in sorted(KNOWN_FACES_DIR.iterdir()):
            if not person_dir.is_dir():
                continue
            person_name = person_dir.name
            disk_people.add(person_name)

            # Map rel_path -> mtime for every image currently on disk
            disk_files: dict[str, float] = {
                str(p.relative_to(BASE_DIR)): p.stat().st_mtime
                for p in sorted(person_dir.iterdir())
                if p.suffix.lower() in IMAGE_EXTS
            }

            if disk_files == cached_index.get(person_name, {}):
                # Nothing changed — reuse cached encodings directly
                for enc in cached_encs.get(person_name, []):
                    final_encodings.append(enc)
                    final_names.append(person_name)
                final_index.update(disk_files)
                continue

            # Something changed — re-encode this person from scratch
            changed = True
            logger.info("Re-encoding '%s' (files added, removed, or replaced)", person_name)
            for rel, mtime in disk_files.items():
                img_path = BASE_DIR / rel
                image = face_recognition.load_image_file(str(img_path))
                face_encs = face_recognition.face_encodings(image, model=DETECTION_MODEL)
                if face_encs:
                    final_encodings.append(face_encs[0])
                    final_names.append(person_name)
                    final_index[rel] = mtime
                else:
                    logger.warning("No face found in %s", img_path.name)

        # Detect people whose folders were deleted entirely
        removed = set(cached_index.keys()) - disk_people
        if removed:
            changed = True
            logger.info("Dropped stale encodings for removed people: %s", removed)

        KNOWN_ENCODINGS = final_encodings
        KNOWN_NAMES = final_names

        if changed:
            _save_cache({"encodings": final_encodings, "names": final_names, "image_index": final_index})
            logger.info("Cache updated; %d total encoding(s)", len(final_names))
        else:
            logger.info("Loaded %d encoding(s) from cache (nothing changed)", len(final_names))


# ── Recognition helpers ────────────────────────────────────────────

def recognize_frame(frame: np.ndarray) -> list[dict]:
    """Run recognition on a single BGR frame."""
    # Snapshot under the lock so a concurrent /register or /reload can't mutate
    # the lists while face_distance (a C extension that releases the GIL) runs.
    with _FACE_LOCK:
        known_encs = list(KNOWN_ENCODINGS)
        known_names = list(KNOWN_NAMES)

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
    """List all registered people and their image counts."""
    KNOWN_FACES_DIR.mkdir(parents=True, exist_ok=True)
    people = {}
    for person_dir in sorted(KNOWN_FACES_DIR.iterdir()):
        if person_dir.is_dir():
            images = [f.name for f in person_dir.iterdir()
                      if f.suffix.lower() in IMAGE_EXTS]
            people[person_dir.name] = {"image_count": len(images), "images": sorted(images)}
    return jsonify(people)


@app.post("/reload")
def reload_faces():
    """Force a full re-encode of all known faces by wiping the cache first.
    Use this to recover from a corrupted cache.
    """
    if ENCODINGS_CACHE.exists():
        ENCODINGS_CACHE.unlink()
    load_known_faces()
    return jsonify({"status": "reloaded", "known_people": sorted(set(KNOWN_NAMES))})


if __name__ == "__main__":
    load_known_faces()
    get_camera()
    app.run(host="0.0.0.0", port=3000, debug=False)
