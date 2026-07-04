# Cogfab

> A real-time, multiplayer co-op factory-automation game. Build an automated factory together, live, in the browser.

**Status:** playable early build with multiplayer. Visiting drops you into a room; the URL is the invite link, and up to four people build one factory together. Rooms persist across server restarts; cloud deploy is next.

Cogfab is a browser game where multiple players share one factory grid and build it together in real time. You start on a small unlocked patch with just enough ore for your first extractor-belt-seller line; ore that reaches a seller earns, and earnings buy upgrades and more land. Everyone in a room shares everything (the grid, the ore, the upgrades) and sees where the others are pointing. Under the game it is server-authoritative: a Go server owns each room's world and economy, applies every player's commands, and streams the results to everyone in that room.

## Why this exists

A portfolio project to demonstrate (and defend in depth) real-time netcode, Go concurrency, performance engineering, full-stack development, production observability, and cloud deployment, in one cohesive system.

## Architecture in one line

One server process hosts many rooms. Each room is a hub: a single goroutine that owns that room's grid and economy (no locks), applies commands instantly, and runs a once-a-second simulation that moves ore chunks along the belts and pays out only what lands in a seller. Clients get small snapshots plus a handful of economy numbers; everything cosmetic (the flowing ore, the direction arrows, the particles) is derived client-side from the layout, so item positions never touch the wire. Rooms are goroutines, not pods: a room is a few kilobytes ticking in microseconds, so hundreds fit in one process, and scaling out later just means routing each room code to a consistent process.

## Tech stack

| Layer | Choice |
| --- | --- |
| Simulation + server | Go (pure grid engine; hub + ore sim; WebSocket server) |
| Transport | WebSockets (`coder/websocket`) |
| Wire format | JSON, moving to Protocol Buffers on the hot path |
| Client | React + TypeScript + Vite |
| Rendering | Three.js via React Three Fiber |
| Audio | WebAudio, synthesized in code (no audio files) |
| Persistence | JSON snapshots on disk, one file per room (a database when scale demands one) |
| Observability | OpenTelemetry, Prometheus, Grafana, slog (planned) |
| Deploy | Docker to GKE with GitHub Actions CI/CD (planned) |

## Repository layout

```
cogfab/
├── cmd/server/        game server entrypoint
├── internal/
│   ├── engine/        the pure factory grid (start here)
│   ├── server/        rooms of hubs: world + economy + players per room
│   └── wire/          the JSON messages both directions
├── web/               React + Vite + Three.js client
└── docs/devlog.md     running development log
```

## Development

Run the Go tests:

```bash
go test ./...
```

Run the server and the web client (two terminals):

```bash
go run ./cmd/server     # game server on :8080
npm run dev             # in web/, opens the client (usually :5173)
```

**Commit conventions:** [Conventional Commits](https://www.conventionalcommits.org/). Types: `feat fix docs test refactor perf build ci chore`; scopes such as `engine net web deploy docs`. A message template is wired up via `git config commit.template .gitmessage`.

## License

[MIT](LICENSE)
