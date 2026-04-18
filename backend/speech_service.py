"""
Hybrid wake-word detection + streaming cloud transcription.

Uses openWakeWord for lightweight local "hey jarvis" detection (~1-5 % CPU),
then opens a Deepgram WebSocket to stream the spoken command in real-time
with partial and final results.

On platforms where dependencies are unavailable the service gracefully
degrades — start() is a no-op and available() returns False so the frontend
can fall back to the browser Web Speech API.
"""

import json
import logging
import os
import queue
import threading
import time

logger = logging.getLogger(__name__)

try:
    import numpy as np
    import openwakeword
    from openwakeword.model import Model as OWWModel
    import sounddevice as sd
    import websocket as ws_client
    _HAS_DEPS = True
except ImportError:
    _HAS_DEPS = False

SAMPLE_RATE = 16_000
FRAME_MS = 80
FRAME_SAMPLES = int(SAMPLE_RATE * FRAME_MS / 1000)  # 1280

OWW_THRESHOLD = 0.5
MAX_COMMAND_SECONDS = 10
DEEPGRAM_URL = "wss://api.deepgram.com/v1/listen"

# ── Global SSE state ──────────────────────────────────────────────────────────

_lock = threading.Lock()
_listeners: list[queue.Queue] = []
_latest_event: dict | None = None


def available() -> bool:
    return _HAS_DEPS


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


# ── Deepgram streaming session ────────────────────────────────────────────────

class _DeepgramSession:
    """Manages a single Deepgram WebSocket transcription session."""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.ws: ws_client.WebSocket | None = None
        self._recv_thread: threading.Thread | None = None
        self._accumulated: list[str] = []
        self._last_partial = ""
        self._speech_ended = threading.Event()

    def start(self) -> None:
        params = "&".join([
            "model=nova-3",
            "encoding=linear16",
            f"sample_rate={SAMPLE_RATE}",
            "channels=1",
            "interim_results=true",
            "endpointing=300",
            "utterance_end_ms=1500",
            "vad_events=true",
        ])
        self.ws = ws_client.create_connection(
            f"{DEEPGRAM_URL}?{params}",
            header={"Authorization": f"Token {self.api_key}"},
            timeout=5,
        )
        self._speech_ended.clear()
        self._accumulated = []
        self._last_partial = ""
        self._recv_thread = threading.Thread(target=self._recv_loop, daemon=True)
        self._recv_thread.start()
        logger.info("[speech] Deepgram session opened.")

    def send(self, audio_bytes: bytes) -> None:
        if self.ws:
            try:
                self.ws.send(audio_bytes, opcode=ws_client.ABNF.OPCODE_BINARY)
            except Exception:
                pass

    def finish(self) -> str:
        if self.ws:
            try:
                self.ws.send(json.dumps({"type": "CloseStream"}))
                self.ws.close()
            except Exception:
                pass
            self.ws = None
        text = " ".join(self._accumulated).strip()
        if not text and self._last_partial:
            text = self._last_partial
        logger.info("[speech] Deepgram session closed. Command: %r", text)
        return text

    @property
    def done(self) -> bool:
        return self._speech_ended.is_set()

    def _recv_loop(self) -> None:
        try:
            while self.ws:
                raw = self.ws.recv()
                if not raw:
                    break
                data = json.loads(raw)
                msg_type = data.get("type", "")

                if msg_type == "Results":
                    alt = data.get("channel", {}).get("alternatives", [{}])[0]
                    transcript = alt.get("transcript", "")
                    is_final = data.get("is_final", False)
                    speech_final = data.get("speech_final", False)

                    if transcript:
                        if is_final:
                            self._accumulated.append(transcript)
                            logger.info("[speech] DG final segment: %s", transcript)
                        else:
                            self._last_partial = transcript
                            _broadcast({
                                "type": "partial",
                                "text": transcript,
                                "ts": time.time(),
                            })

                    if speech_final:
                        logger.info("[speech] speech_final flag received.")
                        self._speech_ended.set()

                elif msg_type == "UtteranceEnd":
                    logger.info("[speech] UtteranceEnd event.")
                    self._speech_ended.set()

        except ws_client.WebSocketConnectionClosedException:
            pass
        except Exception as e:
            logger.debug("[speech] Deepgram recv loop ended: %s", e)


# ── Main recognition loop ─────────────────────────────────────────────────────

def _run() -> None:
    api_key = os.environ.get("DEEPGRAM_API_KEY", "")
    if not api_key:
        logger.error("DEEPGRAM_API_KEY not set — speech service disabled.")
        return

    logger.info("[speech] Downloading openWakeWord models (first run only)…")
    openwakeword.utils.download_models()

    models_dir = os.path.join(os.path.dirname(openwakeword.__file__), "resources", "models")

    # tflite-runtime is only available on Linux; fall back to .onnx elsewhere
    try:
        import tflite_runtime  # noqa: F401
        framework = "tflite"
        model_path = os.path.join(models_dir, "hey_jarvis_v0.1.tflite")
    except ImportError:
        framework = "onnx"
        model_path = os.path.join(models_dir, "hey_jarvis_v0.1.onnx")

    if not os.path.isfile(model_path):
        logger.error("[speech] Model file not found: %s", model_path)
        return

    oww = OWWModel(wakeword_models=[model_path], inference_framework=framework)

    # Prime the model with a silent frame so prediction_buffer is populated
    oww.predict(np.zeros(FRAME_SAMPLES, dtype=np.int16))

    jarvis_key: str | None = None
    for key in oww.prediction_buffer:
        if "jarvis" in key.lower():
            jarvis_key = key
            break
    if not jarvis_key:
        logger.error(
            "No 'hey jarvis' model found. Available: %s",
            list(oww.prediction_buffer.keys()),
        )
        return
    logger.info("[speech] openWakeWord model loaded: %s", jarvis_key)

    device_info = sd.query_devices(sd.default.device[0], "input")
    device_rate = int(device_info["default_samplerate"])
    block_size = int(device_rate * FRAME_MS / 1000)
    need_resample = device_rate != SAMPLE_RATE

    logger.info(
        "[speech] Mic rate=%d Hz, target=%d Hz, resample=%s.",
        device_rate, SAMPLE_RATE, need_resample,
    )

    audio_q: queue.Queue[np.ndarray] = queue.Queue(maxsize=200)

    def _audio_cb(indata: bytes, frames: int, time_info: dict, status: int) -> None:
        audio = np.frombuffer(indata, dtype=np.int16).copy()
        if need_resample:
            idx = np.round(
                np.linspace(0, len(audio) - 1, int(len(audio) * SAMPLE_RATE / device_rate))
            ).astype(int)
            audio = audio[idx]
        try:
            audio_q.put_nowait(audio)
        except queue.Full:
            pass

    try:
        with sd.RawInputStream(
            samplerate=device_rate,
            blocksize=block_size,
            dtype="int16",
            channels=1,
            callback=_audio_cb,
        ):
            logger.info("[speech] Service running — listening for wake word.")
            mode = "listening"
            dg: _DeepgramSession | None = None
            session_start = 0.0

            while True:
                try:
                    audio = audio_q.get(timeout=0.15)
                except queue.Empty:
                    if mode == "streaming" and time.time() - session_start > MAX_COMMAND_SECONDS:
                        text = dg.finish() if dg else ""
                        _broadcast({"type": "command", "text": text, "ts": time.time()} if text else {"type": "timeout", "ts": time.time()})
                        dg = None
                        mode = "listening"
                    continue

                if mode == "listening":
                    oww.predict(audio)
                    score = oww.prediction_buffer[jarvis_key][-1]
                    if score > OWW_THRESHOLD:
                        logger.info("[speech] Wake word! score=%.2f", score)
                        _broadcast({"type": "wake", "ts": time.time()})
                        oww.reset()
                        try:
                            dg = _DeepgramSession(api_key)
                            dg.start()
                            mode = "streaming"
                            session_start = time.time()
                        except Exception as e:
                            logger.error("[speech] Deepgram connect failed: %s", e)
                            _broadcast({"type": "timeout", "ts": time.time()})

                elif mode == "streaming":
                    dg.send(audio.tobytes())

                    if dg.done:
                        text = dg.finish()
                        _broadcast(
                            {"type": "command", "text": text, "ts": time.time()}
                            if text
                            else {"type": "timeout", "ts": time.time()}
                        )
                        dg = None
                        mode = "listening"

                    elif time.time() - session_start > MAX_COMMAND_SECONDS:
                        logger.info("[speech] Command timeout (%ds).", MAX_COMMAND_SECONDS)
                        text = dg.finish()
                        _broadcast(
                            {"type": "command", "text": text, "ts": time.time()}
                            if text
                            else {"type": "timeout", "ts": time.time()}
                        )
                        dg = None
                        mode = "listening"

    except Exception as e:
        logger.error("Speech service fatal error: %s", e)


def start() -> None:
    """Launch the speech service background thread."""
    if not _HAS_DEPS:
        logger.info("Speech dependencies unavailable — speech service disabled.")
        return
    t = threading.Thread(target=_run, daemon=True)
    t.start()
