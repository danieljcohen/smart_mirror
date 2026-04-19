import base64
import modal

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("cmake", "build-essential")
    .pip_install(
        "face_recognition==1.3.0",
        "opencv-python-headless==4.10.0.84",
        "numpy==1.26.4",
        "supabase==2.9.1",
        "fastapi[standard]==0.115.0",
    )
)

app = modal.App("mirror-face-register")


@app.function(image=image, secrets=[modal.Secret.from_name("supabase")], timeout=120)
@modal.fastapi_endpoint(method="POST")
def register(data: dict):
    import os
    import cv2
    import numpy as np
    import face_recognition
    from fastapi import HTTPException
    from supabase import create_client

    name = (data.get("name") or "").strip()
    images_b64 = data.get("images") or []
    if not name:
        raise HTTPException(status_code=400, detail="missing 'name' field")
    if not images_b64:
        raise HTTPException(status_code=400, detail="at least one image required")

    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

    existing = sb.table("users").select("id, name").eq("name", name).execute()
    if existing.data:
        user = existing.data[0]
    else:
        user = sb.table("users").insert({"name": name}).execute().data[0]

    saved = 0
    for b64 in images_b64:
        if "," in b64:
            b64 = b64.split(",", 1)[1]
        try:
            img = cv2.imdecode(
                np.frombuffer(base64.b64decode(b64), np.uint8), cv2.IMREAD_COLOR
            )
            if img is None:
                continue
            h, w = img.shape[:2]
            if max(h, w) > 640:
                s = 640 / max(h, w)
                img = cv2.resize(img, (int(w * s), int(h * s)))
            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            encs = face_recognition.face_encodings(rgb)
            if not encs:
                continue
            sb.table("face_encodings").insert(
                {"user_id": user["id"], "encoding": encs[0].tolist()}
            ).execute()
            saved += 1
        except Exception:
            continue

    if saved == 0:
        raise HTTPException(status_code=400, detail="no face detected in any of the provided images")
    return {"user": user, "encodings_saved": saved}
