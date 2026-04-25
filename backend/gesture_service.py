import threading
import time
import logging
import queue
import numpy as np

logger = logging.getLogger(__name__)

try:
    from picamera2 import Picamera2
except ImportError:
    Picamera2 = None

LATEST_GESTURE = None
_GESTURE_LOCK = threading.Lock()
_LAST_REELS_HEARTBEAT_AT = 0.0

_LISTENERS = []

def subscribe():
    q = queue.Queue(maxsize=10)
    with _GESTURE_LOCK:
        _LISTENERS.append(q)
        logger.info("Gesture subscriber connected (total=%d)", len(_LISTENERS))
    return q

def unsubscribe(q):
    with _GESTURE_LOCK:
        if q in _LISTENERS:
            _LISTENERS.remove(q)
            logger.info("Gesture subscriber disconnected (total=%d)", len(_LISTENERS))

def _broadcast_gesture(gesture):
    with _GESTURE_LOCK:
        global LATEST_GESTURE
        LATEST_GESTURE = gesture
        for q in _LISTENERS:
            try:
                q.put_nowait(gesture)
            except queue.Full:
                pass

def get_latest_gesture() -> dict | None:
    global LATEST_GESTURE
    with _GESTURE_LOCK:
        return LATEST_GESTURE

def clear_gesture():
    global LATEST_GESTURE
    with _GESTURE_LOCK:
        LATEST_GESTURE = None

def consume_latest_gesture() -> dict | None:
    global LATEST_GESTURE
    with _GESTURE_LOCK:
        gesture = LATEST_GESTURE
        LATEST_GESTURE = None
        return gesture

def mark_reels_active_heartbeat() -> None:
    global _LAST_REELS_HEARTBEAT_AT
    with _GESTURE_LOCK:
        _LAST_REELS_HEARTBEAT_AT = time.time()

def gesture_monitor_loop(get_camera_func=None):
    """Detect upward flicks via frame differencing.

    With ``get_camera_func`` (normal startup), reuses app.py's shared Camera —
    opening a second Picamera2 on the Pi fails with buffer allocation errors.
    Without it, falls back to a standalone Picamera2 or OpenCV VideoCapture.
    """
    history: list[tuple[float, float]] = []
    HISTORY_MAX_AGE = 0.6
    FLICK_WINDOW_SEC = 0.25
    MIN_ACTIVE_PIXELS = 420
    MAX_ACTIVE_PIXELS = 5000
    MIN_UP_DELTA_PX = 18.0
    MIN_UP_VELOCITY = 70.0
    COOLDOWN_SEC = 0.8
    prev_gray_small: np.ndarray | None = None
    last_detected_at = 0.0
    picam = None
    cap = None
    source_mode = "none"

    if get_camera_func is not None:
        # Single camera pipeline — same picamera2 or OpenCV as /video_feed and /recognize
        source_mode = "shared_camera"
        logger.info(
            "Gesture service using shared Camera (picamera2 on Pi when available, "
            "OpenCV fallback on desktop)."
        )
    else:
        # Standalone: optional second device (not used when app passes get_camera)
        if Picamera2 is not None:
            try:
                picam = Picamera2()
                config = picam.create_video_configuration(
                    main={"size": (640, 480), "format": "RGB888"}
                )
                picam.configure(config)
                picam.start()
                logger.info("Gesture service using standalone picamera2.")
                source_mode = "picamera2"
            except Exception as e:
                logger.warning("Standalone picamera2 failed: %s", e)
                picam = None
        if source_mode == "none":
            import cv2
            cap = cv2.VideoCapture(0)
            if cap.isOpened():
                source_mode = "opencv"
                logger.info("Gesture service using standalone OpenCV camera.")
            else:
                logger.error("No camera available for gesture monitoring.")
                return

    logger.info("Gesture monitoring started.")

    try:
        while True:
            time.sleep(0.05) # 20 Hz

            with _GESTURE_LOCK:
                # Active only when a reels widget is actively heartbeating
                # or when SSE listeners are connected.
                is_active = (len(_LISTENERS) > 0) or ((time.time() - _LAST_REELS_HEARTBEAT_AT) < 3.0)

            if not is_active:
                history.clear()
                prev_gray_small = None
                continue

            if source_mode == "shared_camera":
                cam = get_camera_func()
                if not cam.is_open:
                    continue
                ok, frame = cam.read()
                if not ok or frame is None:
                    continue
            elif source_mode == "picamera2":
                try:
                    frame = picam.capture_array()
                except Exception:
                    continue
            else:
                ok, frame = cap.read()
                if not ok or frame is None:
                    continue

            now = time.time()
            if (now - last_detected_at) < COOLDOWN_SEC:
                continue

            # Downsample aggressively for speed and denoise via 3x3 box blur.
            gray = frame.astype(np.float32).mean(axis=2)
            gray_small = gray[::4, ::4]

            padded = np.pad(gray_small, ((1, 1), (1, 1)), mode="edge")
            gray_blur = (
                padded[:-2, :-2] + padded[:-2, 1:-1] + padded[:-2, 2:]
                + padded[1:-1, :-2] + padded[1:-1, 1:-1] + padded[1:-1, 2:]
                + padded[2:, :-2] + padded[2:, 1:-1] + padded[2:, 2:]
            ) / 9.0

            if prev_gray_small is None:
                prev_gray_small = gray_blur
                continue

            diff = np.abs(gray_blur - prev_gray_small)
            prev_gray_small = gray_blur

            # Motion mask in the downsampled frame.
            motion = diff > 22.0
            active_pixels = int(motion.sum())
            if active_pixels < MIN_ACTIVE_PIXELS or active_pixels > MAX_ACTIVE_PIXELS:
                history = [(t, y) for t, y in history if now - t < HISTORY_MAX_AGE]
                continue

            ys, xs = np.nonzero(motion)
            if ys.size == 0:
                continue

            # y is in downsampled pixels; smaller y means higher in frame.
            centroid_y = float(ys.mean())
            history.append((now, centroid_y))
            history = [(t, y) for t, y in history if now - t < HISTORY_MAX_AGE]

            if len(history) > 1:
                current_t, current_y = history[-1]
                for t, y in reversed(history[:-1]):
                    dt = current_t - t
                    if dt > FLICK_WINDOW_SEC:
                        break
                    up_delta = y - current_y
                    up_velocity = up_delta / max(dt, 1e-6)
                    if dt >= 0.08 and up_delta > MIN_UP_DELTA_PX and up_velocity > MIN_UP_VELOCITY:
                        _broadcast_gesture({
                            "type": "flick_up",
                            "timestamp": now
                        })
                        logger.info("Flick up detected (delta=%.1f, vel=%.1f).", up_delta, up_velocity)
                        history.clear()
                        last_detected_at = now
                        break
    finally:
        if picam is not None:
            try:
                picam.stop()
                picam.close()
            except Exception:
                pass
        if cap is not None:
            try:
                cap.release()
            except Exception:
                pass
