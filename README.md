# Cogfab

> A real-time, multiplayer co-op factory-automation game. Build an automated factory together, live, in the browser.

**Status:** early development (engine-first). Not yet playable.

Cogfab is a browser game where multiple players share one factory grid and build it together in real time, placing extractors, conveyor belts, and machines that refine raw materials into a final product. Under the game it is a server-authoritative, real-time, distributed simulation: a Go server owns a deterministic, fixed-timestep simulation and streams authoritative state to thin clients that predict, reconcile, and render.

## Why this exists

A portfolio project to demonstrate (and defend in depth) real-time netcode, Go concurrency, performance engineering, full-stack development, production observability, and cloud deployment, in one cohesive system.

## Architecture in one line

The Go server runs a fixed-timestep (20 Hz) deterministic simulation as a pure package, `Step(state) -> state`, with no networking or rendering inside it. Clients send commands and render authoritative state deltas. That decoupling is what makes the engine unit-testable and makes multiplayer an architecture rather than an afterthought.

## Tech stack

| Layer | Choice |
| --- | --- |
| Simulation + server | Go (pure deterministic engine; WebSocket server) |
| Transport | WebSockets (`coder/websocket`) |
| Wire format | JSON, moving to Protocol Buffers on the hot path |
| Client | React + TypeScript + Vite |
| Rendering | Three.js via React Three Fiber |
| Persistence | PostgreSQL |
| Observability | OpenTelemetry, Prometheus, Grafana, slog |
| Deploy | Docker to GKE (GitHub Actions CI/CD) |

## Repository layout

```
cogfab/
├── cmd/server/        game server entrypoint
├── internal/
│   ├── engine/        the pure, deterministic simulation (start here)
│   ├── server/        the hub: tick loop + WebSocket clients
│   └── wire/          the JSON message format
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
