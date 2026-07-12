# Cogfab

> A real-time, multiplayer co-op factory game. Build an automated factory together, live, in the browser.

**Play it: [cogfab.io](https://cogfab.io).** The URL is the invite link. Open a
room, share the address, and up to four people can build one factory together.

![Animated demo of Luke and Bert connecting a shared belt line, moving ore, and upgrading the extractor](docs/demo.gif)

You start with enough ore to build an extractor, a belt, and a seller. Delivered
ore pays for upgrades and more land. Everyone in a room shares the same grid and
economy, while live cursors show where the other players are building.

## Why I built it

I built Cogfab to see how far a simple, server-authoritative design can go before
distributed infrastructure is actually useful. The goal is a system I can
explain, test, observe, and operate end to end. Extra services only enter when
the workload earns them.

## Architecture

One Go process hosts every room. Each room owns its grid, players, and economy
on one goroutine, so its hot path needs no locks.

The server applies commands and advances the economy. Clients receive grid
snapshots and economy totals, while animation stays in the browser. This keeps
per-item positions off the wire and the server focused on authoritative state.

Today, one Container-Optimized OS VM is enough. Rooms already have stable codes
and isolated state. Scaling out would require routing each room code to one
process and moving room saves to shared storage, but the room model itself would
not change.

## Tech stack

| Layer | Choice |
| --- | --- |
| Simulation + server | Go (pure grid engine; hub + ore sim; WebSocket server) |
| Transport | WebSockets (`coder/websocket`) |
| Wire format | JSON snapshots, with animation derived on the client |
| Client | React + TypeScript + Vite |
| Rendering | Three.js via React Three Fiber |
| Audio | WebAudio, synthesized in code (no audio files) |
| Persistence | JSON snapshots on disk, one file per room |
| Observability | Prometheus + OpenTelemetry metrics, Grafana-compatible PromQL dashboard, and Cloud Logging |
| TLS | the server fetches its own Let's Encrypt certificate |
| Deploy | Small distroless Docker image on one GCP free-tier COS VM; reference GKE manifests in `deploy/` |
| CI | GitHub Actions: ShellCheck, gofmt, vet, race-enabled tests, typecheck, vitest, build |

## Repository layout

```
cogfab/
├── cmd/server/        game server entrypoint (also serves the built web app)
├── internal/
│   ├── engine/        the pure factory grid (start here)
│   ├── server/        rooms of hubs: world + economy + players per room
│   └── wire/          the JSON messages both directions
├── web/               React + Vite + Three.js client
├── deploy/            COS startup script plus reference GKE manifests
├── Dockerfile         three-stage build to a small distroless image
└── docs/              devlog and the deploy runbook
```

Good places to start:

- `internal/server/hub.go`: one goroutine owns each room.
- `internal/server/economy.go`: the ore simulation stays off the wire.
- `internal/server/save.go`: room snapshots use atomic writes.
- `internal/server/bench_test.go`: the benchmark behind a 148ms-to-2ms tick fix.

## Development

```bash
go test ./...           # server tests (race-safe; CI runs them with -race)
cd web && npm test      # client tests (vitest)
```

Run the game locally (two terminals):

```bash
go run ./cmd/server     # game server on :8080
npm run dev             # in web/, opens the client (usually :5173)
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org/).
Common types and scopes are listed in `.gitmessage`, which can be enabled with
`git config commit.template .gitmessage`.

## License

[MIT](LICENSE)
