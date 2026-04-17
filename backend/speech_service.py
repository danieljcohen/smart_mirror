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

VOSK_RATE = 16_000
BLOCK_DURATION_MS = 250

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
    import numpy as np

    vosk.SetLogLevel(-1)
    model = vosk.Model(model_name="vosk-model-small-en-us-0.15")
    rec = vosk.KaldiRecognizer(model, VOSK_RATE)

    # Use the mic's native sample rate and resample to 16 kHz for Vosk
    device_info = sd.query_devices(sd.default.device[0], "input")
    device_rate = int(device_info["default_samplerate"])
    block_size = int(device_rate * BLOCK_DURATION_MS / 1000)
    need_resample = device_rate != VOSK_RATE

    logger.info(
        "Speech service started (Vosk + sounddevice). "
        "Mic rate=%d Hz, Vosk rate=%d Hz, resample=%s.",
        device_rate, VOSK_RATE, need_resample,
    )

    def callback(indata: bytes, frames: int, time_info: dict, status: int) -> None:
        audio = np.frombuffer(indata, dtype=np.int16)
        if need_resample:
            # Simple linear resampling — good enough for speech
            indices = np.round(np.linspace(0, len(audio) - 1, int(len(audio) * VOSK_RATE / device_rate))).astype(int)
            audio = audio[indices]
        data = audio.tobytes()

        if rec.AcceptWaveform(data):
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
            samplerate=device_rate,
            blocksize=block_size,
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
