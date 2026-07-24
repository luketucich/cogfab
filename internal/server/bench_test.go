package server

import (
	"testing"

	"github.com/luketucich/cogfab/internal/engine"
	"github.com/luketucich/cogfab/internal/wire"
)

// denseHub fills a w x h world with rows of one-belt pipelines (extractor,
// belt, seller, repeating), the densest layout the game allows, with the sim
// running at its visual cap.
func denseHub(w, h int) *Hub {
	world := engine.NewWorld(w, h)
	for y := 0; y < h; y++ {
		for x := 0; x+2 < w; x += 3 {
			world.SetDeposit(x, y, engine.Iron, 1_000_000_000)
			world.SetPort(x+2, y, true)
			world.PlaceExtractor(x, y, engine.East)
			world.PlaceBelt(x+1, y, engine.East)
			world.PlaceSeller(x+2, y, engine.West)
		}
	}
	hub := NewHub(world)
	hub.extractorLevel = maxSimLevel
	hub.beltLevel = maxSimLevel
	for i := 0; i < 5; i++ {
		hub.tick() // fill the belts so the benchmark sees steady state
	}
	return hub
}

func denseRefinerHub(w, h int) *Hub {
	world := engine.NewWorld(w, h)
	for y := 0; y < h; y++ {
		for x := 0; x+2 < w; x += 3 {
			world.SetDeposit(x, y, engine.Iron, 1_000_000_000)
			world.SetPort(x+2, y, true)
			world.PlaceExtractor(x, y, engine.East)
			world.PlaceRefiner(x+1, y, engine.East)
			world.PlaceSeller(x+2, y, engine.West)
		}
	}
	return NewHub(world)
}

// connectedResourceHub turns every generated deposit into an extractor and
// fills the remaining terrain with one connected belt network. It exercises
// the largest resource world a real room can build, including long shared
// searches toward the four shipping ports.
func connectedResourceHub() *Hub {
	world := NewResourceWorld("BENCHMARK")
	deposits := 0
	for y := 0; y < world.Height(); y++ {
		for x := 0; x < world.Width(); x++ {
			if world.DepositAt(x, y).Kind != engine.NoResource {
				deposits++
				continue
			}
			if !world.HasPort(x, y) {
				world.PlaceBelt(x, y, engine.East)
			}
		}
	}

	directions := []struct {
		dx, dy int
		dir    engine.Direction
	}{
		{0, -1, engine.North},
		{1, 0, engine.East},
		{0, 1, engine.South},
		{-1, 0, engine.West},
	}
	faceBelt := func(x, y int) engine.Direction {
		for _, direction := range directions {
			nx, ny := x+direction.dx, y+direction.dy
			if nx >= 0 && nx < world.Width() && ny >= 0 && ny < world.Height() && world.At(nx, ny).Kind == engine.Belt {
				return direction.dir
			}
		}
		panic("benchmark machine has no belt at its mouth")
	}

	for y := 0; y < world.Height(); y++ {
		for x := 0; x < world.Width(); x++ {
			if world.DepositAt(x, y).Kind != engine.NoResource {
				world.PlaceExtractor(x, y, faceBelt(x, y))
			} else if world.HasPort(x, y) {
				world.PlaceSeller(x, y, faceBelt(x, y))
			}
		}
	}

	hub := NewHub(world)
	if len(hub.routes) != deposits {
		panic("benchmark did not connect every resource deposit")
	}
	return hub
}

func BenchmarkTickSmallBoard(b *testing.B) {
	h := denseHub(12, 8)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		h.tick()
	}
}

func BenchmarkTickFullWorld(b *testing.B) {
	h := denseHub(resourceWorldSize, resourceWorldSize)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		h.tick()
	}
}

func BenchmarkTickFullWorldRefiners(b *testing.B) {
	h := denseRefinerHub(resourceWorldSize, resourceWorldSize)
	h.extractorLevel = maxUpgradeLevel
	h.beltLevel = maxUpgradeLevel
	h.valueLevel = maxUpgradeLevel
	h.refinerLevel = maxUpgradeLevel
	for i := 0; i < 5; i++ {
		h.tick()
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		h.tick()
	}
}

func BenchmarkEconomyTickMetrics(b *testing.B) {
	for _, enabled := range []bool{false, true} {
		name := "disabled"
		if enabled {
			name = "enabled"
		}
		b.Run(name, func(b *testing.B) {
			h := denseHub(12, 8)
			if enabled {
				h.metrics = NewMetrics()
			}
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				h.runEconomyTick()
			}
		})
	}
}

func BenchmarkOutboundQueueMetrics(b *testing.B) {
	for _, enabled := range []bool{false, true} {
		name := "disabled"
		if enabled {
			name = "enabled"
		}
		b.Run(name, func(b *testing.B) {
			h := NewHub(engine.NewWorld(1, 1))
			if enabled {
				h.metrics = NewMetrics()
			}
			client := &Client{send: make(chan []byte, 1)}
			h.clients[client] = true
			payload := []byte(`{"type":"tiles"}`)
			h.queueBroadcast(client, outboundTiles, payload)
			<-client.send // initialize the metric label before timing steady state

			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				h.queueBroadcast(client, outboundTiles, payload)
				<-client.send
			}
		})
	}
}

func BenchmarkRecomputeFullWorld(b *testing.B) {
	h := denseHub(resourceWorldSize, resourceWorldSize)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		h.recompute()
	}
}

func BenchmarkRecomputeConnectedResourceWorld(b *testing.B) {
	h := connectedResourceHub()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		h.recompute()
	}
	b.ReportMetric(float64(len(h.routes)), "routes")
}

func BenchmarkCommandPayloads(b *testing.B) {
	h := NewHub(engine.NewWorld(resourceWorldSize, resourceWorldSize))
	h.gridTier = len(gridTiers) - 1
	placements := make([]wire.Placement, 0, resourceWorldSize)
	for x := 0; x < resourceWorldSize; x++ {
		h.world.PlaceBelt(x, 0, engine.East)
		placements = append(placements, wire.Placement{X: x, Y: 0, Dir: "east"})
	}
	cmd := wire.Command{Type: wire.CmdPlaceBatch, Kind: wire.KindBelt, Placements: placements}

	b.Run("full state", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			h.stateBytes()
		}
		b.ReportMetric(float64(len(h.stateBytes())), "wire-bytes")
	})
	b.Run("64 tile update", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			h.tileUpdatesBytes(cmd)
		}
		b.ReportMetric(float64(len(h.tileUpdatesBytes(cmd))), "wire-bytes")
	})
}
