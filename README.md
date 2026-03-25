# Smart Mirror

## Running the Backend

### 1. Create venv and install packages

```bash
cd backend
uv sync
```

### 2. Register a face

```bash
uv run register_face.py "Daniel"
```

After you add a new face delete the encoding.pkl

###3. Run the server

```bash
uv run app.py
```

Runs on port 3000 by default.

### 4. Test it

```bash
# Single-frame recognition
curl http://localhost:3000/recognize

# Live video stream (open in browser)
open http://localhost:3000/video_feed
```

## Frontend

```bash
cd frontend
yarn install
yarn dev
```

Runs on `http://localhost:5173` and proxies `/api/*` to the backend on port 3000.

## Authors

- **Davis Featherstone** 
- **Kethan Poduri**
- **Daniel Cohen**

