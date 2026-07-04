// Command server runs the Cogfab game server: it hosts rooms of shared
// factories and streams each to its players over WebSocket.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/luketucich/cogfab/internal/engine"
	"github.com/luketucich/cogfab/internal/server"
	"golang.org/x/crypto/acme/autocert"
)

const addr = ":8080"

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Rooms save to disk (DATA_DIR, ./data by default), so a factory survives
	// restarts. If the directory cannot be opened the game still runs, just
	// in memory only.
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "data"
	}
	saves, err := server.NewSaves(dataDir)
	if err != nil {
		slog.Warn("saves disabled: rooms will not survive restarts", "dir", dataDir, "err", err)
	}

	// Every room starts as an empty world: a small unlocked region and just
	// enough ore to build a first extractor-to-seller line. Rooms are created
	// on demand, survive ten minutes after the last player leaves, and come
	// back from their save when someone returns later.
	rooms := server.NewRooms(ctx, 10*time.Minute, func() *engine.World {
		return engine.NewWorld(12, 8)
	}, saves)

	mux := http.NewServeMux()
	mux.Handle("/ws", rooms.Handler())
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	// Serve the built web app from the same process, so production is one
	// binary on one origin. In dev the directory usually is not built and
	// Vite serves the page instead; the game works the same either way.
	webDir := os.Getenv("WEB_DIR")
	if webDir == "" {
		webDir = "web/dist"
	}
	if _, err := os.Stat(webDir); err == nil {
		mux.Handle("/", http.FileServer(http.Dir(webDir)))
		slog.Info("serving web app", "dir", webDir)
	} else {
		slog.Info("no web app to serve, WebSocket only", "dir", webDir)
	}

	srv := &http.Server{Addr: addr, Handler: mux}

	// With DOMAIN set (production), the server is its own TLS stack: it
	// fetches and renews a Let's Encrypt certificate for the domain, keeps it
	// next to the room saves, and answers plain HTTP only to redirect to
	// https and to serve the certificate challenges. Without it (dev), it is
	// a plain HTTP server on addr.
	go func() {
		var err error
		if domain := os.Getenv("DOMAIN"); domain != "" {
			certs := &autocert.Manager{
				Prompt:     autocert.AcceptTOS,
				HostPolicy: autocert.HostWhitelist(domain, "www."+domain),
				Cache:      autocert.DirCache(filepath.Join(dataDir, "certs")),
			}
			srv.Addr = ":443"
			srv.TLSConfig = certs.TLSConfig()
			go func() {
				if err := http.ListenAndServe(":80", certs.HTTPHandler(nil)); err != nil {
					slog.Error("http redirect listener failed", "err", err)
				}
			}()
			slog.Info("server listening", "domain", domain, "ws", "wss://"+domain+"/ws")
			err = srv.ListenAndServeTLS("", "")
		} else {
			slog.Info("server listening", "addr", addr, "ws", "ws://localhost"+addr+"/ws")
			err = srv.ListenAndServe()
		}
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server failed", "err", err)
			stop()
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	rooms.Shutdown() // every room saves on the way out
}
