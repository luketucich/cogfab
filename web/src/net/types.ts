// These mirror the server's wire format (internal/wire). If the Go side changes,
// change these to match.

export type TileView = {
  kind: "empty" | "belt" | "extractor" | "seller";
  dir: "north" | "east" | "south" | "west";
};

export type StateMessage = {
  type: "state";
  width: number;
  height: number;
  tiles: TileView[];
};

// StatsMessage is the economy update: the iron-ore total, production rate, and
// where the upgrades stand. A cost of 0 means that upgrade is maxed out.
// Mirror of wire.StatsMessage in Go.
export type StatsMessage = {
  type: "stats";
  ironOre: number;
  ratePerSec: number;
  extractorLevel: number;
  extractorCost: number;
  beltLevel: number;
  beltCost: number;
  valueLevel: number;
  valueCost: number;
  gridWidth: number; // unlocked region, centred in the world
  gridHeight: number;
  gridCost: number;
  nextGridWidth: number; // the tier Grid Size buys next, 0 when maxed
  nextGridHeight: number;
};

// PongMessage answers a ping with the timestamp we sent, so we can measure the
// round-trip time. Mirror of wire.PongMessage in Go.
export type PongMessage = {
  type: "pong";
  t: number;
};

export type ServerMessage = StateMessage | StatsMessage | PongMessage;

// PlaceableKind is the tile kinds a player can place (everything but empty).
// Derived from TileView so the two stay in sync.
export type PlaceableKind = Exclude<TileView["kind"], "empty">;

// Dir is a facing direction, shared by tiles and place commands.
export type Dir = TileView["dir"];

// Commands the client sends to the server. Mirror of internal/wire/command.go.
export type PlaceCommand = {
  type: "place";
  x: number;
  y: number;
  kind: PlaceableKind;
  dir: Dir;
};

export type DestroyCommand = {
  type: "destroy";
  x: number;
  y: number;
};

export type RotateCommand = {
  type: "rotate"; // turn the structure at (x, y) a quarter clockwise
  x: number;
  y: number;
};

export type BuyCommand = {
  type: "buy";
  upgrade: "extractorRate" | "beltSpeed" | "oreValue" | "gridSize";
};

// Ping is deliberately not in this union: connection.ts sends it raw and the
// server answers it in the transport layer, before commands reach the game.
export type Command = PlaceCommand | DestroyCommand | RotateCommand | BuyCommand;
