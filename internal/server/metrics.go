package server

import (
	"net/http"
	"time"

	"github.com/luketucich/cogfab/internal/wire"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Metrics is the server's small set of operational measurements. Each server
// gets its own registry, so tests and other processes never share global state.
// A nil *Metrics disables instrumentation.
type Metrics struct {
	registry *prometheus.Registry

	activeRooms  prometheus.Gauge
	roomsCreated prometheus.Counter
	roomsExpired prometheus.Counter

	activePlayers            prometheus.Gauge
	playerConnections        prometheus.Counter
	playerDisconnections     prometheus.Counter
	slowClientDisconnections prometheus.Counter

	commands        *prometheus.CounterVec
	commandDuration *prometheus.HistogramVec
	tickDuration    prometheus.Histogram
	saveDuration    prometheus.Histogram
	saveFailures    prometheus.Counter
}

// NewMetrics creates an isolated registry with Cogfab, Go runtime, and process
// metrics. It is only called when the metrics listener is enabled.
func NewMetrics() *Metrics {
	registry := prometheus.NewRegistry()
	m := &Metrics{
		registry: registry,
		activeRooms: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "cogfab_rooms_active",
			Help: "Number of room hubs currently held in memory, including rooms in their empty grace period.",
		}),
		roomsCreated: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "cogfab_rooms_created_total",
			Help: "Total number of room hubs started, whether fresh or restored from disk.",
		}),
		roomsExpired: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "cogfab_rooms_expired_total",
			Help: "Total number of empty rooms removed after their grace period.",
		}),
		activePlayers: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "cogfab_players_active",
			Help: "Number of players currently registered with room hubs.",
		}),
		playerConnections: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "cogfab_player_connections_total",
			Help: "Total number of players registered with room hubs.",
		}),
		playerDisconnections: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "cogfab_player_disconnections_total",
			Help: "Total number of players removed from room hubs.",
		}),
		slowClientDisconnections: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "cogfab_slow_client_disconnections_total",
			Help: "Total number of players disconnected because their outbound queue filled.",
		}),
		commands: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "cogfab_commands_total",
			Help: "Total room commands processed by command and outcome.",
		}, []string{"command", "outcome"}),
		commandDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "cogfab_command_processing_duration_seconds",
			Help:    "Time from submitting a decoded room command until its resulting broadcasts are queued.",
			Buckets: prometheus.ExponentialBuckets(0.0001, 2, 13),
		}, []string{"command"}),
		tickDuration: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "cogfab_economy_tick_duration_seconds",
			Help:    "Time to advance an active room by one economy tick and queue its updated stats.",
			Buckets: prometheus.ExponentialBuckets(0.0001, 2, 13),
		}),
		saveDuration: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "cogfab_save_duration_seconds",
			Help:    "Time to snapshot and write one room when persistence is enabled.",
			Buckets: prometheus.ExponentialBuckets(0.001, 2, 13),
		}),
		saveFailures: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "cogfab_save_failures_total",
			Help: "Total number of room snapshot writes that failed.",
		}),
	}

	registry.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
		m.activeRooms,
		m.roomsCreated,
		m.roomsExpired,
		m.activePlayers,
		m.playerConnections,
		m.playerDisconnections,
		m.slowClientDisconnections,
		m.commands,
		m.commandDuration,
		m.tickDuration,
		m.saveDuration,
		m.saveFailures,
	)
	return m
}

// Handler serves this Metrics registry in Prometheus's text format.
func (m *Metrics) Handler() http.Handler {
	return promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{})
}

func (m *Metrics) roomCreated() {
	if m == nil {
		return
	}
	m.activeRooms.Inc()
	m.roomsCreated.Inc()
}

func (m *Metrics) roomExpired() {
	if m == nil {
		return
	}
	m.activeRooms.Dec()
	m.roomsExpired.Inc()
}

func (m *Metrics) roomClosed() {
	if m != nil {
		m.activeRooms.Dec()
	}
}

func (m *Metrics) playerConnected() {
	if m == nil {
		return
	}
	m.activePlayers.Inc()
	m.playerConnections.Inc()
}

func (m *Metrics) playerDisconnected() {
	if m == nil {
		return
	}
	m.activePlayers.Dec()
	m.playerDisconnections.Inc()
}

func (m *Metrics) slowClientDisconnected() {
	if m != nil {
		m.slowClientDisconnections.Inc()
	}
}

func (m *Metrics) commandProcessed(command string, applied bool, elapsed time.Duration) {
	if m == nil {
		return
	}
	command = commandLabel(command)
	outcome := "ignored"
	if applied {
		outcome = "applied"
	}
	m.commands.WithLabelValues(command, outcome).Inc()
	m.commandDuration.WithLabelValues(command).Observe(elapsed.Seconds())
}

func (m *Metrics) economyTick(elapsed time.Duration) {
	if m != nil {
		m.tickDuration.Observe(elapsed.Seconds())
	}
}

func (m *Metrics) saveFinished(elapsed time.Duration, err error) {
	if m == nil {
		return
	}
	m.saveDuration.Observe(elapsed.Seconds())
	if err != nil {
		m.saveFailures.Inc()
	}
}

// commandLabel keeps the only client-controlled metric label to a fixed set.
// Otherwise arbitrary command names could grow the registry without bound.
func commandLabel(command string) string {
	switch command {
	case wire.CmdPlace, wire.CmdBeltStroke, wire.CmdDestroy, wire.CmdRotate, wire.CmdBuy, wire.CmdHover, wire.CmdProfile:
		return command
	default:
		return "unknown"
	}
}
