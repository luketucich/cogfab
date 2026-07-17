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

	// Operational metrics are opt-in and use their own listener, so production
	// can keep them on a private address instead of the public game server.
	var metrics *server.Metrics
	var metricsSrv *http.Server
	if metricsAddr := os.Getenv("METRICS_ADDR"); metricsAddr != "" {
		metrics = server.NewMetrics()
		metricsMux := http.NewServeMux()
		metricsMux.Handle("/metrics", metrics.Handler())
		metricsSrv = &http.Server{Addr: metricsAddr, Handler: metricsMux}
		go func() {
			slog.Info("metrics listening", "addr", metricsAddr)
			if err := metricsSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				slog.Error("metrics listener failed", "addr", metricsAddr, "err", err)
			}
		}()
	}

	// Every room gets the same large logical world, with a small unlocked centre
	// and terrain generated from its room code. Rooms are created on demand,
	// survive ten minutes after the last player leaves, and restore from disk.
	rooms := server.NewRooms(ctx, 10*time.Minute, server.NewResourceWorld, saves, metrics)

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
		mux.Handle("/", server.NewStaticHandler(webDir))
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
	rooms.Shutdown() // each room attempts a final save
	if metricsSrv != nil {
		_ = metricsSrv.Shutdown(shutdownCtx)
	}
}
