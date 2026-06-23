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
	w := engine.NewWorld(6, 4)
	// Top edge runs east; the corner at x=5 turns south.
	for x := 0; x <= 4; x++ {
		w.PlaceBelt(x, 0, engine.East)
	}
	w.PlaceBelt(5, 0, engine.South)
	// Right edge runs south; the corner at y=3 turns west.
	w.PlaceBelt(5, 1, engine.South)
	w.PlaceBelt(5, 2, engine.South)
	w.PlaceBelt(5, 3, engine.West)
	// Bottom edge runs west; the corner at x=0 turns north.
	for x := 4; x >= 1; x-- {
		w.PlaceBelt(x, 3, engine.West)
	}
	w.PlaceBelt(0, 3, engine.North)
	// Left edge runs north, back to the start.
	w.PlaceBelt(0, 2, engine.North)
	w.PlaceBelt(0, 1, engine.North)
	// A few ore spread around the loop so it is always moving.
	w.SetItem(1, 0, engine.ItemOre)
	w.SetItem(5, 2, engine.ItemOre)
	w.SetItem(3, 3, engine.ItemOre)
	w.SetItem(0, 1, engine.ItemOre)
	return w
}
