## 1. Create venv and install packages

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## 2. Register a face

```bash
python register_face.py "Daniel"
```
## 3. Run the server

```bash
python app.py
```

Runs on port 3000 by default.

## 4. Test it

```bash
# Single-frame recognition
curl http://localhost:3000/recognize

# Live video stream (open in browser)
open http://localhost:3000/video_feed
```
