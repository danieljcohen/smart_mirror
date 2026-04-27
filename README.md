# Smart Mirror

A Raspberry Pi smart mirror with face recognition, gesture and speech input, configurable widgets, and a separate layout editor.

## Apps

- `backend`: Flask API on `http://localhost:3000` for camera recognition, gestures, speech, layouts, widgets, and third-party API proxies.
- `mirror_frontend`: Vite/React mirror display on `http://localhost:5173`; proxies `/api/*` to the backend.
- `configure_frontend`: Vite/React layout editor on `http://localhost:5174`; proxies `/api/*` to the backend.
- `modal_register`: Modal service for face registration and encoding.

## Configuration

Backend settings live in `backend/.env`:

```bash
SUPABASE_URL=...
SUPABASE_KEY=...
GOOGLE_MAPS_API_KEY=...   # optional, directions widget
YOUTUBE_API_KEY=...       # optional, reels/search widgets
DEEPGRAM_API_KEY=...      # optional, speech and text-to-speech
XAI_API_KEY=...           # optional, Jarvis chat
```

Configure frontend settings live in `configure_frontend/.env`:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_MODAL_REGISTER_URL=...
```

Deploy face registration with:

```bash
modal deploy modal_register/register_service.py
```

The Modal registration service expects a Modal secret named `supabase` with `SUPABASE_URL` and `SUPABASE_KEY`.

## Local Development

Backend:

```bash
cd backend
uv sync
uv run app.py
```

On Raspberry Pi, install camera support first:

```bash
sudo apt install -y python3-picamera2 libcap-dev
cd backend
uv venv --system-site-packages --python 3.13
uv sync
```

Mirror display:

```bash
cd mirror_frontend
yarn install
yarn dev
```

Layout editor:

```bash
cd configure_frontend
yarn install
yarn dev
```

Useful backend checks:

```bash
curl http://localhost:3000/recognize
open http://localhost:3000/video_feed
```

## Raspberry Pi Kiosk

`deploy/start.sh` pulls the latest code, refreshes dependencies and rebuilds `mirror_frontend` when needed, starts the backend and `vite preview`, then opens Chromium in kiosk mode.

Optional autostart setup for Pi OS Bookworm with labwc/Wayland. Adjust the path if the repo lives somewhere else:

```bash
mkdir -p ~/.config/labwc
cat > ~/.config/labwc/autostart <<'EOF'
/home/davis/Desktop/smart_mirror/deploy/start.sh &
EOF
chmod +x ~/.config/labwc/autostart
```

Run it manually for debugging:

```bash
cd ~/Desktop/smart_mirror
./deploy/start.sh
```

To exit kiosk mode, press `Alt+F4` or run:

```bash
pkill -f chromium; pkill -f 'yarn preview'; pkill -f 'uv run'
```

## Authors

- Davis Featherstone
- Kethan Poduri
- Daniel Cohen
