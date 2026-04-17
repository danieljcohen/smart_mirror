"""
Vosk-based speech recognition service.

Captures audio from the Pi's microphone and runs continuous offline speech
recognition.  Events (wake word, interim text, final utterances) are exposed
via a thread-safe queue so Flask can stream them as SSE.

On platforms where vosk/sounddevice are unavailable (e.g. macOS dev),
the service gracefully degrades — start() is a no-op and available() returns
False so the frontend can fall back.
"""

import json
import logging
import queue
import threading
import time

logger = logging.getLogger(__name__)

try:
    import vosk
    import sounddevice as sd
    _HAS_VOSK = True
except ImportError:
    _HAS_VOSK = False

SAMPLE_RATE = 16_000
BLOCK_SIZE = 4_000  # ~250 ms of audio per block

WAKE_PHRASE = "hey jarvis"

# ── Global state ──────────────────────────────────────────────────────────────

_lock = threading.Lock()
_listeners: list[queue.Queue] = []
_latest_event: dict | None = None


def available() -> bool:
    return _HAS_VOSK


def subscribe() -> queue.Queue:
    q: queue.Queue = queue.Queue(maxsize=50)
    with _lock:
        _listeners.append(q)
    return q


def unsubscribe(q: queue.Queue) -> None:
    with _lock:
        if q in _listeners:
            _listeners.remove(q)


def consume_event() -> dict | None:
    global _latest_event
    with _lock:
        ev = _latest_event
        _latest_event = None
        return ev


def _broadcast(event: dict) -> None:
    global _latest_event
    with _lock:
        _latest_event = event
        for q in _listeners:
            try:
                q.put_nowait(event)
            except queue.Full:
                pass


# ── Recognition loop ──────────────────────────────────────────────────────────

def _run() -> None:
    vosk.SetLogLevel(-1)
    model = vosk.Model(model_name="vosk-model-small-en-us-0.15")
    rec = vosk.KaldiRecognizer(model, SAMPLE_RATE)

    logger.info("Speech service started (Vosk + sounddevice).")

    def callback(indata: bytes, frames: int, time_info: dict, status: int) -> None:
        if rec.AcceptWaveform(bytes(indata)):
            result = json.loads(rec.Result())
            text = result.get("text", "").strip()
            if text:
                _broadcast({"type": "final", "text": text, "ts": time.time()})
        else:
            partial = json.loads(rec.PartialResult())
            text = partial.get("partial", "").strip()
            if text:
                _broadcast({"type": "partial", "text": text, "ts": time.time()})

    try:
        with sd.RawInputStream(
            samplerate=SAMPLE_RATE,
            blocksize=BLOCK_SIZE,
            dtype="int16",
            channels=1,
            callback=callback,
        ):
            while True:
                time.sleep(0.1)
    except Exception as e:
        logger.error("Speech service error: %s", e)


def start() -> None:
    """Start the speech recognition background thread. No-op if vosk is unavailable."""
    if not _HAS_VOSK:
        logger.info("Vosk not available on this platform — speech service disabled.")
        return
    t = threading.Thread(target=_run, daemon=True)
    t.start()
