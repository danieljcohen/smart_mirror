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
from flask import Flask, Response, jsonify, request
from flask_cors import CORS

import requests as http_requests
from db import init_db, get_user_by_name, ensure_user, get_layout, save_layout, DEFAULT_LAYOUT, get_global_setting
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

GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")
YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY", "")

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


@app.get("/settings")
def get_settings():
    """Return global settings (e.g. mirror_location) from Supabase."""
    mirror_location = get_global_setting("mirror_location") or ""
    return jsonify({"mirror_location": mirror_location})


@app.get("/directions")
def proxy_directions():
    """
    Proxy to Google Routes API (v2).
    Query params: origin, destination, mode (transit|walking|driving)
    Returns: { status, duration, distance, transitLines }
    """
    if not GOOGLE_MAPS_API_KEY:
        return jsonify({"status": "ERROR", "error": "GOOGLE_MAPS_API_KEY not configured"}), 500

    origin = request.args.get("origin", "")
    destination = request.args.get("destination", "")
    mode_raw = request.args.get("mode", "transit").lower()

    mode_map = {"transit": "TRANSIT", "walking": "WALK", "driving": "DRIVE"}
    travel_mode = mode_map.get(mode_raw, "TRANSIT")

    body = {
        "origin": {"address": origin},
        "destination": {"address": destination},
        "travelMode": travel_mode,
        "computeAlternativeRoutes": False,
    }
    # transitDetails lives one level deeper — must be requested explicitly
    field_mask = "routes.legs.steps.transitDetails,routes.localizedValues"

    try:
        resp = http_requests.post(
            "https://routes.googleapis.com/directions/v2:computeRoutes",
            json=body,
            headers={
                "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
                "X-Goog-FieldMask": field_mask,
                "Content-Type": "application/json",
            },
            timeout=10,
        )
        data = resp.json()

        if not data.get("routes"):
            return jsonify({"status": "ZERO_RESULTS"})

        route = data["routes"][0]
        localized = route.get("localizedValues", {})
        duration_text = localized.get("duration", {}).get("text", "")
        distance_text = localized.get("distance", {}).get("text", "")

        # Collect unique transit line badges from all steps.
        # Routes API v2 uses "transitLine" (not "line") and nameShort is e.g. "L Line".
        transit_lines = []
        seen_lines: set[str] = set()
        for leg in route.get("legs", []):
            for step in leg.get("steps", []):
                td = step.get("transitDetails", {})
                tl = td.get("transitLine", {})
                if not tl:
                    continue
                # "L Line" → "L", "Q Line" → "Q", "Red Line" → "Red"
                raw = tl.get("nameShort") or tl.get("name", "")
                import re as _re
                short_name = _re.sub(r"\s+(Line|Train|Bus|Metro|Express|Local).*$",
                                     "", raw, flags=_re.IGNORECASE).strip()
                if not short_name or short_name in seen_lines:
                    continue
                seen_lines.add(short_name)

                # Departure time (localized, e.g. "11:08 AM") + headway for next trains
                dep_text = (td.get("localizedValues", {})
                              .get("departureTime", {})
                              .get("time", {})
                              .get("text", ""))
                headway_raw = td.get("headway", "") or td.get("headwaySeconds", "")
                headway_s = 0
                if isinstance(headway_raw, str) and headway_raw.endswith("s"):
                    headway_s = int(headway_raw[:-1])
                elif isinstance(headway_raw, int):
                    headway_s = headway_raw

                # Build list of upcoming departure times (up to 3)
                dep_times: list[str] = []
                if dep_text:
                    dep_times.append(dep_text)
                    if headway_s > 0:
                        dep_ts = td.get("stopDetails", {}).get("departureTime", "")
                        tz_name = (td.get("localizedValues", {})
                                     .get("departureTime", {})
                                     .get("timeZone", "UTC"))
                        if dep_ts:
                            from datetime import datetime, timedelta
                            from zoneinfo import ZoneInfo
                            base = datetime.fromisoformat(dep_ts.replace("Z", "+00:00"))
                            try:
                                tz = ZoneInfo(tz_name)
                            except Exception:
                                tz = ZoneInfo("UTC")
                            for i in range(1, 3):
                                nxt = (base + timedelta(seconds=headway_s * i)).astimezone(tz)
                                ampm = "AM" if nxt.hour < 12 else "PM"
                                h12 = nxt.hour % 12 or 12
                                dep_times.append(f"{h12}:{nxt.minute:02d}\u202f{ampm}")

                transit_lines.append({
                    "shortName": short_name,
                    "color": tl.get("color", "#555555"),
                    "textColor": tl.get("textColor", "#ffffff"),
                    "vehicleType": tl.get("vehicle", {}).get("type", ""),
                    "departureTimes": dep_times,
                })

        return jsonify({
            "status": "OK",
            "duration": duration_text,
            "distance": distance_text,
            "transitLines": transit_lines,
        })
    except Exception as e:
        return jsonify({"status": "ERROR", "error": str(e)}), 502


@app.get("/geocode")
def proxy_geocode():
    """
    Geocode an address using Nominatim (OpenStreetMap) — no API key required.
    Query param: address
    Returns: { status, results: [{ geometry: { location: { lat, lng } } }] }
    """
    address = request.args.get("address", "").strip()
    if not address:
        return jsonify({"status": "INVALID_REQUEST", "results": []}), 400
    try:
        resp = http_requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": address, "format": "json", "limit": 1},
            headers={"User-Agent": "SmartMirror/1.0"},
            timeout=10,
        )
        results = resp.json()
        if not results:
            return jsonify({"status": "ZERO_RESULTS", "results": []})
        hit = results[0]
        return jsonify({
            "status": "OK",
            "results": [{
                "geometry": {
                    "location": {"lat": float(hit["lat"]), "lng": float(hit["lon"])}
                },
                "display_name": hit.get("display_name", ""),
            }],
        })
    except Exception as e:
        return jsonify({"status": "ERROR", "error": str(e)}), 502


@app.get("/youtube/shorts")
def proxy_youtube_shorts():
    if not YOUTUBE_API_KEY:
        return jsonify({"status": "ERROR", "error": "YOUTUBE_API_KEY not configured"}), 500

    source_type = request.args.get("source_type", "trending")
    channel_id = request.args.get("channel_id", "").strip()
    search_query = request.args.get("search_query", "").strip()

    # Extract channel ID from a full YouTube URL or @handle if provided
    if channel_id.startswith("http"):
        # e.g. https://www.youtube.com/@handle or /channel/UCxxx
        parts = [p for p in channel_id.rstrip("/").split("/") if p]
        channel_id = parts[-1] if parts else channel_id

    params: dict = {
        "part": "snippet",
        "type": "video",
        "videoDuration": "short",
        "maxResults": 15,
        "key": YOUTUBE_API_KEY,
    }

    if source_type == "channel" and channel_id:
        params["channelId"] = channel_id
        params["q"] = "#shorts"
    elif source_type == "search" and search_query:
        params["q"] = f"{search_query} #shorts"
    else:
        params["q"] = "#shorts"

    try:
        resp = http_requests.get(
            "https://www.googleapis.com/youtube/v3/search",
            params=params,
            timeout=10,
        )
        data = resp.json()
        if "error" in data:
            return jsonify({"status": "ERROR", "error": data["error"].get("message", "YouTube API error")}), 502
        items = data.get("items", [])
        video_ids = [i["id"]["videoId"] for i in items if i.get("id", {}).get("videoId")]
        return jsonify({"status": "OK", "videoIds": video_ids})
    except Exception as e:
        return jsonify({"status": "ERROR", "error": str(e)}), 502


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
