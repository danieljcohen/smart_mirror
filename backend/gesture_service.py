import threading
import time
import logging
import cv2
import queue

logger = logging.getLogger(__name__)

try:
    import mediapipe as mp
except ImportError:
    mp = None

# Global latest gesture
LATEST_GESTURE = None
_GESTURE_LOCK = threading.Lock()

_LISTENERS = []

def subscribe():
    q = queue.Queue(maxsize=10)
    with _GESTURE_LOCK:
        _LISTENERS.append(q)
    return q

def unsubscribe(q):
    with _GESTURE_LOCK:
        if q in _LISTENERS:
            _LISTENERS.remove(q)

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

def gesture_monitor_loop(get_camera_func):
    """
    Background thread that polls the camera and runs MediaPipe hands.
    If a hand moves UP rapidly, record a flick_up.
    """
    if mp is None:
        logger.warning("MediaPipe not installed, gesture monitoring disabled.")
        return

    mp_hands = mp.solutions.hands
    hands = mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=1,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5
    )

    history = []
    HISTORY_MAX_AGE = 0.5

    logger.info("Gesture monitoring started.")

    while True:
        time.sleep(0.05) # 20 Hz
        
        with _GESTURE_LOCK:
            is_active = len(_LISTENERS) > 0
            
        if not is_active:
            # Do not engage CPU-heavy MediaPipe tracking if nobody is looking
            history.clear()
            continue
        
        cam = get_camera_func()
        if not cam.is_open:
            continue
            
        ok, frame = cam.read()
        if not ok or frame is None:
            continue
            
        small_frame = cv2.resize(frame, (0, 0), fx=0.5, fy=0.5)
        frame_rgb = cv2.cvtColor(small_frame, cv2.COLOR_BGR2RGB)
        results = hands.process(frame_rgb)
        
        now = time.time()
        
        if results.multi_hand_landmarks:
            lm = results.multi_hand_landmarks[0].landmark[9]
            history.append((now, lm.y))
            
            if len(history) > 1:
                current_t, current_y = history[-1]
                for t, y in reversed(history[:-1]):
                    if current_t - t > 0.3:
                        break
                    if (y - current_y) > 0.05:
                        _broadcast_gesture({
                            "type": "flick_up",
                            "timestamp": now
                        })
                        logger.info("Flick up detected!")
                        history.clear()
                        # Cooldown to prevent double-scrolls
                        time.sleep(0.8)
                        break

        history = [(t, y) for t, y in history if now - t < HISTORY_MAX_AGE]
