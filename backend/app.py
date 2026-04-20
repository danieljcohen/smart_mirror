import os
import atexit
import logging
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

# When this file is run directly (``uv run app.py``) it is loaded as the
# ``__main__`` module, but other files (e.g. jarvis.py) do ``from app import
# get_camera``. Without this alias Python would load app.py a second time as
# the separate ``app`` module, giving that copy its own uninitialized
# ``camera`` global — so ``take_picture`` would try to construct a second
# Picamera2 while the working one in ``__main__`` still owns the device,
# which libcamera rejects with "Camera in Running state trying acquire()".
# Aliasing the two module entries makes ``from app import X`` resolve to
# this same, already-initialized module.
if __name__ == "__main__" and "app" not in sys.modules:
    sys.modules["app"] = sys.modules[__name__]

import cv2
import face_recognition
import numpy as np
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request
from flask_cors import CORS

import requests as http_requests
from db import init_db, get_user_by_name, get_layout, DEFAULT_LAYOUT, get_global_setting
from jarvis import jarvis_bp
from whoop import whoop_bp
import face_store
import gesture_service
import speech_service

load_dotenv(Path(__file__).resolve().parent / ".env")

app = Flask(__name__)
CORS(app)
app.register_blueprint(jarvis_bp)
app.register_blueprint(whoop_bp)
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
    """Thread-safe wrapper that keeps the camera open for the lifetime of the process.

    Only one process-wide instance should exist (enforced by ``get_camera``); all
    consumers (facial recognition, gesture detection, Jarvis ``take_picture``)
    share the same underlying hardware handle and serialize on ``self._lock``.
    """

    def __init__(self, index: int = 0):
        self._lock = threading.Lock()
        self._picam = None
        self._cap = None

        picam_err: Exception | None = None
        try:
            from picamera2 import Picamera2
            # Retry a few times: if a prior app instance hasn't finished
            # releasing the CSI camera, Picamera2() will raise; usually
            # resolves within ~1–2s.
            for attempt in range(3):
                try:
                    picam = Picamera2()
                    try:
                        config = picam.create_video_configuration(
                            main={"size": (640, 480), "format": "RGB888"}
                        )
                        picam.configure(config)
                        picam.start()
                    except Exception:
                        # Partially-initialized Picamera2 still holds the
                        # libcamera device and leaves a zombie entry in
                        # ``Picamera2.cameras`` that the internal listener
                        # thread will keep dispatching to (surfacing as
                        # "'Picamera2' object has no attribute 'allocator'"
                        # in logs). Close it to drop the registration.
                        try:
                            picam.close()
                        except Exception:
                            pass
                        raise
                    self._picam = picam
                    logger.info(
                        "Using picamera2 (Pi Camera)%s",
                        f" (attempt {attempt + 1})" if attempt else "",
                    )
                    break
                except Exception as e:
                    picam_err = e
                    logger.warning(
                        "Picamera2 init attempt %d/3 failed: %s",
                        attempt + 1, e,
                    )
                    time.sleep(1.0)
            if self._picam is None:
                raise picam_err if picam_err else RuntimeError("picamera2 init failed")
        except Exception as e:
            logger.info("picamera2 not available (%s), falling back to OpenCV", e)
            self._picam = None
            self._cap = cv2.VideoCapture(index)
            if not self._cap.isOpened():
                logger.error("Cannot open camera %d", index)

    @property
    def is_open(self) -> bool:
        if self._picam is not None:
            return True
        return self._cap is not None and self._cap.isOpened()

    def read(self) -> tuple[bool, np.ndarray | None]:
        with self._lock:
            if self._picam is not None:
                try:
                    frame = self._picam.capture_array()
                    frame_bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
                    return True, frame_bgr
                except Exception:
                    return False, None
            return self._cap.read()

    def release(self) -> None:
        with self._lock:
            if self._picam is not None:
                try:
                    self._picam.stop()
                except Exception as e:
                    logger.warning("Pi Camera stop() failed: %s", e)
                try:
                    self._picam.close()
                except Exception as e:
                    logger.warning("Pi Camera close() failed: %s", e)
                self._picam = None
                logger.info("Pi Camera released")
            elif self._cap is not None:
                try:
                    self._cap.release()
                except Exception as e:
                    logger.warning("OpenCV camera release() failed: %s", e)
                self._cap = None
                logger.info("Camera released")


camera: Camera | None = None
_camera_init_lock = threading.Lock()


def get_camera() -> Camera:
    """Return the process-wide Camera, constructing it once on first use.

    Thread-safe: multiple threads calling concurrently at startup will not race
    to construct competing Picamera2 instances (which would deadlock libcamera
    and trigger the 'Picamera2 has no attribute allocator' bug on cleanup).
    """
    global camera
    if camera is not None and camera.is_open:
        return camera
    with _camera_init_lock:
        if camera is None or not camera.is_open:
            if camera is not None:
                # Previous camera died; release the stale handle before replacing.
                try:
                    camera.release()
                except Exception:
                    pass
            camera = Camera(CAMERA_INDEX)
    return camera


def _shutdown_camera() -> None:
    if camera is not None:
        try:
            camera.release()
        except Exception as e:
            logger.warning("Camera shutdown error (ignored): %s", e)


atexit.register(_shutdown_camera)


def _signal_shutdown(signum, _frame):
    logger.info("Signal %d received — releasing camera and exiting.", signum)
    _shutdown_camera()
    # sys.exit hangs in Py_Finalize on PortAudio/libcamera daemon threads.
    os._exit(0)


# Ensure SIGTERM/SIGINT release the CSI camera; otherwise libcamera keeps the
# device busy until this PID is reaped, breaking the next `uv run app.py`.
import signal as _signal
for _sig in (_signal.SIGTERM, _signal.SIGINT, _signal.SIGHUP):
    try:
        _signal.signal(_sig, _signal_shutdown)
    except (ValueError, OSError):
        # ValueError: not in main thread; OSError: signal not supported.
        pass


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
    if camera is None or not camera.is_open:
        return jsonify({"timestamp": datetime.now().isoformat(), "faces": []})

    ok, frame = camera.read()
    if not ok:
        return jsonify({"timestamp": datetime.now().isoformat(), "faces": []})

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


import json

@app.get("/gesture_stream")
def gesture_stream():
    """Server-Sent Events endpoint for gestures."""
    def stream():
        q = gesture_service.subscribe()
        try:
            while True:
                gesture = q.get()  # Block until gesture available
                yield f"data: {json.dumps(gesture)}\n\n"
        except GeneratorExit:
            pass
        finally:
            gesture_service.unsubscribe(q)

    return Response(stream(), mimetype="text/event-stream")

@app.get("/gesture")
def get_gesture():
    """Return the most recently detected gesture (if any)."""
    gesture = gesture_service.get_latest_gesture()
    return jsonify(gesture if gesture else {})

@app.get("/gesture/consume")
def consume_gesture():
    """Return and clear the most recent gesture."""
    gesture = gesture_service.consume_latest_gesture()
    return jsonify(gesture if gesture else {})

@app.post("/gesture/heartbeat")
def gesture_heartbeat():
    """Mark reels widget as active for gesture tracking."""
    gesture_service.mark_reels_active_heartbeat()
    return jsonify({"status": "ok"})


# ── Speech recognition endpoints ────────────────────────────────────

@app.get("/speech/available")
def speech_available():
    """Whether the backend speech service (Vosk) is running."""
    return jsonify({"available": speech_service.available()})

@app.get("/speech/stream")
def speech_stream():
    """SSE stream of speech recognition events from the Pi's microphone."""
    def stream():
        q = speech_service.subscribe()
        try:
            while True:
                event = q.get()
                yield f"data: {json.dumps(event)}\n\n"
        except GeneratorExit:
            pass
        finally:
            speech_service.unsubscribe(q)

    return Response(stream(), mimetype="text/event-stream")

@app.get("/speech/consume")
def speech_consume():
    """Return and clear the latest speech event."""
    event = speech_service.consume_event()
    return jsonify(event if event else {})


# ── Text-to-speech endpoint (Deepgram Aura) ─────────────────────────

DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", "")

@app.post("/tts")
def tts():
    """Generate speech audio from text via Deepgram TTS."""
    body = request.get_json(silent=True) or {}
    text = body.get("text", "").strip()
    if not text:
        return jsonify({"error": "no text provided"}), 400
    if not DEEPGRAM_API_KEY:
        return jsonify({"error": "DEEPGRAM_API_KEY not configured"}), 500

    try:
        dg_resp = http_requests.post(
            "https://api.deepgram.com/v1/speak",
            params={"model": "aura-2-orion-en"},
            headers={
                "Authorization": f"Token {DEEPGRAM_API_KEY}",
                "Content-Type": "application/json",
            },
            json={"text": text},
            timeout=10,
        )
        dg_resp.raise_for_status()
        return Response(dg_resp.content, mimetype="audio/mpeg")
    except Exception as e:
        logger.error("Deepgram TTS error: %s", e)
        return jsonify({"error": str(e)}), 502


# ── Layout endpoints ────────────────────────────────────────────────

AVAILABLE_WIDGETS = [
    {"id": "clock", "name": "Clock", "description": "Current time and date", "defaultLayout": {"w": 4, "h": 2, "minW": 2, "minH": 2}},
    {"id": "weather", "name": "Weather", "description": "Local weather conditions", "defaultLayout": {"w": 4, "h": 2, "minW": 3, "minH": 2}},
    {"id": "greeting", "name": "Greeting", "description": "Personalized greeting message", "defaultLayout": {"w": 6, "h": 2, "minW": 3, "minH": 2}},
    {"id": "gemini-chat", "name": "Jarvis Chat", "description": "AI chat with image support powered by Jarvis", "defaultLayout": {"w": 4, "h": 4, "minW": 3, "minH": 3}},
    {"id": "whoop", "name": "Whoop", "description": "Personal health stats from your Whoop band (recovery, HRV, sleep, strain)", "defaultLayout": {"w": 4, "h": 3, "minW": 3, "minH": 2}},
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


# Cache YouTube results for 6 hours to avoid burning through the free 10k unit/day quota
# (each search costs 100 units, so without caching even 100 page loads exhausts it)
_yt_cache: dict = {}
_YT_CACHE_TTL = 6 * 60 * 60  # 6 hours in seconds


@app.get("/youtube/shorts")
def proxy_youtube_shorts():
    if not YOUTUBE_API_KEY:
        return jsonify({"status": "ERROR", "error": "YOUTUBE_API_KEY not configured"}), 500

    source_type = request.args.get("source_type", "trending")
    channel_id = request.args.get("channel_id", "").strip()
    search_query = request.args.get("search_query", "").strip()

    # Extract channel ID from a full YouTube URL or @handle if provided
    if channel_id.startswith("http"):
        parts = [p for p in channel_id.rstrip("/").split("/") if p]
        channel_id = parts[-1] if parts else channel_id

    cache_key = f"{source_type}|{channel_id}|{search_query}"
    cached = _yt_cache.get(cache_key)
    if cached and (time.time() - cached["ts"] < _YT_CACHE_TTL):
        return jsonify({"status": "OK", "videoIds": cached["videoIds"], "cached": True})

    params: dict = {
        "part": "snippet",
        "type": "video",
        "videoDuration": "short",
        "maxResults": 50,
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
        _yt_cache[cache_key] = {"videoIds": video_ids, "ts": time.time()}
        return jsonify({"status": "OK", "videoIds": video_ids})
    except Exception as e:
        return jsonify({"status": "ERROR", "error": str(e)}), 502


import xml.etree.ElementTree as ET

_news_cache: dict = {}
_NEWS_CACHE_TTL = 30 * 60  # 30 minutes

# Keywords that signal entertainment/celebrity/sports/lifestyle fluff
_FLUFF_KEYWORDS = {
    # Celebrity & entertainment
    "celebrity", "celebrities", "kardashian", "taylor swift", "beyoncé", "beyonce",
    "justin bieber", "kanye", "drake", "rihanna", "britney", "selena gomez",
    "oscars", "emmys", "grammys", "bafta", "golden globe", "red carpet",
    "hollywood", "box office", "album", "tour dates", "music video",
    "reality tv", "reality show", "bachelor", "dancing with the stars",
    "married at first", "love island", "big brother",
    # Sports (unless you want this — remove if desired)
    "nfl", "nba", "nhl", "mlb", "fifa", "premier league", "champions league",
    "super bowl", "world cup", "transfer fee", "transfer window",
    "touchdown", "home run", "slam dunk",
    # Lifestyle / soft news
    "recipe", "diet tips", "weight loss", "horoscope", "zodiac",
    "relationship advice", "dating tips", "fashion week", "beauty tips",
    "skincare", "makeup tutorial", "viral video", "tiktok trend",
    "influencer", "OnlyFans", "paparazzi",
}


def _is_fluff(title: str) -> bool:
    """Return True if the headline is celebrity/entertainment/sports fluff."""
    lower = title.lower()
    return any(kw in lower for kw in _FLUFF_KEYWORDS)

NEWS_SOURCES = {
    "bbc":      ("BBC News",       "https://feeds.bbci.co.uk/news/world/rss.xml"),
    "bbc_biz":  ("BBC Business",   "https://feeds.bbci.co.uk/news/business/rss.xml"),
    "reuters":  ("Reuters",        "https://feeds.reuters.com/reuters/topNews"),
    "ap":       ("AP News",        "https://rsshub.app/apnews/topics/apf-topnews"),
    "ft":       ("Financial Times","https://www.ft.com/rss/home/uk"),
    "wsj":      ("WSJ",            "https://feeds.a.dj.com/rss/RSSWorldNews.xml"),
}


@app.get("/news/headlines")
def proxy_news_headlines():
    source = request.args.get("source", "bbc").lower()
    label, feed_url = NEWS_SOURCES.get(source, NEWS_SOURCES["bbc"])

    cached = _news_cache.get(source)
    if cached and (time.time() - cached["ts"] < _NEWS_CACHE_TTL):
        return jsonify({"status": "OK", "headlines": cached["headlines"], "cached": True})

    try:
        resp = http_requests.get(
            feed_url,
            headers={"User-Agent": "SmartMirror/1.0"},
            timeout=8,
        )
        resp.raise_for_status()
        root = ET.fromstring(resp.content)
        ns = {"media": "http://search.yahoo.com/mrss/"}

        headlines = []
        for item in root.iter("item"):
            title = item.findtext("title", "").strip()
            if not title or title.lower() in {"top stories", "news", ""}:
                continue
            if _is_fluff(title):
                continue
            headlines.append({"title": title, "source": label})
            if len(headlines) >= 20:
                break

        _news_cache[source] = {"headlines": headlines, "ts": time.time()}
        return jsonify({"status": "OK", "headlines": headlines})
    except Exception as e:
        return jsonify({"status": "ERROR", "error": str(e)}), 502


_sports_cache: dict = {}
_SPORTS_CACHE_TTL = 5 * 60  # 5 minutes — short enough to catch live score changes

SPORTS_LEAGUES = {
    "nfl":  ("NFL",     "football/nfl"),
    "nba":  ("NBA",     "basketball/nba"),
    "nhl":  ("NHL",     "hockey/nhl"),
    "mlb":  ("MLB",     "baseball/mlb"),
    "epl":  ("Premier League", "soccer/eng.1"),
    "mls":  ("MLS",     "soccer/usa.1"),
}


@app.get("/sports/scores")
def proxy_sports_scores():
    league = request.args.get("league", "nfl").lower()
    label, path = SPORTS_LEAGUES.get(league, SPORTS_LEAGUES["nfl"])

    cached = _sports_cache.get(league)
    if cached and (time.time() - cached["ts"] < _SPORTS_CACHE_TTL):
        return jsonify({"status": "OK", "games": cached["games"], "league": label, "cached": True})

    url = f"https://site.api.espn.com/apis/site/v2/sports/{path}/scoreboard"
    try:
        resp = http_requests.get(url, headers={"User-Agent": "SmartMirror/1.0"}, timeout=8)
        resp.raise_for_status()
        data = resp.json()

        games = []
        for event in data.get("events", []):
            comp = (event.get("competitions") or [{}])[0]
            competitors = comp.get("competitors", [])
            status_obj = event.get("status", {})
            status_type = status_obj.get("type", {})
            status_detail = status_type.get("shortDetail", "")
            status_state  = status_type.get("state", "pre")  # pre / in / post

            home = next((c for c in competitors if c.get("homeAway") == "home"), None)
            away = next((c for c in competitors if c.get("homeAway") == "away"), None)
            if not home or not away:
                continue

            games.append({
                "homeTeam":  home["team"].get("abbreviation", ""),
                "awayTeam":  away["team"].get("abbreviation", ""),
                "homeScore": home.get("score", ""),
                "awayScore": away.get("score", ""),
                "status":    status_detail,
                "state":     status_state,   # "pre" | "in" | "post"
            })

        _sports_cache[league] = {"games": games, "ts": time.time()}
        return jsonify({"status": "OK", "games": games, "league": label})
    except Exception as e:
        return jsonify({"status": "ERROR", "error": str(e)}), 502


@app.get("/layout/__default__")
def get_default_layout():
    import json as _json
    raw = get_global_setting("default_layout")
    if raw:
        try:
            return jsonify({"layout": _json.loads(raw)})
        except Exception:
            pass
    return jsonify({"layout": DEFAULT_LAYOUT})


@app.post("/layout/__default__")
def save_default_layout():
    import json as _json
    body = request.get_json(force=True)
    layout = body.get("layout")
    if layout is None:
        return jsonify({"error": "missing layout"}), 400
    from db import set_global_setting
    set_global_setting("default_layout", _json.dumps(layout))
    return jsonify({"status": "OK"})


def _get_default_layout():
    """Return the custom default layout from Supabase settings, or fall back to hardcoded."""
    import json as _json
    raw = get_global_setting("default_layout")
    if raw:
        try:
            return _json.loads(raw)
        except Exception:
            pass
    return DEFAULT_LAYOUT


@app.get("/layout/<name>")
def get_layout_by_name(name: str):
    """Public endpoint used by the mirror display to fetch a user's layout."""
    default = _get_default_layout()
    user = get_user_by_name(name)
    if user is None:
        return jsonify({"layout": default})
    layout = get_layout(user["id"])
    return jsonify({"layout": layout or default})



if __name__ == "__main__":
    init_db()

    # Try to open camera — if none detected, skip face recognition and gestures entirely
    cam = get_camera()
    if cam.is_open:
        face_store.load_known_faces()
        t = threading.Thread(target=_encoding_poll_loop, daemon=True)
        t.start()
        gt = threading.Thread(target=gesture_service.gesture_monitor_loop, args=(get_camera,), daemon=True)
        gt.start()
        logger.info("Camera detected — face recognition and gestures enabled.")
    else:
        logger.info("No camera detected — face recognition and gestures disabled.")

    # Start speech recognition (Vosk — Linux/Pi only)
    speech_service.start()

    app.run(host="0.0.0.0", port=3000, debug=False)
