# LiveCanvas

LiveCanvas is a collaborative whiteboard built with React, TypeScript, Yjs, WebSockets, and Postgres snapshots.

## Run it

```bash
docker compose up --build
```

Open `http://localhost:3001` in two browser windows. Add or move a note in one window and watch it sync in the other. Presence and cursors are shared through Yjs Awareness; undo/redo produces a Yjs update so collaborators receive it too.

To demonstrate horizontal fan-out, run `docker compose up --build --scale livecanvas=2`. Nginx distributes WebSocket connections; Redis forwards Yjs updates between the Node replicas.

## Architecture

- `apps/web`: React/Vite editor. The board state is a Yjs array and connects to `/ws/project-nebula`.
- `apps/server`: Node WebSocket relay implementing Yjs sync and Awareness protocol messages. It saves a consolidated document update 800 ms after edits, publishes remote updates through Redis, and exposes `/healthz` with live connection, update, and snapshot metrics.
- `postgres`: One latest snapshot per room in `canvas_snapshots`.
- `redis`: Cross-node update fan-out. Nginx proxies the app and WebSocket traffic to one or more Node replicas.

## Demo assets

The demo is intentionally local, not hosted. Capture these after `docker compose up --build`:

1. Take `demo/livecanvas-board.png` with the editor open.
2. Record `demo/livecanvas-collaboration.mp4`: open two windows, add a sticky note in the first, drag it in the second, then press undo. Keep the 15–25 second recording focused on the sync.

The `demo/` directory is ignored so your personal recording is never committed by accident.
