// Command server runs the Cogfab game server: it hosts rooms of shared
// factories and streams each to its players over WebSocket.
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

	// Every room starts as an empty world: a small unlocked region and just
	// enough ore to build a first extractor-to-seller line. Rooms are created
	// on demand and survive ten minutes after the last player leaves.
	rooms := server.NewRooms(ctx, 10*time.Minute, func() *engine.World {
		return engine.NewWorld(12, 8)
	})

	mux := http.NewServeMux()
	mux.Handle("/ws", rooms.Handler())
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
