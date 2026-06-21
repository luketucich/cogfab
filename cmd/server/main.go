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

// demoWorld builds a small factory worth watching: an extractor feeding an
// L-shaped belt path that runs east, turns south, then runs back west.
func demoWorld() *engine.World {
	w := engine.NewWorld(8, 4)
	w.PlaceExtractor(0, 0, engine.East, 3)
	for x := 1; x <= 4; x++ {
		w.PlaceBelt(x, 0, engine.East)
	}
	w.PlaceBelt(5, 0, engine.South)
	w.PlaceBelt(5, 1, engine.South)
	w.PlaceBelt(5, 2, engine.West)
	for x := 4; x >= 1; x-- {
		w.PlaceBelt(x, 2, engine.West)
	}
	return w
}
