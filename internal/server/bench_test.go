package server

import (
	"testing"

	"github.com/luketucich/cogfab/internal/engine"
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

func BenchmarkRecomputeFullWorld(b *testing.B) {
	h := denseHub(resourceWorldSize, resourceWorldSize)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		h.recompute()
	}
}
