// Command server runs the Cogfab game server: it hosts one factory, advances it
// on a fixed-rate loop, and streams each tick to browsers over WebSocket.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/luketucich/cogfab/internal/engine"
	"github.com/luketucich/cogfab/internal/server"
)

const addr = ":8080"

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	hub := server.NewHub(demoWorld())
	go hub.Run(ctx)

	mux := http.NewServeMux()
	mux.Handle("/ws", hub.Handler())
	srv := &http.Server{Addr: addr, Handler: mux}

	go func() {
		slog.Info("server listening", "addr", addr, "ws", "ws://localhost"+addr+"/ws")
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server failed", "err", err)
			stop()
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}

// demoWorld builds a closed belt loop with a few ore on it, so there is always
// something moving to look at. A real factory has extractors and sinks; this is
// just a lively placeholder for the renderer.
func demoWorld() *engine.World {
	world := engine.NewWorld(12, 8)
	// Sit the 6x4 loop in the middle of the floor, leaving room to build around it.
	const ox, oy = 3, 2
	// Top edge runs east; the corner turns south.
	for x := 0; x <= 4; x++ {
		world.PlaceBelt(ox+x, oy, engine.East)
	}
	world.PlaceBelt(ox+5, oy, engine.South)
	// Right edge runs south; the corner turns west.
	world.PlaceBelt(ox+5, oy+1, engine.South)
	world.PlaceBelt(ox+5, oy+2, engine.South)
	world.PlaceBelt(ox+5, oy+3, engine.West)
	// Bottom edge runs west; the corner turns north.
	for x := 4; x >= 1; x-- {
		world.PlaceBelt(ox+x, oy+3, engine.West)
	}
	world.PlaceBelt(ox, oy+3, engine.North)
	// Left edge runs north, back to the start.
	world.PlaceBelt(ox, oy+2, engine.North)
	world.PlaceBelt(ox, oy+1, engine.North)
	// A few ore spread around the loop so it is always moving.
	world.SetItem(ox+1, oy, engine.ItemOre)
	world.SetItem(ox+5, oy+2, engine.ItemOre)
	world.SetItem(ox+3, oy+3, engine.ItemOre)
	world.SetItem(ox, oy+1, engine.ItemOre)
	return world
}
