## 1. Create venv and install packages

**With uv (recommended):**

```bash
cd backend
uv sync
```

## 2. Register a face

```bash
uv run register_face.py "Daniel"
```
## 3. Run the server

```bash
uv run app.py
```

Runs on port 3000 by default.

## 4. Test it

```bash
# Single-frame recognition
curl http://localhost:3000/recognize

# Live video stream (open in browser)
open http://localhost:3000/video_feed
```
