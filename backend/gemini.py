import os
import base64
import logging

from google import genai
from google.genai import types
from flask import Blueprint, jsonify, request

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
        contents = _build_contents(messages)
        response = client.models.generate_content(model=MODEL, contents=contents)
        return jsonify({"response": response.text})
    except Exception as e:
        logger.exception("Gemini API error")
        return jsonify({"error": str(e)}), 502
