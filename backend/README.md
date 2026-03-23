## 1. Install [uv](https://docs.astral.sh/uv/getting-started/installation/) and sync dependencies

```bash
cd backend
uv sync
```

## 2. Register a face

```bash
uv run python register_face.py "Daniel"
```

## 3. Run the server

```bash
uv run python app.py
```

Runs on port 3000 by default.

## 4. Test it

```bash
# Single-frame recognition
curl http://localhost:3000/recognize

# Live video stream (open in browser)
open http://localhost:3000/video_feed
```
