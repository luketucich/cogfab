# Devlog

What I've worked on, newest first.

## 2026-07-04
- LAUNCHED. https://cogfab.io is live: DNS pointed at the VM, the server
  minted its own certificate on the first request, and the whole stack
  (page, WebSocket, room saves) verified end to end from the outside.
- A final polish pass for launch: recorded a two-player demo GIF for the
  README (two scripted players join a real room over the WebSocket and build
  lines while the browser records), brought the README's tech-stack table in
  line with what actually runs, and swept the comments for anything stale.
  Pulled the upgrade multipliers into one place on each side of the wire
  while at it; they were inlined four times on the server.
- Right-sized the deploy. A Kubernetes cluster and its load balancer run about
  $90 a month for a game whose whole server is one goroutine-cheap process, so
  production is now one container on an always-free e2-micro VM (~$4/month,
  basically the static IP). The binary fetches and renews its own Let's
  Encrypt certificate when DOMAIN is set, so the entire stack is the one
  process. The GKE manifests stay in deploy/ as the documented scale-up path.
- Containerized the game and wrote the cluster config. The image is a
  three-stage build (web app, Go binary, then a 21MB distroless final that
  runs as non-root), and deploy/ holds the GKE pieces: one pod with the saves
  on a persistent disk, health probes, a load balancer that will not cut
  WebSockets at its default 30-second idle timeout, and a Google-managed
  certificate for cogfab.io. docs/deploy.md is the runbook, from empty GCP
  project to live game.
- Deploy prep on the server: it now serves the built web app itself, so
  production is one binary on one origin (cogfab.io); a /healthz endpoint for
  the load balancer's probes; WebSocket upgrades only accepted from the
  game's own pages instead of any origin; and a cap on total rooms so a
  script hammering the endpoint cannot mint goroutines without bound.
- A sound pass. Every effect now runs through a lowpass with a rounded attack,
  and impacts get a few percent of random pitch drift, so the board sounds
  soft and physical instead of chiptune (the old square-wave blips are gone).
  New: a small thud when ore lands in a seller, capped to a handful of plays
  a second so a busy endgame factory reads as gentle activity, not a drumroll.
- Big numbers now read at a glance: from a million up, the ore total, rate,
  and upgrade prices show as 1.25M / 30.2B instead of a wall of digits.
- Chased the endgame HUD flicker (upgrade buttons strobing between buyable and
  not, the rate jumping around). The server and the wire came up provably
  clean: a soak test drives thousands of ticks at deep levels and asserts the
  stats stream never wobbles, and live captures against a hand-crafted endgame
  save (a fun side effect of room saves being plain JSON) matched. The real
  culprit was the old economy: income could outrun the next upgrade's price,
  so every purchase re-lit the button within a second, and totals past 2^53
  made the count-up's low digits step oddly. The rebalance removes both.
- Rebalanced the upgrades after actually playing a long run. Ore Value used to
  double its payout while its price doubled too, so every level paid for
  itself in the same time forever, and the best strategy was one tiny
  extractor-belt-seller line plus that one button. No reason to expand, no
  reason to build. Now prices still double but each level adds a flat step, so
  every upgrade track slows down the deeper you push it, and the real way to
  grow is building more extractor lines, which take land. The grid purchases
  went from pointless to the backbone of a run.
- Rooms now survive restarts. Each room saves itself to a small JSON file (the
  grid, the ore, the upgrade levels) every thirty seconds and on the way down,
  and joining a code with a save on disk picks up right where it left off. The
  save happens on the room's own goroutine, so the no-locks rule holds, and
  writes go through a temp file and rename so a crash can never leave a
  half-written room. No database yet on purpose: a room is one tiny file, and
  swapping the file store for one is a small, contained change.

## 2026-07-03
- Multiplayer rooms. Visiting the site drops you straight into a room and the
  room code lands in the URL, so the address bar is the invite link: anyone who
  opens it joins your factory (up to four people). Everything is shared per
  room (grid, ore, upgrades), and you watch the others' cursors glide around
  live: a named pointer at the exact spot plus a soft tile on the cell it snaps
  to, in their colour. Everyone can pick a name and colour in the lobby panel,
  which also copies the room code and lets you type a friend's code to jump to
  their room. Rooms are goroutines,
  not pods: one server process hosts hundreds of them (a mutex guards the
  lookup; each room's world stays lock-free on its own goroutine), and an
  empty room survives ten minutes so a refresh never loses the factory.
- Made the upgrades infinite: costs keep doubling, Ore Value doubles what each
  delivery is worth, and past level five the belts are visually maxed so
  richer chunks carry the difference. The game never runs out of a next thing
  to save for.
- A performance pass ahead of multiplayer: the ore emitter was quadratic in
  routes times chunks; noting each route's nearest chunk while advancing took
  a packed 64x64 board from 148ms to 2ms per tick (benchmarks now live in the
  repo), and the client stopped computing the belt runs twice per change.
- Juice pass: synthesized sound effects (placing, tearing down, buying, unlocking land), particle bursts for builds and teardowns, and a gold sparkle every time ore lands in a seller. No audio files; every sound is a couple of WebAudio oscillators.
- Two more upgrades: Belt Speed (ore moves faster, and faster belts genuinely deliver more) and Ore Value (each delivery worth more). Every upgrade card now says exactly what the next level buys, like "5 to 7.5 ore/s per extractor".
- Camera feel: the wheel glides the zoom toward the cursor, Q/E spin the view a quarter turn, and Reset View flies home instead of snapping.
- Quality of life: R rotates whatever you hover (free), Shift locks the placement direction mid-drag, white arrows over extractors and sellers show which way they face, and a ? button lists the controls.
- Redesigned the top counter: labelled stats, fixed-width digits so it never jitters, a steady production rate instead of a flickering per-second measurement, and a count-up that never visibly rewinds.

## 2026-07-01
- Spending: building costs ore and destroying refunds half. The world starts as a bare 3x3 region you grow by buying Grid Size tiers, and Extractor Rate is the first real upgrade. Two rules keep the game unbrickable: upgrades only sell while ore is flowing, and a teardown that stops all income refunds in full.
- Earning: the server runs the same ore-chunk simulation the client draws, so only ore that actually lands in a seller counts, and just a few numbers cross the wire each second. Plus a proper game HUD: ore counter, real ping bar, upgrade panel, icon hotbar with hotkeys.

## 2026-06-27
- Belts show their flow live: faint chevrons drift along every run, white when it reaches a seller and red when it dead-ends. Reworked hover feedback too: a soft glow tile with a facing arrow on empty cells, and structures light up under the cursor.
- Added the seller, the machine that ships material off the grid. Ore now has somewhere to go.

## 2026-06-26
- Belts auto-tile: joining belts snap into corners, tees, and crosses on their own, derived from which neighbours connect.

## 2026-06-25
- Drag to lay belt paths: each belt faces the way you drag, and R rotates a single placement.

## 2026-06-24
- Building works: a toolbar to place and destroy structures, and any player's change shows up for everyone instantly.

## 2026-06-23
- Gave the 3D view a proper builder camera: locked isometric angle, drag to pan, zoom toward the cursor, scaled by how many tiles fit on screen.
- Made the floor an infinite checkerboard that follows the camera, added a soft screen vignette, and fixed a clip bug that dropped the floor when zoomed out.

## 2026-06-22
- Polished the 3D view: smoothly interpolated ore motion, an isometric camera with damped zoom, a soft-fading buildable grid, hover-highlight on cells, and the front-end split into small modules.

## 2026-06-21
- Swapped the cubes for the Kenney conveyor models (loaded with React Three Fiber). The belts look like real conveyor belts now.
- Rendered the factory in 3D (React Three Fiber): isometric view, a fading ground grid, and ore circulating live. Cubes for now; the real models come next.
- Started the web client (React + Vite + Three.js): it connects to the server and shows the live tick. 3D view is next.
- Streamed the factory to the browser: a Go WebSocket server ticks the engine and broadcasts the grid every tick (watch it in the browser console for now).
- Pulled in the Kenney Factory Kit: committed only the conveyor + machine models we use; the full kit stays local (gitignored).
- Added CI: GitHub Actions runs format, vet, build, and tests on every push and PR.
- Made the big calls: host the game server on GKE instead of Cloud Run (it keeps all players of one game on the same server), use React Three Fiber for the 3D, and build the engine before anything else.
- Set up the project: Go module, gitignore, license, commit style.
- Built the first bit of the engine: a grid with an extractor that drops ore onto belts that carry it along. Wrote the tests first; all green.
