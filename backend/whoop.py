import logging
import time
from urllib.parse import urlencode

logger = logging.getLogger(__name__)

from flask import Blueprint, jsonify, redirect, request
import requests as http_requests

from db import (
    delete_whoop_credentials,
    ensure_user,
    get_all_whoop_users,
    get_user_by_name,
    get_whoop_credentials,
    save_whoop_credentials,
    update_whoop_tokens,
)

whoop_bp = Blueprint("whoop", __name__, url_prefix="/whoop")

WHOOP_AUTH_URL   = "https://api.prod.whoop.com/oauth/oauth2/auth"
WHOOP_TOKEN_URL  = "https://api.prod.whoop.com/oauth/oauth2/token"
WHOOP_API_V1     = "https://api.prod.whoop.com/developer/v1"
WHOOP_API_V2     = "https://api.prod.whoop.com/developer/v2"
SCOPES = "read:recovery read:sleep read:cycles read:profile offline"

_metrics_cache: dict = {}
_METRICS_CACHE_TTL = 30 * 60


def _refresh_if_needed(user_id: int, creds: dict) -> dict | None:
    if not creds.get("access_token"):
        return None
    expires_at = creds.get("expires_at") or 0
    if time.time() < expires_at - 60:
        return creds
    if not creds.get("refresh_token"):
        return None
    try:
        resp = http_requests.post(
            WHOOP_TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "refresh_token": creds["refresh_token"],
                "client_id": creds["client_id"],
                "client_secret": creds["client_secret"],
            },
            timeout=10,
        )
        resp.raise_for_status()
        td = resp.json()
        new_access  = td["access_token"]
        new_refresh = td.get("refresh_token", creds["refresh_token"])
        new_expires = time.time() + td.get("expires_in", 3600)
        update_whoop_tokens(user_id, new_access, new_refresh, new_expires)
        return {**creds, "access_token": new_access, "refresh_token": new_refresh, "expires_at": new_expires}
    except Exception:
        return None


# ── Endpoints ────────────────────────────────────────────────────────

@whoop_bp.post("/credentials")
def save_creds():
    """Store a user's Whoop developer app credentials (client_id + client_secret)."""
    body          = request.get_json(force=True) or {}
    user_name     = (body.get("user") or "").strip()
    client_id     = (body.get("client_id") or "").strip()
    client_secret = (body.get("client_secret") or "").strip()

    if not user_name or not client_id or not client_secret:
        return jsonify({"error": "user, client_id, and client_secret are required"}), 400

    user = ensure_user(user_name)
    save_whoop_credentials(user["id"], client_id, client_secret)
    return jsonify({"status": "OK"})


@whoop_bp.get("/authorize")
def authorize():
    """Redirect the browser to Whoop's OAuth consent screen.

    The configure frontend passes its own URL as redirect_uri so that the
    OAuth callback lands back on Vercel (publicly accessible) rather than
    on the Pi's local backend.
    """
    user_name    = (request.args.get("user") or "").strip()
    redirect_uri = (request.args.get("redirect_uri") or "").strip()
    state        = (request.args.get("state") or "").strip()

    if not user_name or not redirect_uri or not state:
        return jsonify({"error": "user, redirect_uri, and state are required"}), 400

    user = get_user_by_name(user_name)
    if not user:
        return jsonify({"error": "user not found — save credentials first"}), 404

    creds = get_whoop_credentials(user["id"])
    if not creds:
        return jsonify({"error": "no credentials saved for this user"}), 400

    params = urlencode({
        "client_id":     creds["client_id"],
        "redirect_uri":  redirect_uri,
        "response_type": "code",
        "scope":         SCOPES,
        "state":         state,
    })
    return redirect(f"{WHOOP_AUTH_URL}?{params}")


@whoop_bp.post("/exchange")
def exchange():
    """Exchange an OAuth authorization code for access + refresh tokens.

    Called by the configure frontend after Whoop redirects back to the
    Vercel app with ?code=...&state=...
    """
    body         = request.get_json(force=True) or {}
    user_name    = (body.get("user") or "").strip()
    code         = (body.get("code") or "").strip()
    redirect_uri = (body.get("redirect_uri") or "").strip()

    if not user_name or not code or not redirect_uri:
        return jsonify({"error": "user, code, and redirect_uri are required"}), 400

    user = get_user_by_name(user_name)
    if not user:
        return jsonify({"error": "user not found"}), 404

    creds = get_whoop_credentials(user["id"])
    if not creds:
        return jsonify({"error": "no credentials found — save credentials first"}), 400

    try:
        resp = http_requests.post(
            WHOOP_TOKEN_URL,
            data={
                "grant_type":    "authorization_code",
                "code":          code,
                "redirect_uri":  redirect_uri,
                "client_id":     creds["client_id"],
                "client_secret": creds["client_secret"],
            },
            timeout=10,
        )
        resp.raise_for_status()
        td = resp.json()
        update_whoop_tokens(
            user["id"],
            td["access_token"],
            td.get("refresh_token", ""),
            time.time() + td.get("expires_in", 3600),
        )
        return jsonify({"status": "OK"})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502


@whoop_bp.get("/status")
def status():
    """Return whether a user has saved credentials and/or connected their account."""
    user_name = (request.args.get("user") or "").strip()
    if not user_name:
        return jsonify({"has_credentials": False, "connected": False})
    user = get_user_by_name(user_name)
    if not user:
        return jsonify({"has_credentials": False, "connected": False})
    creds = get_whoop_credentials(user["id"])
    return jsonify({
        "has_credentials": bool(creds),
        "connected":       bool(creds and creds.get("access_token")),
    })


@whoop_bp.post("/disconnect")
def disconnect():
    user_name = (request.args.get("user") or "").strip()
    if not user_name:
        return jsonify({"error": "user required"}), 400
    user = get_user_by_name(user_name)
    if user:
        delete_whoop_credentials(user["id"])
        _metrics_cache.pop(user_name, None)
    return jsonify({"status": "OK"})


@whoop_bp.get("/debug")
def debug():
    """Return raw Whoop API responses for the first connected user."""
    all_users = get_all_whoop_users()
    if not all_users:
        return jsonify({"error": "no Whoop users connected"}), 404

    # Use ?user=NAME to pick a specific user, otherwise use the first one found
    user_name = (request.args.get("user") or "").strip()
    row = next((u for u in all_users if u["name"] == user_name), all_users[0])

    user = get_user_by_name(row["name"])
    creds = get_whoop_credentials(user["id"])
    creds = _refresh_if_needed(user["id"], creds)
    if not creds:
        return jsonify({"error": "token expired"}), 401

    headers = {"Authorization": f"Bearer {creds['access_token']}"}
    out = {"user": row["name"]}

    r_cyc = http_requests.get(f"{WHOOP_API_V1}/cycle", params={"limit": 1}, headers=headers, timeout=10)
    out["cycle"] = {"status": r_cyc.status_code, "body": r_cyc.json() if r_cyc.ok else r_cyc.text}

    cycle_id = ((r_cyc.json().get("records") or [{}])[0].get("id")) if r_cyc.ok else None
    if cycle_id:
        r_rec = http_requests.get(f"{WHOOP_API_V2}/cycle/{cycle_id}/recovery", headers=headers, timeout=10)
        out["recovery"] = {"status": r_rec.status_code, "body": r_rec.json() if r_rec.ok else r_rec.text}
    else:
        out["recovery"] = {"error": "no cycle_id"}

    r_slp = http_requests.get(f"{WHOOP_API_V2}/activity/sleep", params={"limit": 1}, headers=headers, timeout=10)
    out["sleep"] = {"status": r_slp.status_code, "body": r_slp.json() if r_slp.ok else r_slp.text}

    return jsonify(out)


@whoop_bp.get("/metrics")
def metrics():
    """Return today's Whoop stats for a user. Cached for 30 minutes."""
    user_name = (request.args.get("user") or "").strip()
    if not user_name:
        return jsonify({"status": "ERROR", "error": "user required"}), 400

    cached = _metrics_cache.get(user_name)
    if cached and (time.time() - cached["ts"] < _METRICS_CACHE_TTL) and not request.args.get("nocache"):
        return jsonify({"status": "OK", **cached["data"], "cached": True})

    user = get_user_by_name(user_name)
    if not user:
        return jsonify({"status": "NOT_CONNECTED"})

    creds = get_whoop_credentials(user["id"])
    if not creds or not creds.get("access_token"):
        return jsonify({"status": "NOT_CONNECTED"})

    creds = _refresh_if_needed(user["id"], creds)
    if not creds:
        return jsonify({"status": "TOKEN_EXPIRED"})

    headers = {"Authorization": f"Bearer {creds['access_token']}"}
    try:
        r_cyc = http_requests.get(
            f"{WHOOP_API_V1}/cycle",
            params={"limit": 1}, headers=headers, timeout=10,
        )
        r_slp = http_requests.get(
            f"{WHOOP_API_V2}/activity/sleep",
            params={"limit": 1}, headers=headers, timeout=10,
        )

        cyc_record = ((r_cyc.json().get("records") or [{}])[0]) if r_cyc.ok else {}
        cycle_id   = cyc_record.get("id")

        rec: dict = {}
        if cycle_id:
            r_rec = http_requests.get(
                f"{WHOOP_API_V2}/cycle/{cycle_id}/recovery",
                headers=headers, timeout=10,
            )
            logger.info("[whoop] recovery  %s %s", r_rec.status_code, r_rec.text[:500])
            rec = (r_rec.json().get("score") or {}) if r_rec.ok else {}

        logger.info("[whoop] sleep     %s %s", r_slp.status_code, r_slp.text[:500])
        logger.info("[whoop] cycle     %s %s", r_cyc.status_code, r_cyc.text[:500])

        slp = ((r_slp.json().get("records") or [{}])[0].get("score") or {}) if r_slp.ok else {}
        cyc = cyc_record.get("score") or {}

        kj = cyc.get("kilojoule")
        result = {
            "recovery_score":    rec.get("recovery_score"),
            "hrv":               round(rec["hrv_rmssd_milli"]) if rec.get("hrv_rmssd_milli") is not None else None,
            "resting_hr":        rec.get("resting_heart_rate"),
            "spo2":              rec.get("spo2_percentage"),
            "sleep_performance": slp.get("sleep_performance_percentage"),
            "sleep_efficiency":  slp.get("sleep_efficiency_percentage"),
            "respiratory_rate":  slp.get("respiratory_rate"),
            "strain":            round(cyc["strain"], 1) if cyc.get("strain") is not None else None,
            "avg_hr":            cyc.get("average_heart_rate"),
            "calories":          round(kj / 4.184) if kj is not None else None,
        }
        _metrics_cache[user_name] = {"data": result, "ts": time.time()}
        return jsonify({"status": "OK", **result})
    except Exception as exc:
        return jsonify({"status": "ERROR", "error": str(exc)}), 502
