package server

import (
	"context"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/luketucich/cogfab/internal/engine"
	"github.com/luketucich/cogfab/internal/wire"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func scrapeMetrics(t *testing.T, metrics *Metrics) string {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest("GET", "/metrics", nil)
	metrics.Handler().ServeHTTP(recorder, request)
	if recorder.Code != 200 {
		t.Fatalf("metrics status = %d, want 200", recorder.Code)
	}
	return recorder.Body.String()
}

func TestMetricsEndpointUsesBoundedLabels(t *testing.T) {
	metrics := NewMetrics()
	metrics.commandProcessed("a-client-invented-this", false, time.Millisecond)
	metrics.commandProcessed(wire.CmdPlaceBatch, true, time.Millisecond)
	metrics.commandProcessed(wire.CmdPreview, true, time.Millisecond)
	metrics.outboundQueued(outboundMessage("invented-message"), 7)
	body := scrapeMetrics(t, metrics)

	for _, want := range []string{
		`cogfab_commands_total{command="unknown",outcome="ignored"} 1`,
		`cogfab_commands_total{command="placeBatch",outcome="applied"} 1`,
		`cogfab_commands_total{command="preview",outcome="applied"} 1`,
		`cogfab_websocket_messages_queued_total{message="unknown"} 1`,
		`cogfab_websocket_payload_bytes_queued_total{message="unknown"} 7`,
		"cogfab_rooms_active 0",
		"go_goroutines",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("metrics output does not contain %q", want)
		}
	}
	for _, forbidden := range []string{"a-client-invented-this", "invented-message"} {
		if strings.Contains(body, forbidden) {
			t.Errorf("metrics output contains unbounded label %q", forbidden)
		}
	}
}

func TestMetricsTrackQueuedWebSocketTrafficPerRecipient(t *testing.T) {
	metrics := NewMetrics()
	hub := NewHub(engine.NewWorld(1, 1))
	hub.metrics = metrics
	first := &Client{send: make(chan []byte, 1)}
	second := &Client{send: make(chan []byte, 1)}
	hub.clients[first] = true
	hub.clients[second] = true
	payload := []byte(`{"type":"stats"}`)

	hub.broadcast(outboundStats, payload)

	if got := testutil.ToFloat64(metrics.outboundMessages.WithLabelValues("stats")); got != 2 {
		t.Errorf("queued stats messages = %v, want 2", got)
	}
	if got := testutil.ToFloat64(metrics.outboundBytes.WithLabelValues("stats")); got != float64(2*len(payload)) {
		t.Errorf("queued stats bytes = %v, want %d", got, 2*len(payload))
	}
}

func TestMetricsTrackProtocolSpecificTilePayloads(t *testing.T) {
	metrics := NewMetrics()
	hub := NewHub(engine.NewWorld(2, 1))
	hub.metrics = metrics
	legacy := &Client{send: make(chan []byte, 1)}
	current := &Client{send: make(chan []byte, 1), protocol: tileUpdateProtocol}
	hub.clients[legacy] = true
	hub.clients[current] = true
	hub.world.PlaceBelt(0, 0, engine.East)
	cmd := wire.Command{Type: wire.CmdPlace, X: 0, Y: 0}
	wantStateBytes := len(hub.stateBytes())
	wantTileBytes := len(hub.tileUpdatesBytes(cmd))

	hub.broadcastTileUpdates(cmd)

	if got := testutil.ToFloat64(metrics.outboundMessages.WithLabelValues("state")); got != 1 {
		t.Errorf("legacy state messages = %v, want 1", got)
	}
	if got := testutil.ToFloat64(metrics.outboundMessages.WithLabelValues("tiles")); got != 1 {
		t.Errorf("current tile messages = %v, want 1", got)
	}
	if got := testutil.ToFloat64(metrics.outboundBytes.WithLabelValues("state")); got != float64(wantStateBytes) {
		t.Errorf("legacy state bytes = %v, want %d", got, wantStateBytes)
	}
	if got := testutil.ToFloat64(metrics.outboundBytes.WithLabelValues("tiles")); got != float64(wantTileBytes) {
		t.Errorf("current tile bytes = %v, want %d", got, wantTileBytes)
	}
}

func TestMetricsTrackRoomLifecycle(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	metrics := NewMetrics()
	rooms := NewRooms(ctx, 20*time.Millisecond, func(string) *engine.World { return newTestWorld() }, nil, metrics)
	t.Cleanup(rooms.Shutdown)

	first, _ := rooms.join("AAAAAA")
	rooms.join("AAAAAA")
	if got := testutil.ToFloat64(metrics.activeRooms); got != 1 {
		t.Fatalf("active rooms = %v after two joins to one room, want 1", got)
	}
	if got := testutil.ToFloat64(metrics.roomsCreated); got != 1 {
		t.Fatalf("rooms created = %v after two joins to one room, want 1", got)
	}

	rooms.leave("AAAAAA")
	rooms.leave("AAAAAA")
	waitTornDown(t, first)
	// The hub closes just before expire removes it. Taking the same lock waits
	// for that final registry update without sleeping and hoping.
	rooms.mu.Lock()
	_, stillLive := rooms.rooms["AAAAAA"]
	rooms.mu.Unlock()
	if stillLive {
		t.Fatal("expired room is still in the registry")
	}
	if got := testutil.ToFloat64(metrics.activeRooms); got != 0 {
		t.Fatalf("active rooms = %v after expiry, want 0", got)
	}
	if got := testutil.ToFloat64(metrics.roomsExpired); got != 1 {
		t.Fatalf("rooms expired = %v, want 1", got)
	}

	rooms.join("AAAAAA")
	if got := testutil.ToFloat64(metrics.roomsCreated); got != 2 {
		t.Fatalf("rooms created = %v after recreating the room, want 2", got)
	}
	rooms.Shutdown()
	if got := testutil.ToFloat64(metrics.activeRooms); got != 0 {
		t.Fatalf("active rooms = %v after shutdown, want 0", got)
	}
}

func TestMetricsTrackPlayersAndSlowClients(t *testing.T) {
	metrics := NewMetrics()
	hub := NewHub(newTestWorld())
	hub.metrics = metrics
	slow := &Client{send: make(chan []byte, 4)}

	hub.addClient(slow)                          // welcome, state, and stats occupy three slots
	slow.send <- []byte("backlog")               // the fourth slot makes the client fall behind
	hub.broadcast(outboundStats, []byte("next")) // a full queue disconnects it
	hub.removeClient(slow)                       // a later unregister must not count it twice

	checks := []struct {
		name string
		got  float64
		want float64
	}{
		{"active players", testutil.ToFloat64(metrics.activePlayers), 0},
		{"connections", testutil.ToFloat64(metrics.playerConnections), 1},
		{"disconnections", testutil.ToFloat64(metrics.playerDisconnections), 1},
		{"slow-client disconnections", testutil.ToFloat64(metrics.slowClientDisconnections), 1},
		{"queued stats messages", testutil.ToFloat64(metrics.outboundMessages.WithLabelValues("stats")), 1},
	}
	for _, check := range checks {
		if check.got != check.want {
			t.Errorf("%s = %v, want %v", check.name, check.got, check.want)
		}
	}
}

func TestMetricsTrackCommandResults(t *testing.T) {
	metrics := NewMetrics()
	hub := NewHub(engine.NewWorld(2, 1))
	hub.metrics = metrics
	ctx, cancel := context.WithCancel(context.Background())
	go hub.Run(ctx)

	client := &Client{send: make(chan []byte, 16)}
	hub.Register(client)
	command := wire.Command{Type: wire.CmdPlace, X: 0, Y: 0, Kind: wire.KindBelt, Dir: "east"}
	hub.Submit(client, command)
	hub.Submit(client, command) // the occupied cell makes the second command a no-op
	cancel()
	waitTornDown(t, hub)

	if got := testutil.ToFloat64(metrics.commands.WithLabelValues(wire.CmdPlace, "applied")); got != 1 {
		t.Errorf("applied place commands = %v, want 1", got)
	}
	if got := testutil.ToFloat64(metrics.commands.WithLabelValues(wire.CmdPlace, "ignored")); got != 1 {
		t.Errorf("ignored place commands = %v, want 1", got)
	}
	if body := scrapeMetrics(t, metrics); !strings.Contains(body, `cogfab_command_processing_duration_seconds_count{command="place"} 2`) {
		t.Error("command-duration histogram did not observe both commands")
	}
}

func TestMetricsTrackEconomyTicks(t *testing.T) {
	metrics := NewMetrics()
	_, hub := run(3)
	hub.metrics = metrics
	hub.runEconomyTick()

	if body := scrapeMetrics(t, metrics); !strings.Contains(body, "cogfab_economy_tick_duration_seconds_count 1") {
		t.Error("economy-tick histogram did not observe the tick")
	}
}

func TestMetricsTrackSaveFailures(t *testing.T) {
	metrics := NewMetrics()
	hub := NewHub(newTestWorld())
	hub.code = "AAAAAA"
	hub.metrics = metrics
	hub.saves = newTestSaves(t)
	hub.persist()

	// A missing parent makes the next write fail deterministically.
	hub.saves = &Saves{dir: filepath.Join(t.TempDir(), "missing")}
	hub.persist()

	if got := testutil.ToFloat64(metrics.saveFailures); got != 1 {
		t.Errorf("save failures = %v, want 1", got)
	}
	if body := scrapeMetrics(t, metrics); !strings.Contains(body, "cogfab_save_duration_seconds_count 2") {
		t.Error("save-duration histogram did not observe both save attempts")
	}
}
