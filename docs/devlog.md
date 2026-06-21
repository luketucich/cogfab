# Devlog

What I've worked on, newest first.

## 2026-06-21
- Started the web client (React + Vite + Three.js): it connects to the server and shows the live tick. 3D view is next.
- Streamed the factory to the browser: a Go WebSocket server ticks the engine and broadcasts the grid every tick (watch it in the browser console for now).
- Pulled in the Kenney Factory Kit: committed only the conveyor + machine models we use; the full kit stays local (gitignored).
- Added CI: GitHub Actions runs format, vet, build, and tests on every push and PR.
- Made the big calls: host the game server on GKE instead of Cloud Run (it keeps all players of one game on the same server), use React Three Fiber for the 3D, and build the engine before anything else.
- Set up the project: Go module, gitignore, license, commit style.
- Built the first bit of the engine: a grid with an extractor that drops ore onto belts that carry it along. Wrote the tests first; all green.
