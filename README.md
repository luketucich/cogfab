# Cogfab

> A real-time, multiplayer co-op factory game. Build an automated factory together, live, in the browser.

**Play it: [cogfab.io](https://cogfab.io)** — the URL is the invite link. Visiting drops you into a room; share the address and up to four people build one factory together.

![Two players building a factory together, live cursors and all](docs/demo.gif)

You start on a small patch of land with just enough ore for a first extractor-belt-seller line. Ore that reaches a seller earns; earnings buy upgrades and more land; more land holds more lines. Everyone in a room shares everything: the grid, the ore, the upgrades, and you watch each other's cursors glide around the board as you build.

## Why this exists

A portfolio project to demonstrate (and defend in depth) real-time netcode, Go concurrency, performance engineering, full-stack development, and cloud deployment, in one cohesive system.

## Architecture in one line

One server process hosts many rooms. Each room is a hub: a single goroutine that owns that room's grid and economy (no locks), applies commands instantly, and runs a once-a-second simulation that moves ore chunks along the belts and pays out only what lands in a seller. Clients get small snapshots plus a handful of economy numbers; everything cosmetic (the flowing ore, the direction arrows, the particles) is derived client-side from the layout, so item positions never touch the wire. Rooms are goroutines, not pods: a room is a few kilobytes ticking in microseconds, so hundreds fit in one process, and scaling out later just means routing each room code to a consistent process.

## Tech stack

| Layer | Choice |
| --- | --- |
| Simulation + server | Go (pure grid engine; hub + ore sim; WebSocket server) |
| Transport | WebSockets (`coder/websocket`) |
| Wire format | JSON (snapshots are small enough that nothing hotter is needed) |
| Client | React + TypeScript + Vite |
| Rendering | Three.js via React Three Fiber |
| Audio | WebAudio, synthesized in code (no audio files) |
| Persistence | JSON snapshots on disk, one file per room (a database when scale demands one) |
| TLS | the server fetches its own Let's Encrypt certificate |
| Deploy | Small distroless Docker image on one GCP free-tier COS VM; GKE manifests in `deploy/` as the scale-up path |
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
├── deploy/            COS startup script plus GKE scale-up manifests
├── Dockerfile         three-stage build to a small distroless image
└── docs/              devlog and the deploy runbook
```

Good places to read: `internal/server/hub.go` (one goroutine per room, no locks), `internal/server/economy.go` (the ore simulation and why it stays off the wire), `internal/server/save.go` (persistence with atomic writes), and `internal/server/bench_test.go` (the benchmark behind a 148ms-to-2ms tick fix).

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

**Commit conventions:** [Conventional Commits](https://www.conventionalcommits.org/). Types: `feat fix docs test refactor perf build ci chore`; scopes such as `engine net web deploy docs`. A message template is wired up via `git config commit.template .gitmessage`.

## License

[MIT](LICENSE)
