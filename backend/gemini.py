import os
import base64
import logging
import time

import requests as http_requests
from openai import OpenAI
from flask import Blueprint, jsonify, request
from db import get_global_setting

logger = logging.getLogger(__name__)

gemini_bp = Blueprint("gemini", __name__)

_client: OpenAI | None = None

MODEL = os.getenv("XAI_MODEL", "grok-3-mini")


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
        " Be direct and natural, as if speaking out loud."
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


def _build_messages(messages: list[dict], system_instruction: str) -> list[dict]:
    """Convert wire format into OpenAI-compatible chat messages."""
    out: list[dict] = [{"role": "system", "content": system_instruction}]
    for msg in messages:
        parts: list[dict] = []
        if msg.get("text"):
            parts.append({"type": "text", "text": msg["text"]})
        if msg.get("image"):
            raw = msg["image"]
            if "," in raw:
                header, b64 = raw.split(",", 1)
                mime = header.split(";")[0].split(":")[1] if ":" in header else "image/jpeg"
            else:
                b64 = raw
                mime = "image/jpeg"
            image_bytes = base64.b64decode(b64)
            data_url = f"data:{mime};base64,{base64.b64encode(image_bytes).decode('utf-8')}"
            parts.append({"type": "image_url", "image_url": {"url": data_url}})
        if parts:
            role = "assistant" if msg.get("role") == "model" else msg.get("role", "user")
            out.append({"role": role, "content": parts})
    return out


@gemini_bp.post("/gemini/chat")
def gemini_chat():
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
        response = client.chat.completions.create(
            model=MODEL,
            messages=chat_messages,
            temperature=0.4,
        )
        reply = (response.choices[0].message.content or "").strip()
        return jsonify({"response": reply or "No response."})
    except Exception as e:
        logger.exception("Grok API error")
        return jsonify({"error": str(e)}), 502
