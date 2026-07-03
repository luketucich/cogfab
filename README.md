# Cogfab

> A real-time, multiplayer co-op factory-automation game. Build an automated factory together, live, in the browser.

**Status:** playable early build. Build belt lines, earn ore, buy upgrades and land. Multiplayer rooms and cloud deploy are next.

Cogfab is a browser game where multiple players share one factory grid and build it together in real time. You start on a small unlocked patch with just enough ore for your first extractor-belt-seller line; ore that reaches a seller earns, and earnings buy upgrades and more land. Under the game it is server-authoritative: a Go server owns the world and the economy, applies every player's commands, and streams the results to everyone.

## Why this exists

A portfolio project to demonstrate (and defend in depth) real-time netcode, Go concurrency, performance engineering, full-stack development, production observability, and cloud deployment, in one cohesive system.

## Architecture in one line

The Go server owns the grid and the economy on a single goroutine (no locks): commands apply instantly, a once-a-second simulation moves ore chunks along the belts and pays out only what lands in a seller, and clients get small snapshots plus a handful of economy numbers. Everything cosmetic (the flowing ore, the direction arrows, the particles) is derived client-side from the layout, so item positions never touch the wire.

## Tech stack

| Layer | Choice |
| --- | --- |
| Simulation + server | Go (pure grid engine; hub + ore sim; WebSocket server) |
| Transport | WebSockets (`coder/websocket`) |
| Wire format | JSON, moving to Protocol Buffers on the hot path |
| Client | React + TypeScript + Vite |
| Rendering | Three.js via React Three Fiber |
| Audio | WebAudio, synthesized in code (no audio files) |
| Persistence | PostgreSQL (planned) |
| Observability | OpenTelemetry, Prometheus, Grafana, slog (planned) |
| Deploy | Docker to GKE with GitHub Actions CI/CD (planned) |

## Repository layout

```
cogfab/
├── cmd/server/        game server entrypoint
├── internal/
│   ├── engine/        the pure factory grid (start here)
│   ├── server/        the hub: world + economy + WebSocket clients
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
