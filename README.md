# Cogfab

> A real-time, multiplayer co-op factory-automation game — build an automated factory together, live, in the browser.

**Status:** 🚧 Early development (engine-first). Not yet playable.

Cogfab is a browser game where multiple players share one factory grid and build it together in real time — placing extractors, conveyor belts, and machines that refine raw materials into a final product. Under the game, it is a **server-authoritative, real-time, distributed simulation**: a Go server owns a deterministic, fixed-timestep simulation and streams authoritative state to thin clients that predict, reconcile, and render.

## Why this exists

A portfolio project built to demonstrate — and defend in depth — real-time netcode, Go concurrency, performance engineering, full-stack development, production observability, and cloud deployment, in one cohesive system.

## Architecture in one line

The Go server runs a fixed-timestep (20 Hz) **deterministic** simulation as a pure package — `Step(state) → state`, with no networking or rendering inside it. Clients send commands and render authoritative state deltas. That decoupling is what makes the engine unit-testable and makes multiplayer an architecture rather than an afterthought.

## Tech stack

| Layer | Choice |
| --- | --- |
| Simulation + server | Go (pure deterministic engine; WebSocket server) |
| Transport | WebSockets (`coder/websocket`) |
| Wire format | JSON → Protocol Buffers on the hot path |
| Client | React + TypeScript + Vite |
| Rendering | Three.js via React Three Fiber (GPU-instanced) |
| Persistence | PostgreSQL |
| Observability | OpenTelemetry · Prometheus · Grafana · slog |
| Deploy | Docker → GKE (GitHub Actions CI/CD) |

The full architecture and the reasoning behind each choice live in [`docs/research`](docs/research) and [`docs/decisions`](docs/decisions).

## Repository layout

```
cogfab/
├── internal/engine/   # the pure, deterministic simulation (start here)
└── docs/
    ├── research/       # architecture & best-practices research
    ├── decisions/      # Architecture Decision Records (ADRs)
    └── devlog.md       # running development log
```

The net, web, and deploy layers are added as the project grows rather than scaffolded empty up front.

## Development

Run the engine tests:

```bash
go test ./...
```

**Commit conventions:** [Conventional Commits](https://www.conventionalcommits.org/). Types: `feat fix docs test refactor perf build ci chore`; scopes such as `engine net web deploy docs`. A message template is wired up via `git config commit.template .gitmessage`.

## License

[MIT](LICENSE)
