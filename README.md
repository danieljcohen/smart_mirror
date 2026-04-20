# Smart Mirror

## Running the Backend

### 1. Create venv and install packages

On Mac:

```bash
cd backend
uv sync
```

On Raspberry Pi:

```bash
sudo apt install -y python3-picamera2 libcap-dev
cd backend
uv venv --system-site-packages --python 3.13
uv sync
```

### 2. Run the server

```bash
uv run app.py
```

Runs on port 3000 by default.

### 3. Test it

```bash
# Single-frame recognition
curl http://localhost:3000/recognize

# Live video stream (open in browser)
open http://localhost:3000/video_feed
```

## Mirror Frontend

`mirror_frontend` (mirror UI, default `http://localhost:5173`) and `configure_frontend` (layout editor, `http://localhost:5174`) both use `yarn dev` and proxy `/api/*` to the backend on port 3000.

`mirror_frontend` (mirror UI, default `http://localhost:5173`) and `configure_frontend` (layout editor, `http://localhost:5174`) both use `yarn dev` and proxy `/api/*` to the backend on port 3000.

```bash
cd mirror_frontend
yarn install
yarn dev
```

Runs on `http://localhost:5173` and proxies `/api/*` to the backend on port 3000.

- Intended to run on the Raspberry Pi and be the screen behind our mirror

## Configure Frontend

```bash
cd configure_frontend
yarn install
yarn dev
```

### Registering a New Person or Logging in

If you have set up on this, log in, or else register.

Face registration now runs as a Modal serverless function (`modal_register/register_service.py`) instead of the Pi backend — the Pi doesn't have the CPU to encode faces quickly. Deploy it with `modal deploy modal_register/register_service.py` and set `VITE_MODAL_REGISTER_URL` in `configure_frontend/.env` to the deployed endpoint URL.

## Autostart on the Raspberry Pi

`deploy/start.sh` pulls latest code, builds the frontend if anything changed, starts the backend and `vite preview`, then opens Chromium in kiosk mode.

On Pi OS Bookworm (labwc / Wayland), wire it into the compositor's autostart so it inherits the full graphical session env. One-time setup on the Pi:

```bash
cat > ~/.config/labwc/autostart <<'EOF'
/home/davis/Desktop/smart_mirror/deploy/start.sh &
EOF
chmod +x ~/.config/labwc/autostart
```

Reboot. To exit the kiosk: `Alt+F4`, or from SSH `pkill -f chromium; pkill -f 'yarn preview'; pkill -f 'uv run'`.

To run manually (useful for debugging):

```bash
cd ~/Desktop/smart_mirror
./deploy/start.sh
```

## Authors

- **Davis Featherstone** 
- **Kethan Poduri**
- **Daniel Cohen**

