# Smart Mirror

## Running the Backend

### 1. Create venv and install packages

```bash
cd backend
uv sync
```

### 2. Run the server

```bash
uv run --env-file .env app.py
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

- When registering, set Raspberry Pi URL to [http://localhost:3000](http://localhost:3000) when registering locally

## Authors

- **Davis Featherstone** 
- **Kethan Poduri**
- **Daniel Cohen**

