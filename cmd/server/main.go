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

// demoWorld builds a small complete line as a starting scene, so the grid is not
// empty on first load: an extractor feeds belts that curve around to a seller, a
// full source -> belts -> sink that the flow lights up.
func demoWorld() *engine.World {
	world := engine.NewWorld(12, 8)
	world.PlaceExtractor(3, 2, engine.East)
	world.PlaceBelt(4, 2, engine.East)
	world.PlaceBelt(5, 2, engine.East)
	world.PlaceBelt(6, 2, engine.South) // corner, turning down
	world.PlaceBelt(6, 3, engine.South)
	world.PlaceBelt(6, 4, engine.West) // corner, turning back
	world.PlaceBelt(5, 4, engine.West)
	world.PlaceBelt(4, 4, engine.West)
	world.PlaceSeller(3, 4, engine.West)
	return world
}
