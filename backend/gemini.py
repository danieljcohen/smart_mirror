import os
import base64
import logging
import time

import requests as http_requests
from google import genai
from google.genai import types
from flask import Blueprint, jsonify, request
from db import get_global_setting

logger = logging.getLogger(__name__)

gemini_bp = Blueprint("gemini", __name__)

_client: genai.Client | None = None

MODEL = "gemini-3-flash-preview"


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        api_key = os.environ.get("GEMINI_API_KEY", "")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY is not set")
        _client = genai.Client(api_key=api_key)
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


def _build_contents(messages: list[dict]) -> list[types.Content]:
    """Convert our wire format into google-genai Content objects."""
    contents: list[types.Content] = []
    for msg in messages:
        parts: list[types.Part] = []
        if msg.get("text"):
            parts.append(types.Part.from_text(text=msg["text"]))
        if msg.get("image"):
            raw = msg["image"]
            if "," in raw:
                header, b64 = raw.split(",", 1)
                mime = header.split(";")[0].split(":")[1] if ":" in header else "image/jpeg"
            else:
                b64 = raw
                mime = "image/jpeg"
            parts.append(types.Part.from_bytes(data=base64.b64decode(b64), mime_type=mime))
        if parts:
            contents.append(types.Content(role=msg.get("role", "user"), parts=parts))
    return contents


@gemini_bp.post("/gemini/chat")
def gemini_chat():
    body = request.get_json(silent=True) or {}
    messages = body.get("messages", [])
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
        contents = _build_contents(messages)
        config = types.GenerateContentConfig(
            system_instruction=(
                "You are Jarvis, a smart mirror assistant."
                f"{location_context}"
                f"{weather_context}"
                " Always reply in 1–2 sentences maximum."
                " Be direct and natural, as if speaking out loud."
            )
        )
        response = client.models.generate_content(model=MODEL, contents=contents, config=config)
        return jsonify({"response": response.text})
    except Exception as e:
        logger.exception("Gemini API error")
        return jsonify({"error": str(e)}), 502
