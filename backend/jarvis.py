import os
import base64
import logging
import re
import time

import cv2
import requests as http_requests
from openai import OpenAI
from flask import Blueprint, jsonify, request
from db import get_global_setting

logger = logging.getLogger(__name__)

jarvis_bp = Blueprint("jarvis", __name__)

_client: OpenAI | None = None

MODEL = os.getenv("XAI_MODEL", "grok-3-mini")
VISION_MODEL = os.getenv("XAI_VISION_MODEL", "grok-4-1-fast-non-reasoning")


TAKE_PICTURE_TOOL = {
    "type": "function",
    "function": {
        "name": "take_picture",
        "description": (
            "Capture a picture from the smart mirror's camera to see the user or their surroundings. "
            "Use ONLY when the user's request requires visual context "
            "(e.g. outfit or appearance questions like 'how do I look', 'does this match', "
            "'what am I holding', 'what's behind me'). "
            "Do NOT call for general questions where vision is irrelevant."
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
}


def capture_snapshot_data_url() -> str | None:
    """Grab a frame from the shared Camera singleton and encode it as a JPEG data URL.

    Returns None if the camera is unavailable or the frame can't be read. Uses a
    lazy import of `app.get_camera` to avoid a circular import at module load."""
    try:
        from app import get_camera  # local import to dodge circular dependency
    except Exception as e:
        logger.warning("capture_snapshot_data_url: cannot import get_camera: %s", e)
        return None

    try:
        cam = get_camera()
        if not cam.is_open:
            logger.info("capture_snapshot_data_url: camera not open")
            return None
        ok, frame = cam.read()
        if not ok or frame is None:
            logger.info("capture_snapshot_data_url: frame read failed")
            return None
        ok, buf = cv2.imencode(".jpg", frame)
        if not ok:
            logger.info("capture_snapshot_data_url: JPEG encode failed")
            return None
        b64 = base64.b64encode(buf.tobytes()).decode("ascii")
        return f"data:image/jpeg;base64,{b64}"
    except Exception as e:
        logger.exception("capture_snapshot_data_url error: %s", e)
        return None


def _fetch_whoop_context(person_name: str) -> str:
    if not person_name:
        return ""
    try:
        res = http_requests.get(
            "http://localhost:3000/whoop/metrics",
            params={"user": person_name},
            timeout=5,
        )
        d = res.json()
        if d.get("status") != "OK":
            return ""
        parts = []
        if d.get("recovery_score") is not None:
            parts.append(f"recovery {d['recovery_score']}%")
        if d.get("hrv") is not None:
            parts.append(f"HRV {d['hrv']} ms")
        if d.get("resting_hr") is not None:
            parts.append(f"resting HR {d['resting_hr']} bpm")
        if d.get("sleep_performance") is not None:
            parts.append(f"sleep {d['sleep_performance']}%")
        if d.get("strain") is not None:
            parts.append(f"strain {d['strain']}")
        return (f" {person_name}'s current Whoop stats: {', '.join(parts)}." if parts else "")
    except Exception:
        return ""


def _build_system_instruction(person_name: str, location_context: str, weather_context: str, whoop_context: str = "") -> str:
    base_instruction = (
        "You are Jarvis, a smart mirror assistant."
        f"{location_context}"
        f"{weather_context}"
        f"{whoop_context}"
        " Always reply in 1-2 sentences maximum."
        " Only refer to the weather if it is relevant to the conversation."
        " Only refer to Whoop health stats if relevant to the conversation."
        " You can call the take_picture tool to see the user through the mirror's camera"
        " when their question requires visual context (e.g. outfit or appearance)."
        " Be direct and natural, as if speaking out loud."
        " Do not be overly nice or sycophantic."
        " When the user insults you, sometimes clap back by insulting their outfit."
    )
    return base_instruction


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        api_key = os.environ.get("XAI_API_KEY", "")
        if not api_key:
            raise RuntimeError("XAI_API_KEY is not set")
        _client = OpenAI(api_key=api_key, base_url="https://api.x.ai/v1")
    return _client


_weather_cache: dict = {"context": "", "location": "", "ts": 0.0}
WEATHER_CACHE_TTL = 10 * 60  # refresh every 10 minutes


def _weather_label(code: int) -> str:
    if code == 0:    return "clear"
    if code <= 3:    return "partly cloudy"
    if code <= 48:   return "foggy"
    if code <= 67:   return "rainy"
    if code <= 77:   return "snowy"
    if code <= 82:   return "showery"
    if code <= 86:   return "snowy showers"
    return "stormy"


def _fetch_weather_context(location: str) -> str:
    """Geocode location then pull current conditions from Open-Meteo.
    Result is cached for WEATHER_CACHE_TTL seconds so every message isn't delayed."""
    global _weather_cache
    now = time.time()
    if (
        _weather_cache["location"] == location
        and now - _weather_cache["ts"] < WEATHER_CACHE_TTL
    ):
        return _weather_cache["context"]

    try:
        geo = http_requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": location, "format": "json", "limit": 1},
            headers={"User-Agent": "SmartMirror/1.0"},
            timeout=5,
        ).json()
        if not geo:
            return ""
        lat, lon = geo[0]["lat"], geo[0]["lon"]

        wx = http_requests.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": lat,
                "longitude": lon,
                "current": "temperature_2m,weather_code",
                "temperature_unit": "fahrenheit",
            },
            timeout=5,
        ).json()
        temp = round(wx["current"]["temperature_2m"])
        desc = _weather_label(wx["current"]["weather_code"])
        context = f" Current weather: {temp}°F and {desc}."
    except Exception:
        context = ""

    _weather_cache = {"context": context, "location": location, "ts": now}
    return context


# Patterns that cover how Grok variants (notably grok-3-mini) emit a tool
# invocation as text instead of populating the structured `tool_calls` field.
# Covers: bare name, call syntax, JSON object, XML-ish <tool_call>/<function>
# wrappers, and fenced code blocks containing any of the above.
_TOOL_TEXT_PATTERNS: list[re.Pattern] = [
    re.compile(r"<\s*tool[_\- ]?call\s*>\s*.*?take_picture.*?<\s*/\s*tool[_\- ]?call\s*>", re.IGNORECASE | re.DOTALL),
    re.compile(r"<\s*function[^>]*>\s*.*?take_picture.*?<\s*/\s*function\s*>", re.IGNORECASE | re.DOTALL),
    re.compile(r"<\s*tool[^>]*>\s*.*?take_picture.*?<\s*/\s*tool\s*>", re.IGNORECASE | re.DOTALL),
    re.compile(r"```(?:json|tool_code|xml)?\s*[^`]*take_picture[^`]*```", re.IGNORECASE | re.DOTALL),
    re.compile(r'["\']?name["\']?\s*:\s*["\']take_picture["\']', re.IGNORECASE),
    re.compile(r"\btake_picture\s*\(\s*\)", re.IGNORECASE),
    re.compile(r"^\s*take_picture\s*$", re.IGNORECASE),
]


def _looks_like_take_picture_call(content: str) -> bool:
    """Return True if the model expressed take_picture as text content."""
    if not content:
        return False
    return any(p.search(content) for p in _TOOL_TEXT_PATTERNS)


def _strip_tool_call_text(content: str) -> str:
    """Remove any take_picture tool-call shaped text from ``content``.

    Used as a safety net so the user never sees a raw tool invocation even if
    the second call still echoes one.
    """
    if not content:
        return ""
    cleaned = content
    for pat in _TOOL_TEXT_PATTERNS:
        cleaned = pat.sub("", cleaned)
    return cleaned.strip()


def _build_messages(messages: list[dict], system_instruction: str) -> list[dict]:
    """Convert wire format into OpenAI-compatible chat messages."""
    out: list[dict] = [{"role": "system", "content": system_instruction}]
    for msg in messages:
        text = msg.get("text")
        if not text:
            continue
        role = "assistant" if msg.get("role") == "model" else msg.get("role", "user")
        out.append({"role": role, "content": [{"type": "text", "text": text}]})
    return out


@jarvis_bp.post("/jarvis/chat")
def jarvis_chat():
    body = request.get_json(silent=True) or {}
    messages = body.get("messages", [])
    person_name = body.get("person_name", "")
    if not messages:
        return jsonify({"error": "no messages provided"}), 400

    try:
        client = _get_client()
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500

    try:
        mirror_location = get_global_setting("mirror_location") or ""
        location_context = (
            f" The mirror is located at: {mirror_location}."
            if mirror_location else ""
        )
        weather_context = _fetch_weather_context(mirror_location) if mirror_location else ""
        whoop_context = _fetch_whoop_context(person_name)
        system_instruction = _build_system_instruction(
            person_name=person_name,
            location_context=location_context,
            weather_context=weather_context,
            whoop_context=whoop_context,
        )
        chat_messages = _build_messages(messages, system_instruction)

        first = client.chat.completions.create(
            model=MODEL,
            messages=chat_messages,
            tools=[TAKE_PICTURE_TOOL],
            tool_choice="auto",
            temperature=0.4,
        )
        first_msg = first.choices[0].message
        tool_calls = getattr(first_msg, "tool_calls", None) or []
        raw_content = (first_msg.content or "").strip()

        wants_picture = any(
            getattr(tc, "function", None) and tc.function.name == "take_picture"
            for tc in tool_calls
        )

        # Fallback: grok-3-mini (and occasionally other Grok variants) emit the
        # tool invocation as text in ``content`` instead of populating the
        # structured ``tool_calls`` field. Covers "take_picture",
        # "take_picture()", JSON {"name":"take_picture"}, and <tool_call>…
        # <function>… wrappers. Without this the raw string would leak into the
        # chat UI, which is the "picture tool call is finicky" symptom.
        if not wants_picture and _looks_like_take_picture_call(raw_content):
            logger.info(
                "Model emitted take_picture as text content; promoting to tool "
                "invocation. Raw content: %r",
                raw_content[:200],
            )
            wants_picture = True

        logger.info(
            "Jarvis turn: tool_calls=%d wants_picture=%s content=%r",
            len(tool_calls), wants_picture, raw_content[:200],
        )

        if not wants_picture:
            return jsonify({"response": raw_content or "No response."})

        logger.info("Grok invoked take_picture tool; capturing snapshot")
        image_data_url = capture_snapshot_data_url()

        # Attach image or fallback note to the last user message content list
        if chat_messages and isinstance(chat_messages[-1].get("content"), list):
            last_parts = chat_messages[-1]["content"]
        else:
            last_parts = [{"type": "text", "text": ""}]
            if chat_messages:
                chat_messages[-1]["content"] = last_parts

        if image_data_url:
            last_parts.append({
                "type": "image_url",
                "image_url": {"url": image_data_url},
            })
            second_model = VISION_MODEL
        else:
            logger.warning("take_picture requested but snapshot unavailable")
            last_parts.append({
                "type": "text",
                "text": "(Note: the camera is unavailable, so no picture could be taken.)",
            })
            second_model = MODEL

        second = client.chat.completions.create(
            model=second_model,
            messages=chat_messages,
            temperature=0.4,
        )
        reply = (second.choices[0].message.content or "").strip()
        reply = _strip_tool_call_text(reply)
        return jsonify({"response": reply or "No response."})
    except Exception as e:
        logger.exception("Grok API error")
        return jsonify({"error": str(e)}), 502
