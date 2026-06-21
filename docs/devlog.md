# Devlog

What I've worked on, newest first.

## 2026-06-21
- Made the big calls: host the game server on GKE instead of Cloud Run (it keeps all players of one game on the same server), use React Three Fiber for the 3D, and build the engine before anything else.
- Set up the project — Go module, gitignore, license, commit style.
- Built the first bit of the engine: a grid with an extractor that drops ore onto belts that carry it along. Wrote the tests first; all green.
